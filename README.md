# Lorica

[![CI](https://github.com/Akshayshahi900/Lorica/actions/workflows/ci.yml/badge.svg)](https://github.com/Akshayshahi900/Lorica/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

**GitHub App that reviews pull requests with an LLM, using a code graph of the PR to see beyond the diff.**

Lorica reviews every push to a pull request, posts one structured review comment with severity, category, code context and a suggested fix, and sets a `Lorica` commit status that can block merging. A Next.js dashboard shows review history and holds per-account review settings.

Lorica is **live**: install the hosted GitHub App and it starts reviewing right away. You can also **self-host** the whole stack with Docker Compose and your own GitHub App and model ([setup guide](docs/SETUP.md)).

**[Install the hosted GitHub App](https://github.com/apps/lorica-akshay)** · **[Open the dashboard](https://lorica-web-sigma.vercel.app/)** · **[Self-host it](docs/SETUP.md)**

![Lorica review comment with typed findings](docs/images/review_1.png)

![Dashboard overview — recent reviews](docs/images/dashboard_overview1.png)

<details>
<summary>More screenshots</summary>

![Lorica review comment catching broken image paths](docs/images/review_2.png)

![Lorica landing page hero](docs/images/landing1.png)

![Lorica review preview on the landing page](docs/images/landing2.png)

![How Lorica works](docs/images/landing3.png)

![Dashboard overview — metrics and activity](docs/images/dashboard_overview2.png)

![Pull request review history](docs/images/dashboard_pr1.png)

![Connected repositories](docs/images/dashboard_repo1.png)

![Account and bot settings](docs/images/dashboard_settings1.png)

</details>

## Tech stack

**Language**

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-5FA04E?style=for-the-badge&logo=nodedotjs&logoColor=white)

**Frontend**

![Next.js](https://img.shields.io/badge/Next.js_14-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)
![React](https://img.shields.io/badge/React-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)
![NextAuth](https://img.shields.io/badge/NextAuth-000000?style=for-the-badge&logo=auth0&logoColor=white)

**Backend and queues**

![Express](https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white)
![BullMQ](https://img.shields.io/badge/BullMQ-E0234E?style=for-the-badge&logo=redis&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-FF4438?style=for-the-badge&logo=redis&logoColor=white)
![Zod](https://img.shields.io/badge/Zod-3E67B1?style=for-the-badge&logo=zod&logoColor=white)

**Data**

![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-2D3748?style=for-the-badge&logo=prisma&logoColor=white)
![Neo4j](https://img.shields.io/badge/Neo4j-4581C3?style=for-the-badge&logo=neo4j&logoColor=white)
![Tree-sitter](https://img.shields.io/badge/Tree--sitter-1F6FEB?style=for-the-badge)

**AI and integrations**

![OpenRouter](https://img.shields.io/badge/OpenRouter-6566F1?style=for-the-badge&logo=openrouter&logoColor=white)
![Anthropic](https://img.shields.io/badge/Anthropic-191919?style=for-the-badge&logo=anthropic&logoColor=white)
![Ollama](https://img.shields.io/badge/Ollama-000000?style=for-the-badge&logo=ollama&logoColor=white)
![GitHub Apps](https://img.shields.io/badge/GitHub_App_+_Octokit-181717?style=for-the-badge&logo=github&logoColor=white)

**Infrastructure and tooling**

![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![Turborepo](https://img.shields.io/badge/Turborepo-EF4444?style=for-the-badge&logo=turborepo&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-F69220?style=for-the-badge&logo=pnpm&logoColor=white)
![GitHub Actions](https://img.shields.io/badge/GitHub_Actions-2088FF?style=for-the-badge&logo=githubactions&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white)
![Render](https://img.shields.io/badge/Render-46E3B7?style=for-the-badge&logo=render&logoColor=black)

## Engineering highlights

- **Reviews are never lost or duplicated.** PostgreSQL is the source of truth and Redis only carries attempts. Webhook deliveries are deduplicated in the same transaction as their effects, each commit has at most one review job, and a worker must hold a lease token to publish. A reconciler redelivers webhooks GitHub failed to deliver, so a sleeping API or a Redis outage delays reviews instead of dropping them.
- **Only the current head publishes.** Out-of-order webhooks can't move the PR backwards. A newer push supersedes in-flight reviews, and a worker re-checks with GitHub that its commit is still the head before writing the comment.
- **Context beyond the diff.** The worker checks out the PR head and indexes JS/TS sources into a Neo4j graph scoped to that PR and commit. One-hop relationships from changed files (callers, imports) go to the model as evidence, keeping prompts small and predictable.
- **Validated LLM output.** The model must return JSON that passes a Zod schema before anything is posted. Severity floors and finding caps are enforced after the model answers, so they hold regardless of what it returns.
- **Token-aware chunking.** Lockfiles, generated and vendored files are filtered out, and large PRs are split into chunks sized to the selected model's context window.
- **Bring your own model.** Users can pick OpenRouter, OpenAI, Anthropic, Hugging Face, Ollama or any OpenAI-compatible server. Saving runs a test review and rejects models that can't produce valid review JSON. API keys are encrypted at rest.
- **Configurable as code.** A `.lorica.yaml` read from the PR's *base* commit layers on top of organization settings, so a PR can't loosen its own review.

## Benchmark

Lorica was tested on **27 real bugs** from 7 popular open-source projects (Vue, NestJS, Vite, Svelte, Zod, TanStack Query, React Router). Each case is a merged bug-fix PR with its patch reversed, so the diff reintroduces the bug the maintainers fixed. The PR title, description and tests are withheld so nothing gives the bug away.

| Metric | Result |
| --- | --- |
| Bugs identified (finding describes the actual defect) | **22 / 27 (81%)** |
| Bugs flagged (finding on the buggy lines) | 26 / 27 (96%) |
| Valid structured responses | 27 / 27 (100%) |
| Median review time | 33s |
| Findings per review | 1.4 on average |

These results use the free default model with graph context off, so they measure the diff-only pipeline. Every case, the method and its caveats are in [benchmark/REPORT.md](benchmark/REPORT.md). Reproduce with `pnpm benchmark collect && pnpm benchmark run && pnpm benchmark judge`.

## How it works

```text
                         ┌──────────────────────────────┐
                         │          GitHub App          │
                         │  pull_request webhooks       │
                         └──────────────┬───────────────┘
                                        │ signed request
                                        v
┌──────────────┐              ┌───────────────────┐              ┌──────────────┐
│ Next.js web  │──server-side─▶│ Express API       │──enqueue─────▶│ Redis/BullMQ │
│ dashboard    │    request    │                   │              └──────┬───────┘
└──────┬───────┘              └─────────┬─────────┘                     │
       │ GitHub OAuth                    │                               v
       v                                 v                     ┌──────────────────┐
┌──────────────┐                 ┌──────────────┐               │ Worker           │
│ GitHub OAuth │                 │ PostgreSQL   │◀──────────────│ review + index   │
└──────────────┘                 └──────────────┘               └──────┬─────┬─────┘
                                                                         │     │
                                                                         v     v
                                                               ┌───────────┐ ┌───────────┐
                                                               │ Neo4j     │ │ LLM       │
                                                               │ code graph│ │ provider  │
                                                               └───────────┘ └───────────┘
```

1. GitHub sends a signed `pull_request` webhook. The API verifies it, records the PR and a review job in PostgreSQL, and enqueues the job. GitHub gets a fast response.
2. The worker gets an installation token, fetches the PR files, and checks out the head SHA in a temporary directory.
3. JS/TS sources are indexed into Neo4j, scoped to that PR and commit.
4. Changed-file patches plus one-hop graph evidence go to the configured model. The JSON response is validated with Zod.
5. Lorica creates the PR's review comment, or edits it in place on later pushes, sets the `Lorica` commit status, and records the result.

## Review settings

Profiles (`quiet`, `chill`, `assertive`), team guidelines, per-path instructions, workflow filters and the merge gate are configured in the dashboard or per repository:

```yaml
# .lorica.yaml
profile: assertive
guidelines: |
  - Use the shared logger, never console.log, in services.
pathInstructions:
  - path: "src/api/**"
    instructions: Every handler validates its input with zod and checks permissions.
mergeGate:
  enabled: true
  blockOn: high
```

See [docs/REVIEW_SETTINGS.md](docs/REVIEW_SETTINGS.md) for every option.

## Self-host it

The hosted version runs the dashboard on Vercel and the API and worker on Render. To run your own copy:

```bash
pnpm install
docker compose up -d                                  # PostgreSQL, Redis, Neo4j
cp .env.example .env                                  # then fill in the secrets
pnpm db:migrate
pnpm dev                                              # web :3001, API :5000, workers
```

You also need a GitHub App, a GitHub OAuth App and an OpenRouter API key. The [setup guide](docs/SETUP.md) walks through all of it.

## Documentation

- [Setup](docs/SETUP.md): prerequisites, environment variables, GitHub App and OAuth configuration, development commands, deployment notes
- [Review settings](docs/REVIEW_SETTINGS.md): profiles, `.lorica.yaml`, merge gate, post-merge actions
- [Operations](docs/OPERATIONS.md): delivery guarantees, failure recovery, scaling, HTTP API

## Repository layout

```text
apps/
  api/                 Express webhook and dashboard-data API
  web/                 Next.js 14 dashboard and GitHub OAuth
  worker/              BullMQ review worker and Neo4j code indexer
packages/
  context/             Diff and graph-context assembly
  db/                  Prisma schema, migrations, and shared client
  llm/                 Structured review prompt and model providers
  queue/               BullMQ queues and Redis connection
  types/               Shared Zod schemas and TypeScript types
  vcs/                 GitHub App auth, PR retrieval, and comment rendering
```

## Limitations

- The code graph indexes JavaScript and TypeScript only, and graph evidence is limited to one hop from changed files.
- Lorica posts one summary comment per PR, not inline review comments on individual lines.
- The dashboard shows pull requests whose repository owner matches the signed-in GitHub login. It doesn't yet model organization membership for review history.
- Editing a PR's title (e.g. removing `WIP`) doesn't trigger a review until the next push or reopen.

## License

Licensed under the [Apache License 2.0](LICENSE).
