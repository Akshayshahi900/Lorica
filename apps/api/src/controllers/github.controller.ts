import { Request, Response } from "express";
import { enqueueReview } from "@lorica/queue";
import { ReviewJobStatus } from "@lorica/db";
import { verifySignature } from "./webhookSignature";
import { wakeWorker } from "./wakeWorker";
import { recordPullRequestEvent } from "../webhookIntake";

const DB_ATTEMPTS = 3;

// A free-tier Postgres that has scaled to zero refuses the first connections
// while it resumes. The intake is one idempotent transaction, so replaying is safe.
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

    // ready_for_review: a draft the review settings skipped is now reviewable.
    if (
      action !== "opened" &&
      action !== "reopened" &&
      action !== "synchronize" &&
      action !== "ready_for_review"
    ) {
      console.info(
        `[api] stage=webhook.ignored reason=unsupported_action action=${action ?? "unknown"}`,
      );
      return res
        .status(200)
        .send("Ignoring non opened/reopened/synchronize/ready_for_review action");
    }

    // Fire-and-forget: the worker boots in parallel with the DB writes below.
    wakeWorker();

    console.info(
      `[api] stage=webhook.accepted action=${action} repository=${payload.repository.full_name} pr=${payload.pull_request.number}`,
    );
    stage = "persist";
    const deliveryId = req.header("X-GitHub-Delivery");
    const { duplicate, current, reviewJob } = await withDatabaseRetry(() =>
      recordPullRequestEvent(deliveryId, payload),
    );
    console.info(
      `[api] stage=webhook.persisted delivery=${deliveryId ?? "none"} duplicate=${duplicate} current=${current} job=${reviewJob?.id ?? "none"} status=${reviewJob?.status ?? "none"}`,
    );

    // The job is durable now, so a Redis failure only delays it: the worker's
    // dispatcher picks up any queued job that never reached the queue.
    if (reviewJob?.status === ReviewJobStatus.queued) {
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
