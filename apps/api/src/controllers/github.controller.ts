import { Request, Response } from "express";
import crypto from "crypto";
import { prisma } from "../db/prisma";
import { PullRequestStatus, ReviewJobStatus } from "@prisma/client";
import { reviewQueue } from "../jobs/queue";

function verifySignature(
  payload: Buffer,
  signature: string,
  secret: string,
): boolean {
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", secret).update(payload).digest("hex");

  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (sigBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
}

async function insertIntoDatabase(payload: any) {
  // Repository
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

  // Pull Request
  const pullRequest = await prisma.pullRequest.upsert({
    where: {
      githubPrId: BigInt(payload.pull_request.id),
    },
    update: {
      repoName: payload.repository.name,
      headSha: payload.pull_request.head.sha,
      action: payload.action,
      status: PullRequestStatus.pending,
    },
    create: {
      githubPrId: BigInt(payload.pull_request.id),
      installationId: payload.installation.id,
      repoOwner: payload.repository.owner.login,
      prNumber: payload.pull_request.number,
      repoName: payload.repository.name,
      headSha: payload.pull_request.head.sha,
      action: payload.action,
      status: PullRequestStatus.pending,
      repositoryId: repository.id,
    },
  });

  // Review Job
  const reviewJob = await prisma.reviewJob.create({
    data: {
      pullRequestId: pullRequest.id,
      status: ReviewJobStatus.queued,
    },
  });

  await reviewQueue.add("review", { reviewJobId: reviewJob.id });

  console.log("Inserted successfully!");
}

export const handleWebhook = async (req: Request, res: Response) => {
  try {
    console.log("DATABASE URL:", process.env.DATABASE_URL);
    console.log("STARTING WEBHOOK HANDLER");

    const signature = req.headers["x-hub-signature-256"];

    if (typeof signature !== "string") {
      return res.status(401).send("Unauthorized: No signature provided");
    }

    const secret = process.env.WEBHOOK_SECRET;

    if (!secret) {
      return res.status(500).send("Webhook secret not configured");
    }

    const isValid = verifySignature(req.body, signature, secret);

    if (!isValid) {
      return res.status(401).send("Invalid signature");
    }

    const payload = JSON.parse(req.body.toString("utf8"));

    const event = req.header("X-Github-Event");

    if (event !== "pull_request") {
      return res.status(200).send("Ignoring non pull_request event");
    }

    const action = payload.action;

    if (
      action !== "opened" &&
      action !== "reopened" &&
      action !== "synchronize"
    ) {
      return res
        .status(200)
        .send("Ignoring non opened/reopened/synchronize action");
    }

    console.log(`Processing PR ${action}`);
    console.log(payload.pull_request.title);

    await insertIntoDatabase(payload);

    return res.status(200).send("Webhook received");
  } catch (error) {
    console.error(error);
    return res.status(500).send("Internal Server Error");
  }
};
