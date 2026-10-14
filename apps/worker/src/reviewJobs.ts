import { randomUUID } from "node:crypto";
import { prisma, PullRequestStatus, ReviewJobStatus } from "@lorica/db";

// A review that has not renewed its lease within this window is presumed lost
// (worker crashed, was redeployed, or was put to sleep) and becomes due again.
export const LEASE_MS = 3 * 60_000;
export const HEARTBEAT_MS = 60_000;

// Delay before attempt n+1. Spread over ~8 hours so an outage of the LLM,
// GitHub, Neo4j or the database is outlasted rather than raced.
const RETRY_DELAYS_MS = [
  1, 2, 5, 15, 30, 60, 120, 240,
].map((minutes) => minutes * 60_000);
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

/** Failures that retrying cannot fix, such as a deleted repository. */
export class PermanentReviewError extends Error {
  name = "PermanentReviewError";
}

function dueCondition(now: Date) {
  return {
    OR: [
      { status: ReviewJobStatus.queued, nextRunAt: { lte: now } },
      { status: ReviewJobStatus.running, leaseUntil: { lt: now } },
    ],
  };
}

/** Jobs that should be running now but are not owned by a live worker. */
export function findDueReviewJobs(limit: number) {
  return prisma.reviewJob.findMany({
    where: dueCondition(new Date()),
    orderBy: { nextRunAt: "asc" },
    take: limit,
    select: { id: true, attempts: true },
  });
}

/** Whether any review is still owed, now or after a retry delay. */
export async function hasOutstandingReviews(): Promise<boolean> {
  const count = await prisma.reviewJob.count({
    where: {
      status: { in: [ReviewJobStatus.queued, ReviewJobStatus.running] },
    },
  });
  return count > 0;
}

/** The attempt that holds a job's lease; every result it writes names it. */
export type Lease = { id: number; pullRequestId: number; leaseToken: string };

/** Matches the job only while `lease` still owns it. */
function owned(lease: Lease) {
  return {
    id: lease.id,
    status: ReviewJobStatus.running,
    leaseToken: lease.leaseToken,
  };
}

/**
 * Atomically takes ownership of a due job. Returns null when the job is not
 * due or another delivery (queue duplicate, dispatcher) already holds it.
 */
export async function claimReviewJob(reviewJobId: number) {
  const now = new Date();
  const leaseToken = randomUUID();
  const claimed = await prisma.reviewJob.updateMany({
    where: { id: reviewJobId, ...dueCondition(now) },
    data: {
      status: ReviewJobStatus.running,
      leaseUntil: new Date(now.getTime() + LEASE_MS),
      leaseToken,
      attempts: { increment: 1 },
    },
  });
  if (claimed.count === 0) return null;

  const job = await prisma.reviewJob.findUniqueOrThrow({
    where: { id: reviewJobId },
    include: { pullRequest: true },
  });
  const lease = { ...job, leaseToken };
  if (job.attempts > MAX_ATTEMPTS) {
    // Only reachable when the final attempt's worker died without recording
    // a result: its lease lapsed and the dispatcher handed it out again.
    await markFailed(lease, "Review attempts exhausted");
    return null;
  }
  await prisma.pullRequest.update({
    where: { id: job.pullRequestId },
    data: { status: PullRequestStatus.processing },
  });
  return lease;
}

/**
 * Whether `lease` may publish its review: it still owns the job, nothing has
 * superseded it, and its commit is still the PR head on record.
 */
export async function canPublish(
  lease: Lease & { headSha: string },
): Promise<boolean> {
  const job = await prisma.reviewJob.findFirst({
    where: owned(lease),
    include: { pullRequest: { select: { headSha: true } } },
  });
  return job !== null && job.pullRequest.headSha === lease.headSha;
}

