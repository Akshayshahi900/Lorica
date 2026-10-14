import {
  buildReviewPrompt,
  callLLM,
  configFromStoredSettings,
  reservedReviewTokens,
  type LlmConfig,
} from "@lorica/llm";
import { Prisma, prisma } from "@lorica/db";
import {
  excludeConfiguredPaths,
  filterReviewableFiles,
  fitBudgetToContextWindow,
  mergeReviewResults,
  pathInstructionsFor,
  planReview,
  reviewBudgetFromEnv,
  reviewLimits,
  reviewSkipReason,
} from "@lorica/context";
import {
  parseRepoReviewConfig,
  PROFILE_PRESETS,
  REPO_CONFIG_FILES,
  resolveReviewSettings,
  ReviewSettingsSchema,
  type ReviewSettings,
} from "@lorica/types";
import {
  fetchPrFiles,
  fetchPullRequestDetails,
  fetchRepoFile,
  getInstallationAccessToken,
  findReviewComment,
  getInstallationOctokit,
  postPRComment,
  renderReview,
  reviewCommentMarker,
  updatePRComment,
  type PRComment,
} from "@lorica/vcs";
import { refreshCodeGraph } from "./indexer/refreshCodeGraph";
import { getReviewGraphContext } from "./neo4j";
import {
  canPublish,
  claimReviewJob,
  markCompleted,
  markSuperseded,
  PermanentReviewError,
  recordFailure,
  startLeaseHeartbeat,
} from "./reviewJobs";

type PullRequestRef = {
  installationId: number;
  owner: string;
  repo: string;
  prNumber: number;
};

/** Everything a review touches outside the database, replaceable in tests. */
export type ReviewDependencies = {
  fetchFiles: (pr: PullRequestRef) => ReturnType<typeof fetchPrFiles>;
  fetchDetails: (pr: PullRequestRef) => ReturnType<typeof fetchPullRequestDetails>;
  indexCommit: (pr: PullRequestRef, commit: string) => Promise<void>;
  loadGraphContext: typeof getReviewGraphContext;
  /** The owner's own model, or null for the deployment default. */
  loadModelConfig: (owner: string) => Promise<LlmConfig | null>;
  /** The owner's dashboard review settings, or null for the defaults. */
  loadOwnerSettings: (owner: string) => Promise<unknown | null>;
  /** The repository's review config file at `ref`, or null if it has none. */
  fetchRepoConfig: (
    pr: PullRequestRef,
    ref: string,
  ) => Promise<{ path: string; source: string } | null>;
  review: typeof callLLM;
  findComment: (pr: PullRequestRef) => Promise<PRComment | null>;
  postComment: (pr: PullRequestRef, body: string) => Promise<void>;
  updateComment: (
    pr: PullRequestRef,
    commentId: number,
    body: string,
  ) => Promise<void>;
};

function graphBranch(prNumber: number): string {
  // A PR graph must not overwrite the repository's default-branch graph.
  return `pull/${prNumber}`;
}

function repositoryUrl({ owner, repo }: PullRequestRef): string {
  return `https://github.com/${owner}/${repo}.git`;
}

export const githubDependencies: ReviewDependencies = {
  fetchFiles: ({ installationId, owner, repo, prNumber }) =>
    fetchPrFiles(installationId, owner, repo, prNumber),
  fetchDetails: ({ installationId, owner, repo, prNumber }) =>
    fetchPullRequestDetails(installationId, owner, repo, prNumber),
  indexCommit: async (pr, commit) => {
    const token = await getInstallationAccessToken(pr.installationId);
    await refreshCodeGraph({
      repositoryUrl: repositoryUrl(pr),
      cloneRepositoryUrl: `https://x-access-token:${encodeURIComponent(token)}@github.com/${pr.owner}/${pr.repo}.git`,
      branch: graphBranch(pr.prNumber),
      commit,
    });
  },
  loadGraphContext: getReviewGraphContext,
  loadModelConfig: async (owner) => {
    const stored = await prisma.modelSettings.findUnique({
      where: { owner: owner.toLowerCase() },
    });
    if (!stored) return null;
    try {
      return configFromStoredSettings(stored);
    } catch (error) {
      // A rotated encryption key or a bad row will not fix itself on retry.
      throw new PermanentReviewError(
        `The review model saved in Settings for ${owner} could not be loaded (${
          error instanceof Error ? error.message : String(error)
        }). Save it again or reset to the default model.`,
      );
    }
  },
  loadOwnerSettings: async (owner) => {
    try {
      const stored = await prisma.reviewSettings.findUnique({
        where: { owner: owner.toLowerCase() },
      });
      return stored?.config ?? null;
    } catch (error) {
      // P2021: the table does not exist (the review_settings migration has not
      // run). Retrying cannot fix that, so review with the defaults instead.
      // Any other error (database unreachable) is retried as usual.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2021"
      ) {
        console.warn(
          "[worker] stage=review.settings.table_missing action=using_defaults",
        );
        return null;
      }
      throw error;
    }
  },
  fetchRepoConfig: async (pr, ref) => {
    for (const path of REPO_CONFIG_FILES) {
      const source = await fetchRepoFile(pr.installationId, pr.owner, pr.repo, path, ref);
      if (source !== null) return { path, source };
    }
    return null;
  },
  review: callLLM,
  findComment: async (pr) =>
    findReviewComment(await getInstallationOctokit(pr.installationId), {
      owner: pr.owner,
      repo: pr.repo,
      prNumber: pr.prNumber,
    }),
  postComment: async (pr, body) => {
    await postPRComment(await getInstallationOctokit(pr.installationId), {
      owner: pr.owner,
      repo: pr.repo,
      prNumber: pr.prNumber,
      body,
    });
  },
  updateComment: async (pr, commentId, body) => {
    await updatePRComment(await getInstallationOctokit(pr.installationId), {
      owner: pr.owner,
      repo: pr.repo,
      commentId,
      body,
    });
  },
};

