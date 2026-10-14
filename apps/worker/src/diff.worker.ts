import "dotenv/config";
import { connection } from "@lorica/queue";
import { callLLM, REVIEW_PROMPT } from "@lorica/llm";
import { assembleReviewContext } from "@lorica/context";
import { renderReview } from "@lorica/vcs";
import {
  fetchPrFiles,
  fetchPullRequestDetails,
  getInstallationAccessToken,
  getInstallationOctokit,
  hasPRCommentWithMarker,
  postPRComment,
  reviewCommentMarker,
} from "@lorica/vcs";
import { Worker, Job } from "bullmq";
import { ReviewJobPayload } from "@lorica/types";
import { refreshCodeGraph } from "./codeIndex.worker";
import { getReviewGraphContext } from "./neo4j";
import {
  claimReviewJob,
  markCompleted,
  markSuperseded,
  PermanentReviewError,
  recordFailure,
  startLeaseHeartbeat,
} from "./reviewJobs";

function toCloneUrl(owner: string, repo: string, token: string): string {
  return `https://x-access-token:${encodeURIComponent(token)}@github.com/${owner}/${repo}.git`;
}

function graphBranch(prNumber: number): string {
  // A PR graph must not overwrite the repository's default-branch graph.
  return `pull/${prNumber}`;
}

function isPermanentGitHubError(error: unknown): boolean {
  // The PR, repository or installation is gone; no retry will bring it back.
  const status = (error as { status?: unknown } | null)?.status;
  return status === 404 || status === 410;
}

/**
 * Runs one attempt of a review job. Safe to call for any id from any source
 * (queue, dispatcher, duplicates): only the caller that claims the job runs it.
 */
export async function processReview(reviewJobId: number): Promise<void> {
  let stage = "claim";
  let reviewJob: Awaited<ReturnType<typeof claimReviewJob>> = null;
  let stopHeartbeat: (() => void) | undefined;
  try {
    reviewJob = await claimReviewJob(reviewJobId);
    if (!reviewJob) {
      console.info(`[worker] stage=review.skipped job=${reviewJobId} reason=not_due_or_claimed`);
      return;
    }
    stopHeartbeat = startLeaseHeartbeat(reviewJob.id);
    console.info(
      `[worker] stage=review.started job=${reviewJobId} attempt=${reviewJob.attempts}`,
    );

    const { pullRequest } = reviewJob;
    const { repoName, installationId, repoOwner, prNumber } = pullRequest;
    stage = "github_fetch";

    const octokit = await getInstallationOctokit(installationId);

    const [files, metadata] = await Promise.all([
      fetchPrFiles(installationId, repoOwner, repoName, prNumber),
      fetchPullRequestDetails(installationId, repoOwner, repoName, prNumber),
    ]);

    if (metadata.headSha !== reviewJob.headSha) {
      stage = "supersede";
      await markSuperseded(reviewJob.id, pullRequest.id, metadata.headSha);
      console.info(
        `[worker] stage=review.superseded job=${reviewJobId} pr=${prNumber} head=${metadata.headSha}`,
      );
      return;
    }
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

    const marker = reviewCommentMarker(reviewJob.id);
    const comment = `${renderReview(resultObject)}\n\n${marker}`;
    stage = "github_comment";
    if (
      await hasPRCommentWithMarker(octokit, {
        owner: repoOwner,
        repo: repoName,
        prNumber,
        marker,
      })
    ) {
      // A previous attempt posted the review but died before recording it.
      console.info(
        `[worker] stage=github.comment.already_posted repository=${repoOwner}/${repoName} pr=${prNumber}`,
      );
    } else {
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
    }

    stage = "database_complete";
    await markCompleted(
      reviewJob.id,
      pullRequest.id,
      resultObject.reviews.length,
    );
    console.info(
      `[worker] stage=review.completed job=${reviewJobId} pr=${prNumber} findings=${resultObject.reviews.length}`,
    );
  } catch (error) {
    const errorType = error instanceof Error ? error.name : "unknown";
    console.error(
      `[worker] stage=review.${stage}.failed job=${reviewJobId} error_type=${errorType}`,
    );
    if (!reviewJob) return; // Claim failed (database down): the job stays due.

    const failure = isPermanentGitHubError(error)
      ? new PermanentReviewError(
          error instanceof Error ? error.message : String(error),
        )
      : error;
    try {
      const outcome = await recordFailure(reviewJob, failure);
      console.info(
        `[worker] stage=review.status_updated job=${reviewJobId} status=${outcome} attempt=${reviewJob.attempts}`,
      );
    } catch (recordError) {
      const recordErrorType =
        recordError instanceof Error ? recordError.name : "unknown";
      console.error(
        `[worker] stage=review.failure_status_update.failed job=${reviewJobId} error_type=${recordErrorType}`,
      );
    }
  } finally {
    stopHeartbeat?.();
  }
}

export const reviewWorker = new Worker<ReviewJobPayload>(
  "review",
  async (job: Job<ReviewJobPayload>) => processReview(job.data.reviewJobId),
  {
    connection,
    concurrency: 2,
  },
);

reviewWorker.on("completed", (job: Job<ReviewJobPayload>) => {
  console.info(`[worker] stage=review.queue_job.completed job=${job.id}`);
});

// Without a listener, an 'error' event during a Redis outage crashes the process.
reviewWorker.on("error", (error: Error) => {
  console.error(`[worker] stage=review.queue.error error_type=${error.name}`);
});

console.info("[worker] stage=review.worker.ready queue=review");
