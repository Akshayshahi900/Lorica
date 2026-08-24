import "dotenv/config";
import { connection} from "@lorica/queue";
import { prisma, PullRequestStatus, ReviewJobStatus } from "@lorica/db";
import { callLLM, REVIEW_PROMPT } from "@lorica/llm";
import { renderReview } from "@lorica/vcs";
import {
  fetchPrFiles,
  getInstallationOctokit,
  postPRComment,
} from "@lorica/vcs";
import { ReviewJobPayload } from "@lorica/types";

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
