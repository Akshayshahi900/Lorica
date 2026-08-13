import dotenv from "dotenv";
dotenv.config();
import { Worker, Job } from "bullmq";
import { connection, ReviewJobPayload } from "../../queue";
import { prisma } from "../../lib/prisma";
import { fetchPrFiles } from "../../pullrequests/fetchDiff";
import { parseFileDiffs } from "../../pullrequests/parseDiff";
import { callLLM } from "../../llm/llm";
import { promptTemplate } from "../../llm/prompt";
import { renderReview } from "../../github/commentBuilder";
import { postPRComment } from "../../github/postComment";
import { getInstallationOctokit } from "../../pullrequests/octokit";

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

    const resultObject = await callLLM(diffText, promptTemplate);

    
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
