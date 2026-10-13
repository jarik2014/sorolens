# `apps/web` — Sorolens dashboard

Next.js (App Router) front end of Sorolens: the contract explorer, watchdog reports, the live
event stream and the notification playground. It talks to the Sorolens API through
`NEXT_PUBLIC_API_URL` and lives in this pnpm workspace next to `apps/api`.

## Running it

Run these from `apps/web` (dependencies are installed once, at the repository root):

```bash
pnpm install          # from the repository root
pnpm dev              # dev server on http://localhost:3000
pnpm build            # production build (.next/)
pnpm start            # serve the production build
pnpm lint             # next lint
pnpm typecheck        # tsc --noEmit
pnpm test             # vitest run --environment jsdom
pnpm test:e2e         # playwright test
```

The dashboard expects the API at `http://localhost:8080`; start `apps/api` separately or point
`NEXT_PUBLIC_API_URL` somewhere else.

## Environment variables

`.env.example` currently ships only the first two entries — copy it to `.env.local`
(`cp .env.example .env.local`) and add the rest as needed. Variables prefixed with
`NEXT_PUBLIC_` are compiled into the browser bundle; everything else stays server-side.

| Variable | What it does | Read in |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | Base URL of the API client (falls back to `http://localhost:8080`) | `lib/api.ts`, `hooks/useEventStream.ts`, `hooks/useSubscription.ts` |
| `NEXT_PUBLIC_SITE_URL` | Canonical base URL for the sitemap (falls back to `http://localhost:3000`) | `app/sitemap.ts` |
| `NEXT_PUBLIC_APP_URL` | Absolute URL used in `robots.txt` (falls back to the site URL) | `app/robots.ts` |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry DSN; error reporting stays off when unset | `instrumentation-client.ts` |
| `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` | Plausible domain; analytics stay off when unset | `components/PlausibleAnalytics.tsx` |
| `NEXT_PUBLIC_PWA_ENABLED` | Enables the service worker in development when set to exactly `"true"`; production builds always enable it | `next.config.ts` |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web Push keys served by the push routes (server-only) | `app/api/push/*` |
| `PUSH_INTERNAL_SECRET` | Shared secret checked by the subscribe route — an empty value disables that check, so always set it in production | `app/api/push/subscribe/route.ts` |
| `API_PORT` | Port that the E2E run feeds to the dev server as its API URL (default `8080`) | `playwright.config.ts` |
| `CI`, `NODE_ENV` | Set by CI and the runtime; they only change test/build behaviour | `playwright.config.ts`, `next.config.ts` |

## Route map

Route groups in parentheses are not part of the URL — `app/(app)/contracts/page.tsx` is served
at `/contracts`.

| URL | File |
|---|---|
| `/` | `app/page.tsx` |
| `/compare` | `app/(app)/compare/page.tsx` |
| `/contracts`, `/contracts/[id]`, `/contracts/new` | `app/(app)/contracts/…` |
| `/events`, `/events/live` | `app/(app)/events/…` |
| `/groups`, `/groups/[id]` | `app/(app)/groups/…` |
| `/invocations` | `app/(app)/invocations/page.tsx` |
| `/live` | `app/(app)/live/page.tsx` |
| `/playground` | `app/(app)/playground/page.tsx` |
| `/rules` | `app/(app)/rules/page.tsx` |
| `/settings` | `app/(app)/settings/page.tsx` |
| `/watchdog`, `/watchdog/[id]`, `/watchdog/notifications`, `/watchdog/reports` | `app/(app)/watchdog/…` |
| `/watchlist` | `app/(app)/watchlist/page.tsx` |
| `/offline-alerts` | `app/offline-alerts/page.tsx` |
| `GET /api/push/vapid-public-key`, `POST /api/push/subscribe` | `app/api/push/…/route.ts` |

## Tests and the E2E mock strategy

Unit tests run through Vitest (`pnpm test`). End-to-end specs live in
`apps/web/tests/e2e/*.spec.ts` and run with Playwright: `playwright.config.ts` starts
`pnpm dev --port 3000` with `NEXT_PUBLIC_API_URL=http://localhost:$API_PORT`, so a test run
never needs a real API.

Requests are intercepted by `apps/web/tests/e2e/helpers.ts`:

- `defaultHandlers()` maps path substrings of `**/api/v1/**` requests to canned JSON;
- `mockApi(page, overrides)` installs those handlers and lets a test override individual paths;
- `blockApi(page)` fails every API request, for offline and error states.

Add a new endpoint to `defaultHandlers()` (or pass an override to `mockApi`) instead of hitting
the network. With `CI` set, Playwright switches to the `github` reporter, retries twice and uses
a single worker.

## Adding a page

1. Add `app/(app)/<name>/page.tsx` — or `app/<name>/page.tsx` for a route outside the shared app
   shell. Route groups such as `(app)` only group layouts; they never appear in the URL.
2. Export a default React component. Server components are the default; add `"use client"` only
   when the page needs hooks or browser state.
3. Add a `layout.tsx` beside it when the page needs shared chrome.
4. Fetch data through `lib/api.ts`; SWR (`swr`) is the data library used in this package.
5. Add a spec under `tests/e2e/` for anything that talks to the API, and link the page from the
   existing navigation.

See `CONTRIBUTING.md` for the repository-wide workflow.
