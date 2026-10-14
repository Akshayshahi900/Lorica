import { Request, Response } from "express";
import { enqueueReview } from "@lorica/queue";
import { prisma, PullRequestStatus, ReviewJobStatus } from "@lorica/db";
import { verifySignature } from "./webhookSignature";
import { wakeWorker } from "./wakeWorker";

const DB_ATTEMPTS = 3;

// A free-tier Postgres that has scaled to zero refuses the first connections
// while it resumes. Every write below is an upsert, so replaying is safe.
async function withDatabaseRetry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= DB_ATTEMPTS) throw error;
      const errorType = error instanceof Error ? error.name : "unknown";
      console.warn(
        `[api] stage=webhook.database_retry attempt=${attempt} error_type=${errorType}`,
      );
      await new Promise((resolve) => setTimeout(resolve, 1_000 * attempt));
    }
  }
}

async function insertIntoDatabase(
  payload: any,
  setStage: (stage: string) => void,
) {
  const headSha: string = payload.pull_request.head.sha;

  // Repository
  setStage("repository_persist");
  const repository = await prisma.repository.upsert({
    where: {
      githubId: BigInt(payload.repository.id),
    },
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
  console.info(
    `[api] stage=webhook.repository.persisted repository=${payload.repository.full_name}`,
  );

  // Pull Request. Status is derived from the review job below, so a
  // redelivered event for an already reviewed commit does not reset it.
  setStage("pull_request_persist");
  const pullRequest = await prisma.pullRequest.upsert({
    where: {
      githubPrId: BigInt(payload.pull_request.id),
    },
    update: {
      repoName: payload.repository.name,
      headSha,
      title: payload.pull_request.title,
      author: payload.pull_request.user?.login,
      action: payload.action,
    },
    create: {
      githubPrId: BigInt(payload.pull_request.id),
      installationId: payload.installation.id,
      repoOwner: payload.repository.owner.login,
      prNumber: payload.pull_request.number,
      repoName: payload.repository.name,
      title: payload.pull_request.title,
      author: payload.pull_request.user?.login,
      headSha,
      action: payload.action,
      status: PullRequestStatus.pending,
      repositoryId: repository.id,
    },
  });
  console.info(
    `[api] stage=webhook.pull_request.persisted repository=${payload.repository.full_name} pr=${payload.pull_request.number}`,
  );

  // Review Job: one per commit. A redelivery finds the existing row; a new
  // event for a commit whose review gave up earns it a fresh set of attempts.
  setStage("review_job_persist");
  const existingJob = await prisma.reviewJob.findUnique({
    where: { pullRequestId_headSha: { pullRequestId: pullRequest.id, headSha } },
  });
  const reviewJob = await prisma.reviewJob.upsert({
    where: { pullRequestId_headSha: { pullRequestId: pullRequest.id, headSha } },
    update:
      existingJob?.status === ReviewJobStatus.failed
        ? {
            status: ReviewJobStatus.queued,
            attempts: 0,
            nextRunAt: new Date(),
            leaseUntil: null,
            lastError: null,
          }
        : {},
    create: {
      pullRequestId: pullRequest.id,
      headSha,
      status: ReviewJobStatus.queued,
    },
  });

  // Reviews of commits that have since been replaced would be stale.
  await prisma.reviewJob.updateMany({
    where: {
      pullRequestId: pullRequest.id,
      id: { not: reviewJob.id },
      status: ReviewJobStatus.queued,
    },
    data: { status: ReviewJobStatus.superseded },
  });

  if (reviewJob.status === ReviewJobStatus.queued) {
    await prisma.pullRequest.update({
      where: { id: pullRequest.id },
      data: { status: PullRequestStatus.pending },
    });
  }
  console.info(
    `[api] stage=webhook.review_job.persisted job=${reviewJob.id} status=${reviewJob.status}`,
  );
  return reviewJob;
}

export const handleWebhook = async (req: Request, res: Response) => {
  let stage = "signature_validation";
  try {
    const signature = req.headers["x-hub-signature-256"];

    if (typeof signature !== "string") {
      console.warn(
        "[api] stage=webhook.signature_rejected reason=missing_signature",
      );
      return res.status(401).send("Unauthorized: No signature provided");
    }

    const secret = process.env.WEBHOOK_SECRET;

    if (!secret) {
      console.error(
        "[api] stage=webhook.configuration_failed reason=missing_secret",
      );
      return res.status(500).send("Webhook secret not configured");
    }

    const isValid = verifySignature(req.body, signature, secret);

    if (!isValid) {
      console.warn(
        "[api] stage=webhook.signature_rejected reason=invalid_signature",
      );
      return res.status(401).send("Invalid signature");
    }
    console.info("[api] stage=webhook.signature_verified");

    stage = "payload_parse";
    const payload = JSON.parse(req.body.toString("utf8"));

    const event = req.header("X-Github-Event");

    if (event !== "pull_request") {
      console.info(
        `[api] stage=webhook.ignored reason=unsupported_event event=${event ?? "unknown"}`,
      );
      return res.status(200).send("Ignoring non pull_request event");
    }

    const action = payload.action;

    if (
      action !== "opened" &&
      action !== "reopened" &&
      action !== "synchronize"
    ) {
      console.info(
        `[api] stage=webhook.ignored reason=unsupported_action action=${action ?? "unknown"}`,
      );
      return res
        .status(200)
        .send("Ignoring non opened/reopened/synchronize action");
    }

    // Fire-and-forget: the worker boots in parallel with the DB writes below.
    wakeWorker();

    console.info(
      `[api] stage=webhook.accepted action=${action} repository=${payload.repository.full_name} pr=${payload.pull_request.number}`,
    );
    const reviewJob = await withDatabaseRetry(() =>
      insertIntoDatabase(payload, (currentStage) => {
        stage = currentStage;
      }),
    );

    // The job is durable now, so a Redis failure only delays it: the worker's
    // dispatcher picks up any queued job that never reached the queue.
    if (reviewJob.status === ReviewJobStatus.queued) {
      stage = "review_job_enqueue";
      try {
        await enqueueReview(reviewJob.id, reviewJob.attempts);
        console.info(
          `[api] stage=webhook.review_job.queued job=${reviewJob.id}`,
        );
      } catch (error) {
        const errorType = error instanceof Error ? error.name : "unknown";
        console.warn(
          `[api] stage=webhook.review_job.enqueue_deferred job=${reviewJob.id} error_type=${errorType}`,
        );
      }
    }

    console.info(
      `[api] stage=webhook.completed repository=${payload.repository.full_name} pr=${payload.pull_request.number}`,
    );
    return res.status(200).send("Webhook received");
  } catch (error) {
    const errorType = error instanceof Error ? error.name : "unknown";
    console.error(
      `[api] stage=webhook.${stage}.failed error_type=${errorType}`,
    );
    return res.status(500).send("Internal Server Error");
  }
};
