import { Request, Response } from "express";
import { reviewQueue } from "@lorica/queue";
import { prisma, PullRequestStatus, ReviewJobStatus } from "@lorica/db";
import { verifySignature } from "./webhookSignature";

async function insertIntoDatabase(
  payload: any,
  setStage: (stage: string) => void,
) {
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

  // Pull Request
  setStage("pull_request_persist");
  const pullRequest = await prisma.pullRequest.upsert({
    where: {
      githubPrId: BigInt(payload.pull_request.id),
    },
    update: {
      repoName: payload.repository.name,
      headSha: payload.pull_request.head.sha,
      title: payload.pull_request.title,
      author: payload.pull_request.user?.login,
      action: payload.action,
      status: PullRequestStatus.pending,
    },
    create: {
      githubPrId: BigInt(payload.pull_request.id),
      installationId: payload.installation.id,
      repoOwner: payload.repository.owner.login,
      prNumber: payload.pull_request.number,
      repoName: payload.repository.name,
      title: payload.pull_request.title,
      author: payload.pull_request.user?.login,
      headSha: payload.pull_request.head.sha,
      action: payload.action,
      status: PullRequestStatus.pending,
      repositoryId: repository.id,
    },
  });
  console.info(
    `[api] stage=webhook.pull_request.persisted repository=${payload.repository.full_name} pr=${payload.pull_request.number}`,
  );

  // Review Job
  setStage("review_job_persist");
  const reviewJob = await prisma.reviewJob.create({
    data: {
      pullRequestId: pullRequest.id,
      status: ReviewJobStatus.queued,
    },
  });
  console.info(`[api] stage=webhook.review_job.persisted job=${reviewJob.id}`);

  setStage("review_job_enqueue");
  await reviewQueue.add("review", { reviewJobId: reviewJob.id });
  console.info(`[api] stage=webhook.review_job.queued job=${reviewJob.id}`);
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

    console.info(
      `[api] stage=webhook.accepted action=${action} repository=${payload.repository.full_name} pr=${payload.pull_request.number}`,
    );
    await insertIntoDatabase(payload, (currentStage) => {
      stage = currentStage;
    });

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
