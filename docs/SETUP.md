# Setup

How to self-host Lorica: run it locally, connect it to your own GitHub App, and deploy it. To use the hosted version instead, just [install the GitHub App](https://github.com/apps/lorica-akshay). Back to the [README](../README.md).

## Contents

- [Prerequisites](#prerequisites)
- [Quick start](#quick-start)
- [GitHub setup](#github-setup)
- [Configuration](#configuration)
- [Development](#development)
- [Security and deployment notes](#security-and-deployment-notes)

## Prerequisites

- Node.js 20 or later
- pnpm 9 (the version pinned by this repository)
- Docker Engine with Docker Compose
- Git, available to the worker process for temporary repository checkouts
- A GitHub App and a GitHub OAuth App
- An [OpenRouter](https://openrouter.ai/) API key with access to the default model (`DEFAULT_LLM_MODEL` in `packages/llm/src/providers.ts`, or `LLM_MODEL`)

## Quick start

### 1. Install dependencies and start local infrastructure

```bash
pnpm install
docker compose up -d
```

This starts PostgreSQL on `5432`, Redis on `6379`, and Neo4j on `7474` (Browser) and `7687` (Bolt). Default Docker credentials are intended for local development only.

### 2. Configure the services

Copy `.env.example` to `.env` at the repository root and fill in the values. Every workspace, and Prisma, reads this one file; `pnpm dev` loads it before starting each workspace, so relative paths resolve from the repository root.

```bash
cp .env.example .env
```

Keep the GitHub App private key outside version control; `*.pem` is already ignored. `GITHUB_PRIVATE_KEY_PATH` may be absolute or relative to the repository root when using `pnpm dev`.

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
- **Repository permissions:** Contents: Read; Pull requests: Read; Issues: Write; Commit statuses: Read and write

The worker uses the installation token to list PR files, read pull-request details and the repository's `.lorica.yaml`, clone the repository at the head SHA, create or update its pull-request comment, and set the `Lorica` merge-gate commit status. Without the commit-status permission, reviews still run and the comment says the gate could not be set. Install the app only on repositories Lorica is authorized to review.

For local webhook testing, expose the API through an HTTPS tunnel and use the tunnel URL as the webhook URL. Do not use an unauthenticated public tunnel for a long-lived deployment.

### GitHub OAuth App

Create a separate OAuth App for dashboard sign-in:

- **Authorization callback URL:** `http://localhost:3001/api/auth/callback/github` for local development, or `https://<your-web-domain>/api/auth/callback/github` in production.
- Copy its client ID and client secret to `GITHUB_ID` and `GITHUB_SECRET`.

The dashboard requests `read:user`, `user:email`, `repo`, and `read:org` scopes. It currently displays persisted pull requests only when the repository owner login matches the signed-in GitHub login.

## Configuration

| Variable | Required | Used by | Description |
| --- | --- | --- | --- |
| `DATABASE_URL` | Yes | API, worker, Prisma | PostgreSQL connection string. |
| `REDIS_URL` | Yes | API, worker | Redis connection used by BullMQ. Defaults to `redis://localhost:6379` only when omitted. |
| `NEO4J_URI` | Yes | Worker | Neo4j Bolt endpoint. |
| `NEO4J_USER` | Yes | Worker | Neo4j username. |
| `NEO4J_PASSWORD` | Yes | Worker | Neo4j password. |
| `WEBHOOK_SECRET` | Yes | API | Shared secret used to validate `X-Hub-Signature-256`. |
| `GITHUB_APP_ID` | Yes | API, worker | GitHub App ID. The API uses it to redeliver failed webhooks. |
| `GITHUB_PRIVATE_KEY_PATH` | Yes | Worker | Path to the GitHub App PEM private key. |
| `OPENROUTER_API_KEY` | Yes | Worker | API key for structured LLM reviews. |
| `LLM_MODEL` | No | Worker | OpenRouter model ID; must support JSON-schema output. Defaults to `nvidia/nemotron-3-ultra-550b-a55b:free`. |
| `LLM_SETTINGS_ENCRYPTION_KEY` | For custom models | API, worker | Encrypts API keys users save under **Settings → Review model**. Use the same value on both services (e.g. `openssl rand -base64 32`); changing it invalidates saved keys. |
| `LLM_ALLOW_PRIVATE_BASE_URLS` | No | API, worker | `true` lets saved models point at private or loopback addresses (Ollama, llama.cpp on your network). Allowed by default outside production; blocked in production unless set. |
| `REVIEW_DIFF_TOKENS_PER_CHUNK` | No | Worker | Estimated diff tokens per LLM request. Larger PRs are split into several requests. Defaults to `16000`. |
| `REVIEW_TRACE_TOKENS_PER_CHUNK` | No | Worker | Estimated graph-trace tokens per LLM request. Defaults to `3000`. |
| `REVIEW_MAX_CHUNKS` | No | Worker | Maximum LLM requests per review; changes beyond this are listed as not fully reviewed. Defaults to `8`. |
| `REVIEW_MAX_DESCRIPTION_CHARS` | No | Worker | PR description characters sent to the model. Defaults to `2000`. |
| `API_ACCESS_TOKEN` | Production | API | Shared token required for `/api/*` routes in production. |
| `LORICA_API_URL` | Yes | Web | Server-only base URL for the Express API. |
| `LORICA_WORKER_URL` | No | API, Web | Worker service URL; accepted PR webhooks and dashboard visits request its `/health` endpoint to wake it. |
| `LORICA_API_TOKEN` | Production | Web | Must equal `API_ACCESS_TOKEN`. |
| `WEB_ORIGIN` | Recommended | API | Comma-separated CORS allowlist; defaults to `http://localhost:3001`. |
| `PORT` | No | API | API listener port; defaults to `5000`. |
| `GITHUB_ID` / `GITHUB_SECRET` | Yes | Web | GitHub OAuth client credentials. |
| `NEXTAUTH_SECRET` | Yes | Web | Secret used to sign NextAuth JWTs. |
| `NEXTAUTH_URL` | Yes | Web | Canonical dashboard URL. |
| `NEXT_PUBLIC_GITHUB_APP_NAME` | Recommended | Web | GitHub App slug used by the install experience. |
| `INDEX_QUEUE_NAME` | No | Worker | Code-index queue name; defaults to `code-index`. Useful for isolated smoke tests. |
| `LOG_INDEX_DETAILS`, `LOG_INDEX_AST`, `LOG_CODE_GRAPH` | No | Worker | Set to `true` to increase code-indexer diagnostics. |

### Review models

Reviews use the deployment's OpenRouter model (`LLM_MODEL`) unless a user picks their own under **Settings → Review model**: OpenRouter, OpenAI, Anthropic, Hugging Face, Ollama, or any OpenAI-compatible server (llama.cpp, LM Studio, vLLM). Saving runs a test review on a small synthetic diff and refuses models that cannot return review JSON or whose context window is too small; diff chunks are then sized to the model's context window. Settings apply to pull requests whose repository owner matches the user's GitHub login, and a local model's base URL must be reachable from the worker, not from your browser. Validate response-schema compatibility before changing the default model.

## Development

| Command | Description |
| --- | --- |
| `pnpm dev` | Start the web app, API, and workers through Turborepo. |
| `pnpm build` | Build all configured workspaces. |
| `pnpm check-types` | Run workspace type checks where defined. |
| `pnpm lint` | Run workspace lint scripts where defined. |
| `pnpm format` | Format TypeScript, TSX, and Markdown files with Prettier. |
| `pnpm test` | Run unit tests. |
| `pnpm test:integration` | Run webhook intake and review processing tests against PostgreSQL and Redis. |
| `pnpm test:index` | Run the code-indexer smoke test; requires Redis and a usable Git repository. |
| `(cd packages/db && pnpm exec prisma migrate dev)` | Create and apply a development migration. |
| `(cd packages/db && pnpm exec prisma migrate deploy)` | Apply existing migrations without creating a new one. |
| `(cd packages/db && pnpm exec prisma generate)` | Regenerate the Prisma client. |
| `(cd packages/db && pnpm exec prisma studio)` | Open Prisma Studio. |

`pnpm test:integration` truncates tables, so it refuses to run unless `DATABASE_URL` names a database containing `test`. Locally:

```bash
docker exec lorica-psql createdb -U postgres lorica_test
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/lorica_test?schema=public"
pnpm db:migrate && pnpm test:integration
```

CI runs both suites, with PostgreSQL and Redis service containers for the integration tests.

`pnpm test:index` creates `apps/worker/.artifacts/index-graph.json`, which is ignored by Git. Set `INDEX_TEST_REPOSITORY_URL` and `INDEX_TEST_BRANCH` to exercise a different repository and branch.

## Security and deployment notes

- Use unique, high-entropy values for `WEBHOOK_SECRET`, `API_ACCESS_TOKEN`, and `NEXTAUTH_SECRET`; inject them through a secret manager instead of committing environment files.
- Serve the API and dashboard over HTTPS. Restrict the API CORS allowlist with `WEB_ORIGIN`; do not use a wildcard origin in production.
- Keep PostgreSQL, Redis, and Neo4j on private networks. Do not publish the local Docker Compose ports directly to the internet.
- Restrict GitHub App installation to intended repositories. The worker clones code and sends PR patches plus limited code-graph context to the configured model provider, so ensure this data flow meets your organization's security and data-handling requirements.
- Run API and workers as separate processes or deployments in production, each with least-privilege network access. The worker needs outbound access to GitHub, the model provider, Redis, PostgreSQL, and Neo4j.
- The API and worker images run `prisma migrate deploy` before starting, so a release brings the schema up to date; if a migration fails, the container exits and the previous release keeps serving. A database whose schema was changed outside migrations (e.g. with `prisma db push`) fails this step; check with `prisma migrate status` and resolve with `prisma migrate resolve` before deploying. Back up PostgreSQL and Neo4j before schema or service upgrades.
