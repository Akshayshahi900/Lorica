import dotenv from "dotenv";
dotenv.config();
import { Worker, Job } from "bullmq";
import { connection, ReviewJobPayload } from "../../queue";
import { prisma } from "../../lib/prisma";
import { fetchPrFiles } from "../../github/fetchDiff";
import { parseFileDiffs } from "../../github/parseDiff";
import { callLLM } from "../../intelligence/llm";
import { promptTemplate } from "../../intelligence/prompt";

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

    const files = await fetchPrFiles(
      installationId,
      repoOwner,
      repoName,
      prNumber,
    );

    const parseDiffs = parseFileDiffs(files);
    console.log(`[worker] parsed ${parseDiffs.length} files for job ${job.id}`);

    // console.dir(parseDiffs, { depth: null });

    // //next step:rag + claude review genreation on parsedDiffs

    // const diffText = JSON.stringify(parseDiffs, null, 2);

    // console.log("========== DIFF SENT TO LLM ==========");
    // console.log(diffText);
    // console.log("=======================================");

    // const result = await callLLM(diffText, promptTemplate);
    // console.log("========================Printing the LLM RESULT to the CONSOLE=====================");
    // console.log(result);
    const diffText = files
      .filter((f) => f.patch)
      .map((f) => {
        return `diff --git a/${f.filePath} b/${f.filePath}
${f.patch}`;
      })
      .join("\n\n");

    console.log("========== DIFF SENT TO LLM ==========");
    console.log(diffText);
    console.log("======================================");

    const result = await callLLM(diffText, promptTemplate);
    console.log(
      "========================Printing the LLM RESULT to the CONSOLE=====================",
    );
    console.log(result);
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
