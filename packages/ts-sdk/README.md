# `@sorolens/ts-sdk`

Typed, dependency-free TypeScript client for the Sorolens API. The operation
table and the schema types are generated from `docs/openapi.yaml`; the client
core (URL building, auth, retries, pagination) is hand-written.

```ts
import { SorolensClient } from "@sorolens/ts-sdk";

const client = new SorolensClient({
  baseUrl: "https://api.sorolens.dev",
  apiKey: process.env.SOROLENS_API_KEY,
});

// One page…
const page = await client.request<{ contracts: unknown[]; next_cursor: string }>(
  "listContracts",
  { query: { limit: 50, network: "testnet" } }
);

// …or the whole list, following the API's cursor for you.
for await (const contracts of client.paginate("listContracts", { query: { limit: 100 } })) {
  console.log(contracts.length);
}
```

## What you get

| Piece | Details |
|---|---|
| `operations` | The generated operation table: method, path, tags, parameters, request/response schema names and `operationIds` |
| Types | One type per `components/schemas` entry, exported from `@sorolens/ts-sdk` |
| `client.url(id, opts)` | Builds an absolute URL, substitutes and encodes path parameters, drops empty query values |
| `client.request(id, opts)` | Sends the request with `Authorization: Bearer <apiKey>`, JSON body support, and parses the response |
| `client.paginate(id, opts)` | Walks a cursor-paginated endpoint page by page (`maxPages` supported) |
| `SorolensError` | Thrown for non-2xx responses, carrying `status`, `body` and `operationId` |

## Behaviour worth knowing

- **Retries**: `429` and `5xx` responses, plus network failures, are retried with
  exponential backoff (`retries: 2`, `retryDelayMs: 250` by default; both
  overridable per call). `4xx` responses other than `429` are never retried — a
  missing scope or an invalid cursor is a bug in the caller, not a transient
  failure.
- **Auth**: the API key goes into `Authorization: Bearer …`, matching
  `docs/authentication.md`. Anonymous access to the public read endpoints works
  because the header is only added when `apiKey` is set.
- **`fetch`**: the global `fetch` (Node 18+, browsers, workers) is used unless you
  inject your own via `new SorolensClient({ fetch })` — that is also how the unit
  tests drive the client.
- **Pagination**: only endpoints that declare a `cursor` query parameter can be
  paginated; `paginate()` throws for anything else instead of silently returning
  a partial list.

## Regenerating

```bash
pnpm --filter @sorolens/ts-sdk gen      # rewrites src/generated/{types,operations}.ts
pnpm --filter @sorolens/ts-sdk check    # fails when the committed files are stale
pnpm --filter @sorolens/ts-sdk build    # tsc
pnpm --filter @sorolens/ts-sdk test     # vitest
```

Commit the regenerated files together with any change to `docs/openapi.yaml`; the
CI job **TypeScript SDK up-to-date** runs `check` and fails when they drift.

`src/generated/types.ts` maps every component schema it understands to an
`interface` and records how many it mapped exactly in its header; anything the
simple JSON-Schema mapper cannot express becomes a type alias, so the fallback is
visible in review rather than silent.
