import "dotenv/config";
import { connection } from "@lorica/queue";
import { prisma, PullRequestStatus, ReviewJobStatus } from "@lorica/db";
import { callLLM, REVIEW_PROMPT } from "@lorica/llm";
import { assembleReviewContext } from "@lorica/context";
import { renderReview } from "@lorica/vcs";
import {
  fetchPrFiles,
  fetchPullRequestDetails,
  getInstallationAccessToken,
  getInstallationOctokit,
  postPRComment,
} from "@lorica/vcs";
import {Worker , Job} from "bullmq";
import { ReviewJobPayload } from "@lorica/types";
import { refreshCodeGraph } from "./codeIndex.worker";
import { getReviewGraphContext } from "./neo4j";

function toCloneUrl(owner: string, repo: string, token: string): string {
  return `https://x-access-token:${encodeURIComponent(token)}@github.com/${owner}/${repo}.git`;
}

function graphBranch(prNumber: number): string {
  // A PR graph must not overwrite the repository's default-branch graph.
  return `pull/${prNumber}`;
}

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

    const pullRequest = await prisma.pullRequest.findUnique({
      where: { id: reviewJob.pullRequestId },
    });

    if (!pullRequest) {
      throw new Error(`Pull request ${pullRequestId} not found`);
    }
    const { repoName, installationId, repoOwner, prNumber } = pullRequest;

    const octokit = await getInstallationOctokit(installationId);

    const [files, metadata] = await Promise.all([
      fetchPrFiles(
      installationId,
      repoOwner,
      repoName,
      prNumber,
      ),
      fetchPullRequestDetails(installationId, repoOwner, repoName, prNumber),
    ]);

    const repositoryUrl = `https://github.com/${repoOwner}/${repoName}.git`;
    const branch = graphBranch(prNumber);

    // A synchronize event always replaces the PR graph before context is read.
    // Fresh PRs take the same initialization path, so both cases have a graph
    // snapshot at precisely the SHA presented to the model.
    const token = await getInstallationAccessToken(installationId);
    await refreshCodeGraph({
      repositoryUrl,
      cloneRepositoryUrl: toCloneUrl(repoOwner, repoName, token),
      branch,
      commit: metadata.headSha,
    });

    const changedFiles = files
      .filter((file) => Boolean(file.patch))
      .map((file) => ({
        filePath: file.filePath,
        status: ["added", "modified", "removed", "renamed"].includes(file.status)
          ? file.status as "added" | "modified" | "removed" | "renamed"
          : "changed" as const,
        patch: file.patch!,
      }));
    const graph = await getReviewGraphContext({
      repositoryUrl,
      branch,
      changedFiles: changedFiles.map((file) => file.filePath),
    });
    const context = assembleReviewContext({
      pullRequest: {
        repository: `${repoOwner}/${repoName}`,
        number: prNumber,
        title: metadata.title,
        description: metadata.description,
        author: metadata.author,
        baseSha: metadata.baseSha,
        headSha: metadata.headSha,
        event: pullRequest.action === "synchronize" ? "synchronize" : "fresh",
      },
      changedFiles,
      indexedCommit: graph.indexedCommit,
      traces: graph.traces,
    });

    const resultObject = await callLLM(context, REVIEW_PROMPT);

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
worker.on("completed", (job: any) => {
  console.log(`[worker] job ${job.id} completed`);
});

worker.on("failed", (job: any, err: Error) => {
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
