import { enqueueReview } from "@lorica/queue";
import { processReview } from "./reviewProcessor";
import { findDueReviewJobs, hasOutstandingReviews } from "./reviewJobs";

const DISPATCH_INTERVAL_MS = 60_000;
const DISPATCH_BATCH = 20;

// Render's free tier stops a service after 15 minutes without inbound HTTP
// traffic, even mid-review. While reviews are owed (including retries waiting
// on a backoff), the worker requests its own public URL to stay up.
const KEEP_ALIVE_INTERVAL_MS = 5 * 60_000;

let dispatching = false;

/**
 * Hands every due review job to the queue. Covers jobs whose enqueue failed,
 * retries whose backoff elapsed, and jobs whose worker died mid-review. When
 * Redis is unreachable the job runs in this process instead.
 */
export async function dispatchDueReviews({
  enqueue = enqueueReview,
  runInline = processReview,
}: {
  enqueue?: (reviewJobId: number, attempt: number) => Promise<unknown>;
  runInline?: (reviewJobId: number) => Promise<unknown>;
} = {}): Promise<void> {
  if (dispatching) return;
  dispatching = true;
  try {
    const due = await findDueReviewJobs(DISPATCH_BATCH);
    for (const job of due) {
      try {
        await enqueue(job.id, job.attempts);
      } catch (error) {
        const errorType = error instanceof Error ? error.name : "unknown";
        console.warn(
          `[worker] stage=dispatch.enqueue_failed job=${job.id} error_type=${errorType} fallback=inline`,
        );
        await runInline(job.id);
      }
    }
    if (due.length > 0) {
      console.info(`[worker] stage=dispatch.completed jobs=${due.length}`);
    }
  } catch (error) {
    const errorType = error instanceof Error ? error.name : "unknown";
    console.error(`[worker] stage=dispatch.failed error_type=${errorType}`);
  } finally {
    dispatching = false;
  }
}

async function keepAlive(): Promise<void> {
  const publicUrl = process.env.RENDER_EXTERNAL_URL;
  if (!publicUrl) return;
  try {
    if (!(await hasOutstandingReviews())) return;
    await fetch(`${publicUrl}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    console.info("[worker] stage=keep_alive.pinged reason=outstanding_reviews");
  } catch (error) {
    const errorType = error instanceof Error ? error.name : "unknown";
    console.warn(`[worker] stage=keep_alive.failed error_type=${errorType}`);
  }
}

export function startDispatcher(): void {
  void dispatchDueReviews();
  setInterval(() => void dispatchDueReviews(), DISPATCH_INTERVAL_MS);
  setInterval(() => void keepAlive(), KEEP_ALIVE_INTERVAL_MS);
  console.info("[worker] stage=dispatcher.ready");
}
