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
import { Worker, Job } from "bullmq";
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
    let stage = "load_job";
    const reviewJobId = job.data.reviewJobId;
    try {
      console.info(`[worker] stage=review.started job=${reviewJobId}`);
      const reviewJob = await prisma.reviewJob.findUniqueOrThrow({
        where: { id: reviewJobId },
      });

      stage = "database_running_status";
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
      console.info(
        `[worker] stage=review.status_updated job=${reviewJobId} status=running`,
      );

      stage = "pull_request_lookup";
      const pullRequestId = reviewJob.pullRequestId;

      const pullRequest = await prisma.pullRequest.findUnique({
        where: { id: reviewJob.pullRequestId },
      });

      if (!pullRequest) {
        throw new Error("Pull request record not found");
      }
      const { repoName, installationId, repoOwner, prNumber } = pullRequest;
      stage = "github_fetch";

      const octokit = await getInstallationOctokit(installationId);

      const [files, metadata] = await Promise.all([
        fetchPrFiles(installationId, repoOwner, repoName, prNumber),
        fetchPullRequestDetails(installationId, repoOwner, repoName, prNumber),
      ]);
      console.info(
        `[worker] stage=github.pull_request.loaded repository=${repoOwner}/${repoName} pr=${prNumber} files=${files.length}`,
      );

      const repositoryUrl = `https://github.com/${repoOwner}/${repoName}.git`;
      const branch = graphBranch(prNumber);

      // A synchronize event always replaces the PR graph before context is read.
      // Fresh PRs take the same initialization path, so both cases have a graph
      // snapshot at precisely the SHA presented to the model.
      const token = await getInstallationAccessToken(installationId);
      stage = "neo4j_index";
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
          status: ["added", "modified", "removed", "renamed"].includes(
            file.status,
          )
            ? (file.status as "added" | "modified" | "removed" | "renamed")
            : ("changed" as const),
          patch: file.patch!,
        }));
      const graph = await getReviewGraphContext({
        repositoryUrl,
        branch,
        changedFiles: changedFiles.map((file) => file.filePath),
      });
      console.info(
        `[worker] stage=neo4j.context.loaded repository=${repoOwner}/${repoName} pr=${prNumber} commit=${graph.indexedCommit} traces=${graph.traces.length}`,
      );
      stage = "context_validation";
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

      stage = "llm_review";
      console.info(
        `[worker] stage=llm.request.started job=${reviewJobId} files=${changedFiles.length}`,
      );
      const resultObject = await callLLM(context, REVIEW_PROMPT);
      console.info(
        `[worker] stage=llm.request.completed job=${reviewJobId} findings=${resultObject.reviews.length}`,
      );

      const comment = renderReview(resultObject);
      stage = "github_comment";
      console.info(
        `[worker] stage=github.comment.post.started repository=${repoOwner}/${repoName} pr=${prNumber}`,
      );
      await postPRComment(octokit, {
        owner: repoOwner,
        repo: repoName,
        prNumber,
        body: comment,
      });
      console.info(
        `[worker] stage=github.comment.post.completed repository=${repoOwner}/${repoName} pr=${prNumber}`,
      );

      stage = "database_complete";
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
      console.info(
        `[worker] stage=review.completed job=${reviewJobId} pr=${prNumber} findings=${resultObject.reviews.length}`,
      );
    } catch (error) {
      const errorType = error instanceof Error ? error.name : "unknown";
      console.error(
        `[worker] stage=review.${stage}.failed job=${reviewJobId} error_type=${errorType}`,
      );
      throw error;
    }
  },
  {
    connection,
    concurrency: 2,
  },
);
worker.on("completed", (job: any) => {
  console.info(`[worker] stage=review.queue_job.completed job=${job.id}`);
});

worker.on("failed", (job: any, err: Error) => {
  console.error(
    `[worker] stage=review.queue_job.failed job=${job?.id ?? "unknown"} error_type=${err.name}`,
  );

  const attempts = job?.opts.attempts ?? 1;
  if (job?.data.reviewJobId && job.attemptsMade >= attempts) {
    void prisma
      .$transaction([
        prisma.reviewJob.update({
          where: { id: job.data.reviewJobId },
          data: { status: ReviewJobStatus.failed },
        }),
        prisma.pullRequest.updateMany({
          where: { reviewJobs: { some: { id: job.data.reviewJobId } } },
          data: { status: PullRequestStatus.failed },
        }),
      ])
      .then(() => {
        console.info(
          `[worker] stage=review.status_updated job=${job.data.reviewJobId} status=failed`,
        );
      })
      .catch((error: unknown) => {
        const errorType = error instanceof Error ? error.name : "unknown";
        console.error(
          `[worker] stage=review.failure_status_update.failed job=${job.data.reviewJobId} error_type=${errorType}`,
        );
      });
  }
});
console.info("[worker] stage=review.worker.ready queue=review");