export type ReviewOutcome =
  | "skipped" // not due, or another attempt holds it
  | "completed"
  | "not_reviewed" // the review settings ruled this commit out
  | "superseded" // its commit is no longer the PR head
  | "lost" // ownership passed elsewhere mid-review; nothing was written
  | "retry"
  | "failed";

function isPermanentGitHubError(error: unknown): boolean {
  // The PR, repository or installation is gone; no retry will bring it back.
  const status = (error as { status?: unknown } | null)?.status;
  return status === 404 || status === 410;
}

/**
 * The owner's settings with the repository's config file on top. A broken
 * layer is left out rather than failing the review; `notices` say why, so the
 * team sees it on the PR.
 */
async function loadReviewSettings(
  deps: ReviewDependencies,
  pr: PullRequestRef,
  baseSha: string,
) {
  const notices: string[] = [];
  const layers: ReviewSettings[] = [];

  const ownerConfig = await deps.loadOwnerSettings(pr.owner);
  if (ownerConfig) {
    const parsed = ReviewSettingsSchema.safeParse(ownerConfig);
    if (parsed.success) layers.push(parsed.data);
    else notices.push("The review settings saved in the Lorica dashboard could not be read and were ignored. Save them again.");
  }

  let repoConfig: Awaited<ReturnType<ReviewDependencies["fetchRepoConfig"]>> = null;
  try {
    repoConfig = await deps.fetchRepoConfig(pr, baseSha);
  } catch (error) {
    // 403: the installation may not read repository contents. That will not
    // change on retry, so review without the file and say so. Anything else
    // (rate limit, outage) is retried: reviewing with the wrong settings could
    // review a PR the team ruled out.
    if ((error as { status?: unknown } | null)?.status !== 403) throw error;
    notices.push(
      `Lorica could not read the repository's \`${REPO_CONFIG_FILES[0]}\` (GitHub denied access), so it was not applied. Grant the app "Contents: Read".`,
    );
  }
  if (repoConfig) {
    const parsed = parseRepoReviewConfig(repoConfig.source);
    if ("settings" in parsed) layers.push(parsed.settings);
    else notices.push(`\`${repoConfig.path}\` was ignored: ${parsed.error}`);
  }

  return {
    settings: resolveReviewSettings(layers),
    notices,
    sources: `owner=${ownerConfig ? "yes" : "no"} repo=${repoConfig?.path ?? "none"}`,
  };
}

/**
 * Runs one attempt of a review job. Safe to call for any id from any source
 * (queue, dispatcher, duplicates): only the caller that claims the job runs
 * it, and it publishes only while it still owns the job and the job's commit
 * is still the PR head, both in the database and on GitHub.
 */
