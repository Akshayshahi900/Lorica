# Lorica

Lorica is a GitHub App that reviews pull requests with a local LLM. When GitHub sends a pull-request webhook, Lorica stores the event, queues a review, collects the PR diff, asks the model for structured findings, and posts the resulting review back to GitHub. The web dashboard lets a signed-in GitHub user see their recorded review history and live aggregate metrics.

## What it does

- Receives `opened`, `reopened`, and `synchronize` pull-request webhooks from a GitHub App.
- Stores repositories, pull requests, and review jobs in PostgreSQL.
- Runs review work asynchronously with BullMQ and Redis.
- Fetches changed files through a GitHub App installation token.
- Sends the combined diff to an Ollama-compatible local LLM and validates the structured response with Zod.
- Posts a formatted summary and findings as a GitHub PR comment.
- Provides a Next.js dashboard authenticated with GitHub OAuth.

## Architecture

```text
GitHub App webhook
        |
        v
Express API ──> PostgreSQL (repositories, PRs, review jobs)
        |                         ^
        v                         |
Redis / BullMQ ──> review worker ─┘
        |                  |
        |                  v
        |             Ollama LLM
        v
GitHub PR comment

Next.js dashboard ──> authenticated Next.js API route ──> Express API
```

The dashboard does not use hard-coded data. Its internal API route reads the authenticated GitHub login and requests only pull requests whose repository owner matches that login. The API response includes the latest review job, finding count, completion timestamp, and PR metadata; the frontend derives the displayed metrics from those stored records.

## Repository layout

| Path | Purpose |
| --- | --- |
| `apps/web` | Next.js 14 dashboard and GitHub OAuth integration. |
| `apps/web/app/api/pulls` | Authenticated server-side proxy from the dashboard to the API. |
| `apps/api` | Express webhook/API service and Prisma database client. |
| `apps/api/src/jobs` | BullMQ queue and worker that run reviews. |
| `apps/api/src/vcs/github` | GitHub App authentication, diff retrieval, and comment posting. |
| `apps/api/src/llm` | Ollama client, prompt, schema validation, and response rendering. |
| `apps/api/prisma` | PostgreSQL schema and migration history. |
| `packages/typescript-config` | Shared TypeScript presets. |
| `docker-compose.yml` | Local PostgreSQL and Redis services. |

## Requirements

- Node.js 18 or newer (Node 20+ recommended)
- pnpm 9
- Docker and Docker Compose
- A GitHub OAuth App for dashboard sign-in
- A GitHub App configured to receive pull-request webhooks
- [Ollama](https://ollama.com/) with the configured model available (default: `qwen2.5-coder:7b`)

## Local setup

Install dependencies and start PostgreSQL and Redis:

```bash
pnpm install
docker compose up -d
```

Create `apps/api/.env`:

```dotenv
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/app"
REDIS_URL="redis://localhost:6379"
WEBHOOK_SECRET="your-github-app-webhook-secret"
GITHUB_APP_ID="your-github-app-id"
GITHUB_PRIVATE_KEY_PATH="/absolute/path/to/github-app-private-key.pem"
WEB_ORIGIN="http://localhost:3001"
API_ACCESS_TOKEN="a-long-random-shared-secret"
```

Create `apps/web/.env.local`:

```dotenv
GITHUB_ID="your-github-oauth-client-id"
GITHUB_SECRET="your-github-oauth-client-secret"
NEXTAUTH_SECRET="a-long-random-secret"
NEXTAUTH_URL="http://localhost:3001"
LORICA_API_URL="http://localhost:5000"
LORICA_API_TOKEN="a-long-random-shared-secret"
NEXT_PUBLIC_GITHUB_APP_NAME="your-github-app-slug"
```

Apply the database migrations, pull the model, and start all services:

```bash
pnpm --filter api prisma:migrate
ollama pull qwen2.5-coder:7b
pnpm dev
```

`pnpm dev` starts the web app on `http://localhost:3001`, the Express API on port `5000`, and the review worker. The API health endpoint is available at `GET http://localhost:5000/health`.

## GitHub configuration

Configure the GitHub App with pull-request webhook events and permissions sufficient to read pull requests and write issue comments. Point its webhook URL to:

```text
https://your-api-host/webhooks/github
```

For local development, expose port `5000` with a secure tunnel and use its HTTPS URL as the webhook URL. Configure the dashboard OAuth callback URL as:

```text
http://localhost:3001/api/auth/callback/github
```

## API

### `GET /health`

Returns `OK` when the Express service is running.

### `POST /webhooks/github`

Receives and validates GitHub webhooks. Only `pull_request` events with `opened`, `reopened`, or `synchronize` actions create a review job.

### `GET /api/pulls?owner=<github-login>`

Returns persisted pull requests for a repository owner, newest first. Each result includes repository metadata, PR title/author, status, and the latest review job. This endpoint requires the `x-lorica-api-token` header to match `API_ACCESS_TOKEN`; the dashboard supplies it only from its authenticated Next.js proxy at `/api/pulls`.

## Review lifecycle

1. GitHub sends a signed pull-request webhook.
2. The API upserts the repository and pull request, then creates a queued review job.
3. The BullMQ worker marks the job running, fetches the diff with an installation token, and calls Ollama.
4. The model output is validated against `ReviewResultSchema` and rendered as a GitHub comment.
5. After the comment is posted, the job and PR are marked complete and the finding count and completion time are stored.

Failed workers mark the associated review job and pull request as failed. BullMQ retries jobs according to the queue configuration.

## Development commands

| Command | Description |
| --- | --- |
| `pnpm dev` | Start the dashboard, API, and worker in development mode. |
| `pnpm build` | Build every workspace through Turborepo. |
| `pnpm check-types` | Type-check all configured workspaces. |
| `pnpm --filter api prisma:generate` | Generate the Prisma client. |
| `pnpm --filter api prisma:migrate` | Create and apply a development migration. |
| `pnpm --filter api prisma:studio` | Open Prisma Studio. |

## Current limitations

- Dashboard visibility is currently scoped to repositories whose GitHub owner login equals the signed-in login. Organization installations where the viewer is a member require an installation-to-user authorization model before they can be shown safely.
- The worker posts one summary comment per review; individual finding records are represented by the stored finding count rather than a separate comments table.
- The LLM endpoint and model are currently configured in `apps/api/src/llm/client.ts` for a local Ollama instance.

## License

This project is licensed under the [Apache License 2.0](LICENSE).
