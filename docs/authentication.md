# Authentication and API keys

Sorolens has **two independent authorization layers**:

| Layer | Answers | Carried by |
| --- | --- | --- |
| **API-key scopes** | *what* a credential may do | `Authorization: Bearer sl_…` (or `?api_key=sl_…`) |
| **User roles** | *who* the caller is | `X-User-ID` / `X-GitHub-Login` / `X-User-Sub` / `X-GitHub-ID` headers |

A route can require a scope, a role, or both. Scopes are enforced by
`apps/api/internal/middleware/scopes.go`, roles by
`apps/api/internal/middleware/roles.go`.

## Scopes

| Scope | Grants |
| --- | --- |
| `read:contracts` | every read on the public surface: `/api/v1/contracts*`, `/events`, `/invocations/…/trace`, `/rules*` reads, `/stream/events`, `/subscribe`, `/dlq`, `/stats/*`, `/compare`, `POST /graphql`, and the `validate` endpoints (v1 + v2) |
| `write:contracts` | mutations: `POST /contracts`, `/contracts/batch`, contract tags, notes, `/rules` create-update-delete, `/dlq/{id}/requeue`, `/watched-accounts`, watchdog subscription create/delete, `POST /contracts/{id}/verify` |
| `read:watchdog` | the watchdog read surface: `/watchdog/stats`, `/watchdog/alerts`, `/watchdog/contracts*`, and `GET /watchdog/subscriptions` (v1 + v2) |
| `admin:*` | API-key management (`/api-keys*`) and signing-secret operations (`/watchdog/subscriptions/{id}/signing-secret`, `…/rotate`). `admin:*` is a super-scope: `APIKey.HasScope` accepts it (and `*`, and any `<prefix>:*`) for **every** requirement. |

The full `METHOD /route → scope` table lives in `routeScopes`
(`apps/api/internal/middleware/scopes.go`). Routes absent from it (for example
`/health`, `/readyz`) need no scope.

### What happens when no key is presented

This is deliberate and worth knowing:

- **Read/write routes** (anything not requiring `admin:*`) stay **open** without a
  credential — the public v0.1 surface is anonymous, as it was before scopes existed.
- **Admin routes** always require a credential, so a key cannot be minted anonymously.
- Consequently, **sending a key can be stricter than sending none**: anonymous
  `GET /api/v1/contracts` succeeds, while the same request with a valid key that
  lacks `read:contracts` returns `403 missing scope`.

## Roles

`contributor` < `admin`; the caller's role comes from the users table, resolved
from request headers in this order (`middleware/roles.go`):

1. `X-User-ID` — stored Sorolens user id
2. `X-GitHub-Login` — GitHub login mapped to a user via `github_id`
3. `X-User-Sub` — OAuth `sub` claim
4. `X-GitHub-ID` — legacy path, matches either the user id or its `github_id`

Role-gated routes:

| Route | Minimum role |
| --- | --- |
| `DELETE /api/v1/contracts/{id}/notes/{noteID}` | contributor |
| `POST /api/v1/dlq/{id}/requeue` | contributor |
| `/api/v1/api-keys*` | admin |
| `/api/v1/admin/*` (`keys`, `audit`) | admin |

Roles are **not** implied by scopes: a key with `admin:*` still cannot reach
`/admin/*` unless the caller also resolves to an admin user.

## Creating the first key

There is a bootstrapping order problem: creating a key requires the admin role,
and the role comes from a user, not from a key. Set the seeding variable, then
use the role-only admin surface:

```bash
# 1. API process seeds an admin user whose id AND github_id are this value
export INITIAL_ADMIN_GITHUB_ID=your-github-login

# 2. Create the first key through the role-only admin surface
curl -sX POST http://localhost:8080/api/v1/admin/keys \
  -H "X-GitHub-ID: your-github-login" \
  -H "Content-Type: application/json" \
  -d '{"name":"bootstrap","scopes":["admin:*"]}'
```