export function createReviewProcessor(deps: ReviewDependencies) {
  return async function processReview(
    reviewJobId: number,
  ): Promise<ReviewOutcome> {
    let stage = "claim";
    let lease: Awaited<ReturnType<typeof claimReviewJob>> = null;
    let stopHeartbeat: (() => void) | undefined;
    try {
      lease = await claimReviewJob(reviewJobId);
      if (!lease) {
        console.info(
          `[worker] stage=review.skipped job=${reviewJobId} reason=not_due_or_claimed`,
        );
        return "skipped";
      }
      stopHeartbeat = startLeaseHeartbeat(lease);
      console.info(
        `[worker] stage=review.started job=${reviewJobId} attempt=${lease.attempts}`,
      );

      const { pullRequest } = lease;
      const pr: PullRequestRef = {
        installationId: pullRequest.installationId,
        owner: pullRequest.repoOwner,
        repo: pullRequest.repoName,
        prNumber: pullRequest.prNumber,
      };
      const supersede = async (currentHeadSha: string) => {
        stage = "supersede";
        const retired = await markSuperseded(lease!, currentHeadSha);
        console.info(
          `[worker] stage=review.superseded job=${reviewJobId} pr=${pr.prNumber} head=${currentHeadSha}`,
        );
        return retired ? "superseded" : "lost";
      };

      stage = "github_fetch";
      const [files, metadata] = await Promise.all([
        deps.fetchFiles(pr),
        deps.fetchDetails(pr),
      ]);
      if (metadata.headSha !== lease.headSha) {
        return await supersede(metadata.headSha);
      }
      console.info(
        `[worker] stage=github.pull_request.loaded repository=${pr.owner}/${pr.repo} pr=${pr.prNumber} files=${files.length}`,
      );

      // Read from the base commit: a pull request must not be able to change
      // how it is itself reviewed (or switch its own review off).
      stage = "review_settings";
      const { settings, notices, sources } = await loadReviewSettings(
        deps,
        pr,
        metadata.baseSha,
      );
      console.info(
        `[worker] stage=review.settings.loaded job=${reviewJobId} profile=${settings.profile} ${sources} notices=${notices.length}`,
      );
      const skipReason = reviewSkipReason(settings, {
        title: metadata.title,
        author: metadata.author,
        draft: metadata.draft,
        baseRef: metadata.baseRef,
        action: pullRequest.action,
      });
      if (skipReason) {
        stage = "database_complete";
        if (!(await markCompleted(lease, 0, skipReason))) return "lost";
        console.info(
          `[worker] stage=review.not_reviewed job=${reviewJobId} pr=${pr.prNumber} reason="${skipReason}"`,
        );
        return "not_reviewed";
      }

      // A synchronize event always replaces the PR graph before context is
      // read. Fresh PRs take the same initialization path, so both cases have
      // a graph snapshot at precisely the SHA presented to the model.
      stage = "neo4j_index";
      await deps.indexCommit(pr, lease.headSha);

      // Lockfiles, generated code, binaries and the like only cost tokens.
      const builtIn = filterReviewableFiles(files);
      const configured = excludeConfiguredPaths(
        builtIn.reviewable,
        settings.excludePaths,
      );
      const reviewable = configured.kept;
      const excluded = [...builtIn.excluded, ...configured.excluded];
      console.info(
        `[worker] stage=review.files.filtered job=${reviewJobId} reviewable=${reviewable.length} excluded=${excluded.length}`,
      );
      const changedFiles = reviewable.map((file) => ({
        filePath: file.filePath,
        status: ["added", "modified", "removed", "renamed"].includes(
          file.status,
        )
          ? (file.status as "added" | "modified" | "removed" | "renamed")
          : ("changed" as const),
        patch: file.patch!,
      }));
      const graph = await deps.loadGraphContext({
        repositoryUrl: repositoryUrl(pr),
        branch: graphBranch(pr.prNumber),
        changedFiles: changedFiles.map((file) => file.filePath),
      });
      console.info(
        `[worker] stage=neo4j.context.loaded repository=${pr.owner}/${pr.repo} pr=${pr.prNumber} commit=${graph.indexedCommit} traces=${graph.traces.length}`,
      );

      stage = "model_settings";
      const modelConfig = await deps.loadModelConfig(pullRequest.repoOwner);
      console.info(
        `[worker] stage=review.model.selected job=${reviewJobId} provider=${modelConfig?.provider ?? "default"} model=${modelConfig?.model ?? "default"}`,
      );

      const promptFor = (filePaths: string[]) =>
        buildReviewPrompt({
          profile: settings.profile,
          guidelines: settings.guidelines,
          pathInstructions: pathInstructionsFor(settings.pathInstructions, filePaths),
          tone: settings.tone,
        });

      stage = "context_validation";
      const plan = planReview({
        pullRequest: {
          repository: `${pr.owner}/${pr.repo}`,
          number: pr.prNumber,
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
      }, fitBudgetToContextWindow(
        reviewBudgetFromEnv(),
        modelConfig?.contextWindow,
        // The largest prompt any chunk can get: every matching path instruction.
        reservedReviewTokens(
          promptFor(changedFiles.map((file) => file.filePath)),
        ),
      ));
      if (plan.truncatedFiles.length > 0) {
        console.warn(
          `[worker] stage=review.budget_exceeded job=${reviewJobId} chunks=${plan.contexts.length} truncated_files=${plan.truncatedFiles.length}`,
        );
      }

      stage = "llm_review";
      // Chunks run one at a time: free-tier models rate-limit bursts, and the
      // lease heartbeat keeps the job owned however long this takes.
      const chunkResults = [];
      for (const [index, context] of plan.contexts.entries()) {
        console.info(
          `[worker] stage=llm.request.started job=${reviewJobId} chunk=${index + 1}/${plan.contexts.length} files=${context.changedFiles.length}`,
        );
        const prompt = promptFor(
          context.changedFiles.map((file) => file.filePath),
        );
        const result = await deps.review(context, prompt, modelConfig);
        console.info(
          `[worker] stage=llm.request.completed job=${reviewJobId} chunk=${index + 1}/${plan.contexts.length} findings=${result.reviews.length}`,
        );
        chunkResults.push({ context, result });
      }
      const resultObject = mergeReviewResults(
        chunkResults,
        { excluded, truncatedFiles: plan.truncatedFiles },
        reviewLimits(settings),
      );

      // The review took a while; the PR may have moved on. Only the current
      // head's review may reach the PR, and only from the attempt that owns it.
      stage = "publish_gate";
      if (!(await canPublish(lease))) {
        console.info(
          `[worker] stage=review.publish_blocked job=${reviewJobId} reason=superseded_or_lease_lost`,
        );
        return "lost";
      }
      const latest = await deps.fetchDetails(pr);
      if (latest.headSha !== lease.headSha) {
        return await supersede(latest.headSha);
      }

      stage = "github_comment";
      // A PR has one Lorica comment; each newer commit's review replaces it.
      const marker = reviewCommentMarker(lease.id);
      const body = `${renderReview(resultObject, {
        fixPrompt: settings.style.fixPrompt,
        profile: PROFILE_PRESETS[settings.profile].label,
        notices,
      })}\n\n${marker}`;
      const existing = await deps.findComment(pr);
      if (existing?.body.includes(marker)) {
        // A previous attempt published the review but died before recording it.
        console.info(
          `[worker] stage=github.comment.already_posted repository=${pr.owner}/${pr.repo} pr=${pr.prNumber}`,
        );
      } else if (existing) {
        console.info(
          `[worker] stage=github.comment.update.started repository=${pr.owner}/${pr.repo} pr=${pr.prNumber} comment=${existing.id}`,
        );
        await deps.updateComment(pr, existing.id, body);
        console.info(
          `[worker] stage=github.comment.update.completed repository=${pr.owner}/${pr.repo} pr=${pr.prNumber} comment=${existing.id}`,
        );
      } else {
        console.info(
          `[worker] stage=github.comment.post.started repository=${pr.owner}/${pr.repo} pr=${pr.prNumber}`,
        );
        await deps.postComment(pr, body);
        console.info(
          `[worker] stage=github.comment.post.completed repository=${pr.owner}/${pr.repo} pr=${pr.prNumber}`,
        );
      }

      stage = "database_complete";
      if (!(await markCompleted(lease, resultObject.reviews.length))) {
        return "lost";
      }
      console.info(
        `[worker] stage=review.completed job=${reviewJobId} pr=${pr.prNumber} findings=${resultObject.reviews.length}`,
      );
      return "completed";
    } catch (error) {
      const errorType = error instanceof Error ? error.name : "unknown";
      console.error(
        `[worker] stage=review.${stage}.failed job=${reviewJobId} error_type=${errorType}`,
      );
      // Claim failed (database down): the job stays due for the dispatcher.
      if (!lease) return "skipped";

      const failure = isPermanentGitHubError(error)
        ? new PermanentReviewError(
            error instanceof Error ? error.message : String(error),
          )
        : error;
      try {
        const outcome = await recordFailure(lease, failure);
        console.info(
          `[worker] stage=review.status_updated job=${reviewJobId} status=${outcome} attempt=${lease.attempts}`,
        );
        return outcome;
      } catch (recordError) {
        const recordErrorType =
          recordError instanceof Error ? recordError.name : "unknown";
        console.error(
          `[worker] stage=review.failure_status_update.failed job=${reviewJobId} error_type=${recordErrorType}`,
        );
        // The lapsed lease will make the job due again.
        return "retry";
      }
    } finally {
      stopHeartbeat?.();
    }
  };
}

export const processReview = createReviewProcessor(githubDependencies);
