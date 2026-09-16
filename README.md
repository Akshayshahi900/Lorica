# Lorica

**AI-assisted GitHub pull-request reviews with repository-aware context.**

Lorica is a self-hosted GitHub App that reviews pull requests asynchronously. It verifies GitHub webhooks, records review work in PostgreSQL, builds a code graph for the pull request head in Neo4j, asks an LLM for structured findings, and posts a single review summary back to the pull request. A Next.js dashboard gives signed-in GitHub users visibility into the reviews recorded for repositories they own.

## Contents

- [How it works](#how-it-works)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Quick start](#quick-start)
- [GitHub setup](#github-setup)
- [Configuration](#configuration)
- [Operations](#operations)
- [HTTP API](#http-api)
- [Development](#development)
- [Security and deployment notes](#security-and-deployment-notes)
- [Limitations](#limitations)
- [License](#license)

## How it works

1. GitHub sends a signed `pull_request` webhook for `opened`, `reopened`, or `synchronize`.
2. The API validates the signature, upserts the repository and pull request, and enqueues a review job.
3. The worker obtains a GitHub App installation token, retrieves the pull-request files and metadata, and checks out the PR head SHA in a temporary directory.
4. The worker indexes supported JavaScript and TypeScript sources (`.js`, `.jsx`, `.ts`, `.tsx`) into Neo4j, scoped to that PR and commit.
5. Changed-file patches plus one-hop graph evidence are sent to the configured OpenRouter model. The returned JSON is validated against a Zod schema.
6. Lorica renders the validated findings as one GitHub pull-request comment and records the terminal job status.

Jobs retry up to three times with exponential backoff. A terminal failure marks both the review job and its pull request as failed.

## Architecture

```text
                         ┌──────────────────────────────┐
                         │          GitHub App          │
                         │  pull_request webhooks       │
                         └──────────────┬───────────────┘
                                        │ signed request
                                        v
┌──────────────┐              ┌───────────────────┐              ┌──────────────┐
│ Next.js web  │──server-side─▶│ Express API       │──enqueue─────▶│ Redis/BullMQ │
│ dashboard    │    request    │ :5000             │              └──────┬───────┘
└──────┬───────┘              └─────────┬─────────┘                     │
       │ GitHub OAuth                    │                               v
       v                                 v                     ┌──────────────────┐
┌──────────────┐                 ┌──────────────┐               │ Worker           │
│ GitHub OAuth │                 │ PostgreSQL   │◀──────────────│ review + index   │
└──────────────┘                 └──────────────┘               └──────┬─────┬─────┘
                                                                         │     │
                                                                         v     v
                                                               ┌───────────┐ ┌───────────┐
                                                               │ Neo4j     │ │ OpenRouter│
                                                               │ code graph│ │ LLM API   │
                                                               └───────────┘ └───────────┘
```

## Prerequisites

- Node.js 20 or later
- pnpm 9 (the version pinned by this repository)
- Docker Engine with Docker Compose
- Git, available to the worker process for temporary repository checkouts
- A GitHub App and a GitHub OAuth App
- An [OpenRouter](https://openrouter.ai/) API key with access to the model configured in `packages/llm/src/client.ts`

## Quick start

### 1. Install dependencies and start local infrastructure

```bash
pnpm install
docker compose up -d
```

This starts PostgreSQL on `5432`, Redis on `6379`, and Neo4j on `7474` (Browser) and `7687` (Bolt). Default Docker credentials are intended for local development only.

### 2. Configure the services

Create a root `.env`. The root development command loads it before starting every workspace, so relative paths are resolved from the repository root.

```dotenv
# Core services
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/app"
REDIS_URL="redis://localhost:6379"
NEO4J_URI="bolt://localhost:7687"
NEO4J_USER="neo4j"
NEO4J_PASSWORD="password123"

# GitHub App: webhook verification and installation authentication
WEBHOOK_SECRET="replace-with-the-github-app-webhook-secret"
GITHUB_APP_ID="replace-with-the-github-app-id"
GITHUB_PRIVATE_KEY_PATH="./github-app-private-key.pem"

# API
PORT="5000"
WEB_ORIGIN="http://localhost:3001"
API_ACCESS_TOKEN="replace-with-a-long-random-shared-secret"

# LLM
OPENROUTER_API_KEY="replace-with-your-openrouter-api-key"
```

Keep the GitHub App private key outside version control; `*.pem` is already ignored. `GITHUB_PRIVATE_KEY_PATH` may be absolute or relative to the repository root when using `pnpm dev`.

Create `apps/web/.env.local` for the dashboard:

```dotenv
GITHUB_ID="replace-with-the-github-oauth-client-id"
GITHUB_SECRET="replace-with-the-github-oauth-client-secret"
NEXTAUTH_SECRET="replace-with-a-long-random-secret"
NEXTAUTH_URL="http://localhost:3001"

# Server-only connection from Next.js to the Express API
LORICA_API_URL="http://localhost:5000"
LORICA_API_TOKEN="replace-with-the-same-api-access-token"

# Used to form the GitHub App installation URL in the dashboard
NEXT_PUBLIC_GITHUB_APP_NAME="your-github-app-slug"
```

For Prisma commands, its checked-in configuration loads `apps/api/.env`. Put the database URL there as well:

```dotenv
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/app"
```

### 3. Apply migrations and start Lorica

```bash
(cd packages/db && pnpm exec prisma migrate deploy)
pnpm dev
```

`pnpm dev` runs the web app at [http://localhost:3001](http://localhost:3001), the API at [http://localhost:5000](http://localhost:5000), and both workers. Confirm the API is available:

```bash
curl http://localhost:5000/health
```

Expected response: `OK`.

## GitHub setup

### GitHub App

Create a GitHub App and configure:

- **Webhook URL:** `https://<your-api-domain>/webhooks/github`
- **Webhook secret:** the exact value of `WEBHOOK_SECRET`
- **Subscribe to events:** Pull requests
- **Repository permissions:** Contents: Read; Pull requests: Read; Issues: Write

The worker uses the installation token to list PR files, read pull-request details, clone the repository at the head SHA, and create a pull-request comment. Install the app only on repositories Lorica is authorized to review.

For local webhook testing, expose the API through an HTTPS tunnel and use the tunnel URL as the webhook URL. Do not use an unauthenticated public tunnel for a long-lived deployment.

### GitHub OAuth App

Create a separate OAuth App for dashboard sign-in:

- **Authorization callback URL:** `http://localhost:3001/api/auth/callback/github` for local development, or `https://<your-web-domain>/api/auth/callback/github` in production.
- Copy its client ID and client secret to `GITHUB_ID` and `GITHUB_SECRET`.

The dashboard requests `read:user`, `user:email`, `repo`, and `read:org` scopes. It currently displays persisted pull requests only when the repository owner login matches the signed-in GitHub login.

## Configuration

| Variable                                               | Required    | Used by             | Description                                                                              |
| ------------------------------------------------------ | ----------- | ------------------- | ---------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                         | Yes         | API, worker, Prisma | PostgreSQL connection string.                                                            |
| `REDIS_URL`                                            | Yes         | API, worker         | Redis connection used by BullMQ. Defaults to `redis://localhost:6379` only when omitted. |
| `NEO4J_URI`                                            | Yes         | Worker              | Neo4j Bolt endpoint.                                                                     |
| `NEO4J_USER`                                           | Yes         | Worker              | Neo4j username.                                                                          |
| `NEO4J_PASSWORD`                                       | Yes         | Worker              | Neo4j password.                                                                          |
| `WEBHOOK_SECRET`                                       | Yes         | API                 | Shared secret used to validate `X-Hub-Signature-256`.                                    |
| `GITHUB_APP_ID`                                        | Yes         | Worker              | GitHub App ID.                                                                           |
| `GITHUB_PRIVATE_KEY_PATH`                              | Yes         | Worker              | Path to the GitHub App PEM private key.                                                  |
| `OPENROUTER_API_KEY`                                   | Yes         | Worker              | API key for structured LLM reviews.                                                      |
| `API_ACCESS_TOKEN`                                     | Production  | API                 | Shared token required for `/api/*` routes in production.                                 |
| `LORICA_API_URL`                                       | Yes         | Web                 | Server-only base URL for the Express API.                                                |
| `LORICA_API_TOKEN`                                     | Production  | Web                 | Must equal `API_ACCESS_TOKEN`.                                                           |
| `WEB_ORIGIN`                                           | Recommended | API                 | Comma-separated CORS allowlist; defaults to `http://localhost:3001`.                     |
| `PORT`                                                 | No          | API                 | API listener port; defaults to `5000`.                                                   |
| `GITHUB_ID` / `GITHUB_SECRET`                          | Yes         | Web                 | GitHub OAuth client credentials.                                                         |
| `NEXTAUTH_SECRET`                                      | Yes         | Web                 | Secret used to sign NextAuth JWTs.                                                       |
| `NEXTAUTH_URL`                                         | Yes         | Web                 | Canonical dashboard URL.                                                                 |
| `NEXT_PUBLIC_GITHUB_APP_NAME`                          | Recommended | Web                 | GitHub App slug used by the install experience.                                          |
| `INDEX_QUEUE_NAME`                                     | No          | Worker              | Code-index queue name; defaults to `code-index`. Useful for isolated smoke tests.        |
| `LOG_INDEX_DETAILS`, `LOG_INDEX_AST`, `LOG_CODE_GRAPH` | No          | Worker              | Set to `true` to increase code-indexer diagnostics.                                      |

The review model is currently defined in `packages/llm/src/client.ts`. Change that source configuration deliberately and validate the response schema compatibility before deploying a different provider or model.

## Operations

### Service responsibilities

| Component  | Responsibility                                                           | Scaling notes                                                                                                          |
| ---------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| API        | Verifies webhooks, persists state, and exposes dashboard data.           | Scale horizontally behind a load balancer; all instances need the same secrets.                                        |
| Worker     | Runs review and code-index jobs.                                         | Run separately from the API in production. It has review concurrency of 2 and code-index concurrency of 2 per process. |
| PostgreSQL | Stores repositories, pull requests, and review-job state.                | Back up regularly and use managed storage in production.                                                               |
| Redis      | BullMQ transport and retry state.                                        | Use durable Redis appropriate for queued work.                                                                         |
| Neo4j      | Stores a PR-scoped graph keyed by repository URL and `pull/<PR number>`. | Persist data and secure Bolt access; graph refresh replaces only the relevant PR graph.                                |

### Health, status, and recovery

- `GET /health` is the API liveness endpoint and returns `OK`.
- BullMQ retains the most recent 100 completed jobs and 500 failed jobs per queue. Review jobs retry three times with exponential backoff beginning at five seconds.
- Review status is stored in PostgreSQL as `pending`, `processing`, `completed`, or `failed`; the latest review job is returned by the dashboard API.
- A worker restart does not erase queued jobs, provided Redis remains available. A currently active job may be retried by BullMQ according to its job settings.
- Neo4j credentials, GitHub App credentials, and the LLM key must be available to every worker replica.

## HTTP API

| Method and path                | Authentication                     | Description                                                                                                           |
| ------------------------------ | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `GET /health`                  | None                               | Returns `OK` when the Express process is running.                                                                     |
| `POST /webhooks/github`        | GitHub HMAC signature              | Accepts GitHub App webhooks. Only supported `pull_request` actions enqueue work.                                      |
| `GET /api/pulls?owner=<login>` | `x-lorica-api-token` in production | Returns recorded pull requests for the requested owner, newest first, with repository data and the latest review job. |

The dashboard calls `GET /api/pulls` through its authenticated Next.js route (`apps/web/app/api/pulls/route.ts`); do not expose the shared API token to browser code. In non-production environments the API allows `/api/*` requests without `API_ACCESS_TOKEN` to simplify local setup. Production returns `503` for those routes until the token is configured.

Example API request:

```bash
curl \
  -H "x-lorica-api-token: $API_ACCESS_TOKEN" \
  "https://api.example.com/api/pulls?owner=octocat"
```

## Development

### Useful commands

| Command                                               | Description                                                                  |
| ----------------------------------------------------- | ---------------------------------------------------------------------------- |
| `pnpm dev`                                            | Start the web app, API, and workers through Turborepo.                       |
| `pnpm build`                                          | Build all configured workspaces.                                             |
| `pnpm check-types`                                    | Run workspace type checks where defined.                                     |
| `pnpm lint`                                           | Run workspace lint scripts where defined.                                    |
| `pnpm format`                                         | Format TypeScript, TSX, and Markdown files with Prettier.                    |
| `pnpm test:index`                                     | Run the code-indexer smoke test; requires Redis and a usable Git repository. |
| `(cd packages/db && pnpm exec prisma migrate dev)`    | Create and apply a development migration.                                    |
| `(cd packages/db && pnpm exec prisma migrate deploy)` | Apply existing migrations without creating a new one.                        |
| `(cd packages/db && pnpm exec prisma generate)`       | Regenerate the Prisma client.                                                |
| `(cd packages/db && pnpm exec prisma studio)`         | Open Prisma Studio.                                                          |

`pnpm test:index` creates `apps/worker/.artifacts/index-graph.json`, which is ignored by Git. Set `INDEX_TEST_REPOSITORY_URL` and `INDEX_TEST_BRANCH` to exercise a different repository and branch.

### Repository layout

```text
apps/
  api/                 Express webhook and dashboard-data API
  web/                 Next.js 14 dashboard and GitHub OAuth
  worker/              BullMQ review worker and Neo4j code indexer
packages/
  context/             Diff and graph-context assembly
  db/                  Prisma schema, migrations, and shared client
  llm/                 Structured review prompt and OpenRouter client
  queue/               BullMQ queues and Redis connection
  types/               Shared Zod schemas and TypeScript types
  vcs/                 GitHub App auth, PR retrieval, and comment rendering
```

## Security and deployment notes

- Use unique, high-entropy values for `WEBHOOK_SECRET`, `API_ACCESS_TOKEN`, and `NEXTAUTH_SECRET`; inject them through a secret manager instead of committing environment files.
- Serve the API and dashboard over HTTPS. Restrict the API CORS allowlist with `WEB_ORIGIN`; do not use a wildcard origin in production.
- Keep PostgreSQL, Redis, and Neo4j on private networks. Do not publish the local Docker Compose ports directly to the internet.
- Restrict GitHub App installation to intended repositories. The worker clones code and sends PR patches plus limited code-graph context to OpenRouter, so ensure this data flow meets your organization’s security and data-handling requirements.
- Run API and workers as separate processes or deployments in production, each with least-privilege network access. The worker needs outbound access to GitHub, OpenRouter, Redis, PostgreSQL, and Neo4j.
- Use `prisma migrate deploy` during release deployment. Back up PostgreSQL and Neo4j before schema or service upgrades.

## Limitations

- Lorica posts one formatted summary comment per review; it does not create GitHub inline review comments for individual findings.
- The code graph currently indexes JavaScript and TypeScript source files only.
- The graph evidence is intentionally limited to one-hop relationships from changed files; it is supporting evidence, not a complete-program analysis.
- The dashboard’s ownership filter does not yet model organization membership or installation-level authorization. A signed-in user only sees stored pull requests whose repository owner login matches their GitHub login.
- The model/provider choice is source-configured rather than environment-configurable.

## License

Licensed under the [Apache License 2.0](LICENSE).
