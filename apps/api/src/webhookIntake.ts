import {
  Prisma,
  prisma,
  PullRequestStatus,
  ReviewJobStatus,
  type ReviewJob,
} from "@lorica/db";

export type PullRequestEventResult = {
  /** The delivery was already recorded; nothing was changed. */
  duplicate: boolean;
  /** Whether this event describes the PR's newest known head. */
  current: boolean;
  reviewJob: ReviewJob | null;
};

function isUniqueViolation(error: unknown, target?: string): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== "P2002"
  ) {
    return false;
  }
  if (!target) return true;
  return JSON.stringify(error.meta ?? {}).includes(target);
}

/**
 * Records a pull_request event and the review it calls for, atomically.
 *
 * - Each GitHub delivery id is stored with the changes it caused, so a
 *   redelivery (manual, reconciler, or a retried timeout) is a no-op.
 * - Each commit has at most one review job, whichever delivery produced it.
 * - Deliveries can arrive out of order; one older than the head already
 *   recorded neither moves the head back nor queues a review of a stale
 *   commit. A newer one supersedes every unfinished review of other commits,
 *   including one in progress, which then cannot publish.
 */
export async function recordPullRequestEvent(
  deliveryId: string | undefined,
  payload: any,
): Promise<PullRequestEventResult> {
  const headSha: string = payload.pull_request.head.sha;
  const eventUpdatedAt = new Date(payload.pull_request.updated_at ?? Date.now());

  try {
    return await prisma.$transaction(
      async (tx) => {
        if (deliveryId) {
          // Inserted first: a concurrent copy of this delivery blocks on the
          // primary key and then fails, instead of racing the writes below.
          const seen = await tx.webhookDelivery.findUnique({
            where: { id: deliveryId },
          });
          if (seen) {
            const reviewJob = seen.reviewJobId
              ? await tx.reviewJob.findUnique({
                  where: { id: seen.reviewJobId },
                })
              : null;
            return { duplicate: true, current: false, reviewJob };
          }
          await tx.webhookDelivery.create({
            data: {
              id: deliveryId,
              event: "pull_request",
              action: payload.action,
            },
          });
        }

        const repository = await tx.repository.upsert({
          where: { githubId: BigInt(payload.repository.id) },
          update: {
            name: payload.repository.name,
            fullName: payload.repository.full_name,
            owner: payload.repository.owner.login,
          },
          create: {
            githubId: BigInt(payload.repository.id),
            name: payload.repository.name,
            fullName: payload.repository.full_name,
            owner: payload.repository.owner.login,
          },
        });

        const existing = await tx.pullRequest.findUnique({
          where: { githubPrId: BigInt(payload.pull_request.id) },
        });
        const current =
          !existing?.headUpdatedAt || eventUpdatedAt >= existing.headUpdatedAt;

        const pullRequest = await tx.pullRequest.upsert({
          where: { githubPrId: BigInt(payload.pull_request.id) },
          // Status is derived from the review job below, so a redelivered
          // event for an already reviewed commit does not reset it.
          update: current
            ? {
                repoName: payload.repository.name,
                headSha,
                headUpdatedAt: eventUpdatedAt,
                title: payload.pull_request.title,
                author: payload.pull_request.user?.login,
                action: payload.action,
              }
            : {},
          create: {
            githubPrId: BigInt(payload.pull_request.id),
            installationId: payload.installation.id,
            repoOwner: payload.repository.owner.login,
            prNumber: payload.pull_request.number,
            repoName: payload.repository.name,
            title: payload.pull_request.title,
            author: payload.pull_request.user?.login,
            headSha,
            headUpdatedAt: eventUpdatedAt,
            action: payload.action,
            status: PullRequestStatus.pending,
            repositoryId: repository.id,
          },
        });

        const jobKey = {
          pullRequestId_headSha: { pullRequestId: pullRequest.id, headSha },
        };
        let reviewJob = await tx.reviewJob.findUnique({ where: jobKey });

        if (current) {
          if (!reviewJob) {
            reviewJob = await tx.reviewJob.create({
              data: {
                pullRequestId: pullRequest.id,
                headSha,
                status: ReviewJobStatus.queued,
              },
            });
          } else if (
            reviewJob.status === ReviewJobStatus.failed ||
            reviewJob.status === ReviewJobStatus.superseded
          ) {
            // A fresh event for this commit (e.g. reopened, or the head moved
            // back to it) earns its review a new set of attempts.
            reviewJob = await tx.reviewJob.update({
              where: { id: reviewJob.id },
              data: {
                status: ReviewJobStatus.queued,
                attempts: 0,
                nextRunAt: new Date(),
                leaseUntil: null,
                leaseToken: null,
                lastError: null,
              },
            });
          }

          await tx.reviewJob.updateMany({
            where: {
              pullRequestId: pullRequest.id,
              id: { not: reviewJob.id },
              status: { in: [ReviewJobStatus.queued, ReviewJobStatus.running] },
            },
            data: { status: ReviewJobStatus.superseded, leaseUntil: null },
          });

          if (reviewJob.status === ReviewJobStatus.queued) {
            await tx.pullRequest.update({
              where: { id: pullRequest.id },
              data: { status: PullRequestStatus.pending },
            });
          }
        }

        if (deliveryId && reviewJob) {
          await tx.webhookDelivery.update({
            where: { id: deliveryId },
            data: { reviewJobId: reviewJob.id },
          });
        }
        return { duplicate: false, current, reviewJob };
      },
      { maxWait: 10_000, timeout: 15_000 },
    );
  } catch (error) {
    // A concurrent copy of the same delivery committed first.
    if (deliveryId && isUniqueViolation(error, "WebhookDelivery")) {
      const seen = await prisma.webhookDelivery.findUnique({
        where: { id: deliveryId },
      });
      const reviewJob = seen?.reviewJobId
        ? await prisma.reviewJob.findUnique({ where: { id: seen.reviewJobId } })
        : null;
      return { duplicate: true, current: false, reviewJob };
    }
    throw error;
  }
}
