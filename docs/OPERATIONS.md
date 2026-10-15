# Operations

How Lorica guarantees delivery, recovers from failures, and scales. Back to the [README](../README.md).

## Contents

- [Service responsibilities](#service-responsibilities)
- [Review delivery guarantees](#review-delivery-guarantees)
- [Recovery](#recovery)
- [HTTP API](#http-api)

## Service responsibilities

| Component | Responsibility | Scaling notes |
| --- | --- | --- |
| API | Verifies webhooks, persists state, and exposes dashboard data. | Scale horizontally behind a load balancer; all instances need the same secrets. |
| Worker | Runs review and code-index jobs. | Run separately from the API in production. It has review concurrency of 2 and code-index concurrency of 2 per process. |
| PostgreSQL | Stores repositories, pull requests, and review-job state. | Back up regularly and use managed storage in production. |
| Redis | BullMQ transport for review and index attempts. | Losing review data is recoverable: the dispatcher re-sends due jobs from PostgreSQL. |
| Neo4j | Stores a PR-scoped graph keyed by repository URL and `pull/<PR number>`. | Persist data and secure Bolt access; graph refresh replaces only the relevant PR graph. |

`GET /health` is the API liveness endpoint and returns `OK`. Neo4j credentials, GitHub App credentials, and the LLM key must be available to every worker replica.

## Review delivery guarantees

PostgreSQL, not Redis, is the source of truth for reviews. Redis only carries attempts to the worker, so losing it delays reviews but never drops them.

### Deduplication

- Every webhook delivery's `X-GitHub-Delivery` id is stored in `WebhookDelivery` in the same transaction as the changes it caused. A redelivery (manual, from the reconciler, or GitHub retrying a timeout) is acknowledged with `200` and changes nothing; concurrent copies of one delivery are serialised on the primary key. A delivery that fails rolls back entirely, so its redelivery is processed normally.
- Each commit has at most one `ReviewJob` (unique on pull request and head SHA), whichever deliveries mention it. Queue entries are keyed by job and attempt, so dispatching the same attempt twice is a no-op, and a worker must atomically claim a job before running it.
- A PR has at most one Lorica comment: the latest bot comment starting with the hidden `<!-- lorica-review -->` marker. A review of a newer commit edits that comment instead of posting another.
- The comment also carries a hidden `<!-- lorica-review-job:<id> -->` marker naming the job it shows; an attempt that finds its own job's marker there does not write it again.

### Only the current head publishes

- Deliveries may arrive out of order. The PR's head is moved only by an event whose `pull_request.updated_at` is not older than the one recorded, and a stale event queues nothing.
- A newer head supersedes every unfinished review of other commits, including one in progress.
- A worker claims a job with a fresh lease token. Before posting it re-checks that it still holds the lease, that the job has not been superseded, that its commit is the recorded head, and that GitHub still reports that commit as the head. If GitHub reports a different head, the job is superseded and a review of the real head is queued. Results, retries and failures are written only while the token still owns the job.

## Recovery

| Failure | Recovery |
| --- | --- |
| API asleep or failing when GitHub delivers | GitHub does not retry webhooks. On boot and on `POST /api/internal/reconcile`, the API redelivers `pull_request` deliveries from the last three days that never got a `2xx` (up to six attempts each) and wakes the worker if reviews are owed. `.github/workflows/reconcile.yml` calls it every two hours using the repository secrets `LORICA_API_URL` and `LORICA_API_TOKEN`. |
| Database asleep | The intake transaction is retried three times before returning `500`, which the reconciler then redelivers. |
| Redis down | The job is already stored. The worker's dispatcher re-sends due jobs every minute and runs them in-process when Redis is unreachable. |
| Worker crashes, redeploys or sleeps mid-review | The lease (renewed every minute) lapses within three minutes and the job is claimed again. |
| Transient failure (LLM, GitHub, Neo4j) | Retried from the database after 1, 2, 5, 15, 30, 60, 120 and 240 minutes (nine attempts). A 404/410 from GitHub fails the job at once. A new event for the commit restarts a failed review. |
| Worker would sleep while a retry waits | While reviews are owed, the worker requests its own `RENDER_EXTERNAL_URL` to stay up on Render's free tier. |

## HTTP API

| Method and path | Authentication | Description |
| --- | --- | --- |
| `GET /health` | None | Returns `OK` when the Express process is running. |
| `POST /webhooks/github` | GitHub HMAC signature | Accepts GitHub App webhooks. Only supported `pull_request` actions enqueue work. |
| `GET /api/pulls?owner=<login>` | `x-lorica-api-token` in production | Returns recorded pull requests for the requested owner, newest first, with repository data and the latest review job. |
| `GET/PUT/DELETE /api/settings/review?owner=<login>` | `x-lorica-api-token` in production | Reads, saves (a `.lorica.yaml`-shaped JSON body) or resets an owner's review settings. The dashboard authorizes the owner before calling it. |
| `POST /api/internal/reconcile` | `x-lorica-api-token` in production | Redelivers failed `pull_request` webhooks and wakes the worker when reviews are owed. |

The dashboard calls `GET /api/pulls` through its authenticated Next.js route (`apps/web/app/api/pulls/route.ts`), so the shared API token never reaches browser code. In non-production environments the API allows `/api/*` requests without `API_ACCESS_TOKEN` to simplify local setup. Production returns `503` for those routes until the token is configured.

```bash
curl \
  -H "x-lorica-api-token: $API_ACCESS_TOKEN" \
  "https://api.example.com/api/pulls?owner=octocat"
```
