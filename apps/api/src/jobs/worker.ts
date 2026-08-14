import dotenv from "dotenv";
dotenv.config();
import { Worker, Job } from "bullmq";
import { connection, ReviewJobPayload } from "./queue";
import { prisma } from "../db/prisma";
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
});
console.log("Review worker started , waiting for jobs.....");
