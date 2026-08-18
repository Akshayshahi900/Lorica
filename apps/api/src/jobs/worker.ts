import dotenv from "dotenv";
dotenv.config();
import { Worker, Job } from "bullmq";
import { connection, ReviewJobPayload } from "./queue";
import { prisma } from "../db/prisma";
import { PullRequestStatus, ReviewJobStatus } from "@prisma/client";
import { fetchPrFiles } from "../vcs/github/fetchDiff";
// import { parseFileDiffs } from "../../pullrequests/parseDiff";
import { callLLM } from "../llm/client";
import { REVIEW_PROMPT } from "../llm/prompt";
import { renderReview } from "../vcs/github/commentBuilder";
import { postPRComment } from "../vcs/github/postComment";
import { getInstallationOctokit } from "../vcs/github/octokit";

const worker = new Worker<ReviewJobPayload>(
  "review",
  async (job: Job<ReviewJobPayload>) => {
    const reviewJob = await prisma.reviewJob.findUniqueOrThrow({
      where: { id: job.data.reviewJobId },
    });

    await prisma.$transaction([
      prisma.reviewJob.update({
        where: { id: reviewJob.id },
        data: { status: ReviewJobStatus.running },
      }),
      prisma.pullRequest.update({
        where: { id: reviewJob.pullRequestId },
        data: { status: PullRequestStatus.processing },
      }),
    ]);

    const pullRequestId = reviewJob.pullRequestId;

    const pullrequest = await prisma.pullRequest.findUnique({
      where: { id: reviewJob.pullRequestId },
    });

    if (!pullrequest) {
      throw new Error(`Pull request ${pullRequestId} not found`);
    }
    const { repoName, installationId, repoOwner, prNumber } = pullrequest;

    const octokit = await getInstallationOctokit(installationId);

    const files = await fetchPrFiles(
      installationId,
      repoOwner,
      repoName,
      prNumber,
    );

    const diffText = files
      .filter((f) => f.patch)
      .map((f) => {
        return `diff --git a/${f.filePath} b/${f.filePath}
${f.patch}`;
      })
      .join("\n\n");

    // console.log("========== DIFF SENT TO LLM ==========");
    // console.log(diffText);
    // console.log("======================================");

    const resultObject = await callLLM(diffText, REVIEW_PROMPT);

    console.log(resultObject);

    const comment = renderReview(resultObject);

    console.log("========== COMMENT ==========");
    console.log(comment);
    console.log("=============================");

    await postPRComment(octokit, {
      owner: repoOwner,
      repo: repoName,
      prNumber,
      body: comment,
    });

    await prisma.$transaction([
      prisma.reviewJob.update({
        where: { id: reviewJob.id },
        data: {
          status: ReviewJobStatus.completed,
          commentsCount: resultObject.reviews.length,
          completedAt: new Date(),
        },
      }),
      prisma.pullRequest.update({
        where: { id: pullRequestId },
        data: { status: PullRequestStatus.completed },
      }),
    ]);
  },
  {
    connection,
    concurrency: 2,
  },
);
worker.on("completed", (job) => {
  console.log(`[worker] job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`[worker] job  ${job?.id} failed`, err.message);

  const attempts = job?.opts.attempts ?? 1;
  if (job?.data.reviewJobId && job.attemptsMade >= attempts) {
    void prisma.$transaction([
      prisma.reviewJob.update({
        where: { id: job.data.reviewJobId },
        data: { status: ReviewJobStatus.failed },
      }),
      prisma.pullRequest.updateMany({
        where: { reviewJobs: { some: { id: job.data.reviewJobId } } },
        data: { status: PullRequestStatus.failed },
      }),
    ]);
  }
});
console.log("Review worker started , waiting for jobs.....");
