import picomatch from "picomatch";
import {
  PROFILE_PRESETS,
  type EffectiveReviewSettings,
  type PathInstruction,
} from "../../types/src/reviewSettings";
import { type ExcludedFile, type ReviewLimits } from "./reviewPlan";

/**
 * Patterns without a slash match the file name anywhere (`*.test.ts`); others
 * match the whole path (`docs/**`).
 */
function globMatcher(patterns: string[]): (path: string) => boolean {
  // picomatch's own `basename` option applies to every pattern, slashes or not.
  const byName = patterns.filter((pattern) => !pattern.includes("/"));
  const byPath = patterns.filter((pattern) => pattern.includes("/"));
  const nameMatches = byName.length ? picomatch(byName, { dot: true }) : () => false;
  const pathMatches = byPath.length ? picomatch(byPath, { dot: true }) : () => false;
  return (path) => pathMatches(path) || nameMatches(path.split("/").pop() ?? path);
}

export type PullRequestFacts = {
  title: string | null;
  author: string | null;
  draft: boolean;
  baseRef: string;
  /** The webhook action that queued this review. */
  action: string;
};

/**
 * Why the workflow settings say this pull request should not be reviewed, or
 * null when it should be.
 */
export function reviewSkipReason(
  settings: EffectiveReviewSettings,
  pr: PullRequestFacts,
): string | null {
  const { workflow } = settings;
  if (!workflow.autoReview) return "automatic reviews are turned off";
  if (pr.draft && !workflow.reviewDrafts) return "draft pull requests are not reviewed";
  if (pr.action === "synchronize" && !workflow.reviewOnPush) {
    return "new commits are not reviewed";
  }
  if (
    workflow.baseBranches.length > 0 &&
    !picomatch.isMatch(pr.baseRef, workflow.baseBranches)
  ) {
    return `base branch ${pr.baseRef} is not configured for review`;
  }
  const title = (pr.title ?? "").toLowerCase();
  const keyword = workflow.ignoreTitleKeywords.find((word) =>
    title.includes(word.toLowerCase()),
  );
  if (keyword) return `the title contains "${keyword}"`;
  if (pr.author && workflow.ignoreAuthors.includes(pr.author.toLowerCase())) {
    return `pull requests by ${pr.author} are not reviewed`;
  }
  return null;
}

/** Removes files matching the settings' `excludePaths`. */
export function excludeConfiguredPaths<T extends { filePath: string }>(
  files: T[],
  patterns: string[],
): { kept: T[]; excluded: ExcludedFile[] } {
  const matches = globMatcher(patterns);
  const kept: T[] = [];
  const excluded: ExcludedFile[] = [];
  for (const file of files) {
    if (matches(file.filePath)) {
      excluded.push({ filePath: file.filePath, reason: "configured" });
    } else {
      kept.push(file);
    }
  }
  return { kept, excluded };
}

/** The path instructions that apply to at least one of `filePaths`. */
export function pathInstructionsFor(
  instructions: PathInstruction[],
  filePaths: string[],
): PathInstruction[] {
  return instructions.filter((instruction) => {
    const matches = globMatcher([instruction.path]);
    return filePaths.some(matches);
  });
}

/** The severity floor and finding cap `mergeReviewResults` enforces. */
export function reviewLimits(settings: EffectiveReviewSettings): ReviewLimits {
  return {
    minSeverity: settings.style.minSeverity,
    maxFindings: settings.style.maxFindings,
    label: PROFILE_PRESETS[settings.profile].label,
  };
}