/** Keeps the lease alive for as long as the review is in progress. */
export function startLeaseHeartbeat(lease: Lease): () => void {
  const reviewJobId = lease.id;
  const timer = setInterval(() => {
    prisma.reviewJob
      .updateMany({
        where: owned(lease),
        data: { leaseUntil: new Date(Date.now() + LEASE_MS) },
      })
      .catch((error: unknown) => {
        const errorType = error instanceof Error ? error.name : "unknown";
        console.warn(
          `[worker] stage=review.lease_renewal.failed job=${reviewJobId} error_type=${errorType}`,
        );
      });
  }, HEARTBEAT_MS);
  return () => clearInterval(timer);
}

/**
 * Applies `data` to the job if `lease` still owns it, plus `andThen` in the
 * same transaction. Returns false, changing nothing, when ownership was lost:
 * the job was superseded, or its lease lapsed and another attempt took it.
 */
async function writeIfOwned(
  lease: Lease,
  data: Parameters<typeof prisma.reviewJob.updateMany>[0]["data"],
  andThen?: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<unknown>,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.reviewJob.updateMany({ where: owned(lease), data });
    if (updated.count === 0) return false;
    await andThen?.(tx);
    return true;
  });
}

export async function markCompleted(lease: Lease, commentsCount: number) {
  return writeIfOwned(
    lease,
    {
      status: ReviewJobStatus.completed,
      commentsCount,
      completedAt: new Date(),
      leaseUntil: null,
      leaseToken: null,
      lastError: null,
    },
    (tx) =>
      tx.pullRequest.update({
        where: { id: lease.pullRequestId },
        data: { status: PullRequestStatus.completed },
      }),
  );
}

/**
 * Retires a job whose commit is no longer the PR head, and makes sure the
 * current head has a job of its own in case its webhook never arrived.
 */
export async function markSuperseded(lease: Lease, currentHeadSha: string) {
  return writeIfOwned(
    lease,
    { status: ReviewJobStatus.superseded, leaseUntil: null, leaseToken: null },
    async (tx) => {
      await tx.reviewJob.upsert({
        where: {
          pullRequestId_headSha: {
            pullRequestId: lease.pullRequestId,
            headSha: currentHeadSha,
          },
        },
        update: {},
        create: {
          pullRequestId: lease.pullRequestId,
          headSha: currentHeadSha,
          status: ReviewJobStatus.queued,
        },
      });
      await tx.pullRequest.update({
        where: { id: lease.pullRequestId },
        data: { headSha: currentHeadSha, status: PullRequestStatus.pending },
      });
    },
  );
}

async function markFailed(lease: Lease, lastError: string) {
  return writeIfOwned(
    lease,
    {
      status: ReviewJobStatus.failed,
      leaseUntil: null,
      leaseToken: null,
      lastError,
    },
    (tx) =>
      tx.pullRequest.update({
        where: { id: lease.pullRequestId },
        data: { status: PullRequestStatus.failed },
      }),
  );
}

/**
 * Schedules the next attempt, or gives up after the last one. If this write
 * itself fails (database down), the lapsed lease reschedules the job instead.
 * Returns "lost" when the attempt no longer owns the job, so it records nothing.
 */
export async function recordFailure(
  lease: Lease & { attempts: number },
  error: unknown,
): Promise<"retry" | "failed" | "lost"> {
  const message = (
    error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  ).slice(0, 1_000);

  if (error instanceof PermanentReviewError || lease.attempts >= MAX_ATTEMPTS) {
    return (await markFailed(lease, message)) ? "failed" : "lost";
  }

  const delay = RETRY_DELAYS_MS[lease.attempts - 1] ?? RETRY_DELAYS_MS.at(-1)!;
  const rescheduled = await writeIfOwned(
    lease,
    {
      status: ReviewJobStatus.queued,
      nextRunAt: new Date(Date.now() + delay),
      leaseUntil: null,
      leaseToken: null,
      lastError: message,
    },
    (tx) =>
      tx.pullRequest.update({
        where: { id: lease.pullRequestId },
        data: { status: PullRequestStatus.pending },
      }),
  );
  return rescheduled ? "retry" : "lost";
}
