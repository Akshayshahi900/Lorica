import { getAppOctokit } from "@lorica/vcs";
import { prisma, ReviewJobStatus } from "@lorica/db";
import { wakeWorker } from "./controllers/wakeWorker";

// GitHub only allows redelivering deliveries from the past three days.
const REDELIVERY_WINDOW_MS = 3 * 24 * 60 * 60_000;
// A delivery that keeps failing is likely a bug, not an outage; stop retrying
// it rather than redelivering it on every run for three days.
const MAX_ATTEMPTS_PER_DELIVERY = 6;
// Leave deliveries that may still be in flight to finish on their own.
const MIN_AGE_MS = 2 * 60_000;

type Delivery = {
  id: number;
  guid: string;
  delivered_at: string;
  status_code: number;
  event: string;
};

/**
 * GitHub never retries a failed webhook on its own. Any pull_request delivery
 * that never got a 2xx (API asleep past GitHub's 10s timeout, database or
 * code failure) is redelivered here; the handler is idempotent, so a delivery
 * that did land despite an error status only touches the existing job.
 */
async function redeliverFailedWebhooks(): Promise<number> {
  const octokit = getAppOctokit();
  const cutoff = Date.now() - REDELIVERY_WINDOW_MS;
  const byGuid = new Map<string, Delivery[]>();

  // Deliveries are listed newest first.
  pages: for await (const page of octokit.paginate.iterator(
    octokit.apps.listWebhookDeliveries,
    { per_page: 100 },
  )) {
    for (const delivery of page.data as Delivery[]) {
      if (Date.parse(delivery.delivered_at) < cutoff) break pages;
      if (delivery.event !== "pull_request") continue;
      const attempts = byGuid.get(delivery.guid) ?? [];
      attempts.push(delivery);
      byGuid.set(delivery.guid, attempts);
    }
  }

  let redelivered = 0;
  for (const [guid, attempts] of byGuid) {
    const succeeded = attempts.some(
      (attempt) => attempt.status_code >= 200 && attempt.status_code < 300,
    );
    if (succeeded || attempts.length >= MAX_ATTEMPTS_PER_DELIVERY) continue;

    const latest = attempts[0]!;
    if (Date.now() - Date.parse(latest.delivered_at) < MIN_AGE_MS) continue;

    try {
      await octokit.apps.redeliverWebhookDelivery({ delivery_id: latest.id });
      redelivered++;
      console.info(
        `[api] stage=reconcile.redelivered guid=${guid} previous_status=${latest.status_code}`,
      );
    } catch (error) {
      const errorType = error instanceof Error ? error.name : "unknown";
      console.warn(
        `[api] stage=reconcile.redelivery_failed guid=${guid} error_type=${errorType}`,
      );
    }
  }
  return redelivered;
}

/** Wakes the worker when the database says reviews are still owed. */
async function wakeWorkerIfReviewsOwed(): Promise<number> {
  const owed = await prisma.reviewJob.count({
    where: {
      status: { in: [ReviewJobStatus.queued, ReviewJobStatus.running] },
    },
  });
  if (owed > 0) wakeWorker();
  return owed;
}

let running: Promise<unknown> | null = null;

/** Recovers missed webhooks and stranded jobs. Concurrent calls share a run. */
export function reconcile() {
  running ??= (async () => {
    const result: Record<string, unknown> = {};
    try {
      result.redelivered = await redeliverFailedWebhooks();
    } catch (error) {
      result.redeliveryError = error instanceof Error ? error.name : "unknown";
    }
    try {
      result.owedReviews = await wakeWorkerIfReviewsOwed();
    } catch (error) {
      result.owedReviewsError = error instanceof Error ? error.name : "unknown";
    }
    console.info(`[api] stage=reconcile.completed result=${JSON.stringify(result)}`);
    return result;
  })().finally(() => {
    running = null;
  });
  return running;
}