Afterwards use that key for `/api/v1/api-keys` (which needs `admin:*` **and**
the admin role) and you no longer need the header.

## Creating a key

```bash
curl -sX POST http://localhost:8080/api/v1/api-keys \
  -H "Authorization: Bearer $SOROLENS_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"ci-read-only","scopes":["read:contracts"]}'
```

`201 Created` — the plaintext token is returned **exactly once**:

```json
{
  "id": "9f1c…",
  "name": "ci-read-only",
  "key_prefix": "sl_AbCdEfGh",
  "scopes": ["read:contracts"],
  "created_at": "2026-10-12T09:15:04Z",
  "last_used_at": null,
  "revoked_at": null,
  "rotated_at": null,
  "key": "sl_AbCdEfGh…"
}
```

Only a SHA-256 hash of the token is stored, plus a display prefix
(`api_keys` table, migration `000004_api_key_scopes`). If you lose the token,
rotate it — it cannot be recovered.

Errors use the standard envelope (`{"error":{"code","message","request_id"}}`, codes are upper-case), e.g. `422 INVALID_INPUT`:

```json
{"error": {"code": "INVALID_INPUT", "message": "unknown scope typo:contracts; valid scopes are: read:contracts, write:contracts, read:watchdog, admin:*", "request_id": "…"}}
```

## Using a key

Bearer header (preferred):

```bash
curl -s http://localhost:8080/api/v1/contracts \
  -H "Authorization: Bearer $SOROLENS_KEY"
```

Query parameter (handy in a browser; it ends up in logs, so avoid it for
anything long-lived):

```bash
curl -s "http://localhost:8080/api/v1/contracts?api_key=$SOROLENS_KEY"
```

When both are present, `Authorization` wins.

> **Known discrepancy:** `docs/openapi.yaml` documents an `X-API-Key` header and
> the CORS middleware allows it, but `extractAPIKey()` reads only
> `Authorization: Bearer` and `?api_key`. Sending `X-API-Key` currently yields
> `401 authentication required`. Tracked separately; this guide documents the
> behaviour of the code as it is.

## Key lifecycle

```bash
# list (paginated: ?limit=50&cursor=…), key material is never returned
curl -s "http://localhost:8080/api/v1/api-keys?limit=20" -H "Authorization: Bearer $KEY"

# inspect one
curl -s http://localhost:8080/api/v1/api-keys/$ID -H "Authorization: Bearer $KEY"

# rotate — returns a new plaintext token, keeps id/name/scopes, sets rotated_at
curl -sX POST http://localhost:8080/api/v1/api-keys/$ID/rotate -H "Authorization: Bearer $KEY"

# revoke — the key stops authenticating immediately (revoked_at is set)
curl -sX DELETE http://localhost:8080/api/v1/api-keys/$ID -H "Authorization: Bearer $KEY"
```

## Error responses

| Status | Body | When |
| --- | --- | --- |
| `401` | `{"error":"authentication required"}` | admin-scoped route called with no credential, or a role-gated route with no resolvable identity |
| `401` | `{"error":"invalid API key"}` | unknown or revoked token |
| `403` | `{"error":"missing scope","required":"read:watchdog"}` | valid key, insufficient scope |
| `403` | `{"error":"insufficient role","required":"admin","role":"contributor"}` | caller resolves to a user below the minimum role |
| `422` | `{"error":{"code":"INVALID_INPUT","message":"…","request_id":"…"}}` | malformed body, empty `name`, unknown scope |

## Operational notes

- Store keys in a secret manager, never in a repo; CI keys should be `read:*` only.
- `last_used_at` is touched on every authenticated request — useful for spotting dead keys.
- Revoking is immediate; rotating invalidates the previous token.
- Self-hosting deployments must set `INITIAL_ADMIN_GITHUB_ID` (once) or they cannot mint the first key.

## Checking this guide locally

```bash
cd apps/api
go test ./internal/middleware/... ./internal/handler/...   # scope + key lifecycle behaviour
make api                                                    # then curl http://localhost:8080/api/v1/contracts
```
