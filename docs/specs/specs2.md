# API reliability changes

## Problem addressed

All dashboard data views use the authenticated `GET /api/pulls` proxy. The
proxy previously returned a 500 whenever `LORICA_API_URL` or
`LORICA_API_TOKEN` was absent. The existing local configuration instead used
`NEXT_PUBLIC_API_URL` and did not define an API token; the Express API also
returned 500 when `API_ACCESS_TOKEN` was absent. As a result, every frontend
view that loads pull-request data failed before the database query ran.

## Implemented changes

- The Next.js proxy now prefers `LORICA_API_URL`, supports the existing
  `NEXT_PUBLIC_API_URL`, and defaults locally to `http://localhost:5000`.
- The proxy only sends `x-lorica-api-token` when `LORICA_API_TOKEN` is set.
- The Express API permits unauthenticated `/api` requests only outside of
  production when `API_ACCESS_TOKEN` is not configured. Production continues
  to require the shared token and returns `503` for missing server
  configuration rather than an application-error `500`.
- The Express listener now honors `PORT` and falls back to `5000`.
- The web environment example documents the proxy URL and shared-token
  settings.
- The checked-in `20260818190000_add_dashboard_fields` migration was applied
  to the local database. It adds the `PullRequest.title`,
  `PullRequest.author`, `ReviewJob.commentsCount`, and
  `ReviewJob.completedAt` columns required by the endpoint.

## Production configuration

Set these two values to the same, long random secret:

```dotenv
# apps/api/.env
API_ACCESS_TOKEN=your-shared-secret

# apps/web/.env.local
LORICA_API_URL=https://your-api-host
LORICA_API_TOKEN=your-shared-secret
```

Local development needs only an API URL; when no token is configured, the API
accepts local dashboard requests in non-production mode.

## Verification

- `pnpm --filter web build` completes successfully.
- A local request to `GET /api/pulls?owner=smoke-test` returns `200` with an
  empty data response after the migration is applied.
