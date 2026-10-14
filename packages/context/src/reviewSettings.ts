import picomatch from "picomatch";
import {
  PROFILE_PRESETS,
  REVIEW_SEVERITIES,
  type EffectiveReviewSettings,
  type PathInstruction,
} from "../../types/src/reviewSettings";
import { type ReviewFinding } from "../../types/src/types";
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
    keepStandards: settings.mergeGate.enabled && settings.mergeGate.enforceGuidelines,
  };
}

/** Whether a review lets its pull request merge, and what stops it if not. */
export type MergeVerdict = {
  blocked: boolean;
  /** What blocks the merge, e.g. "2 findings of high severity or worse". */
  reasons: string[];
  /** What the gate blocks on, e.g. "blocks on findings of high severity or worse". */
  rule: string;
};

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * Applies the merge gate to a review's published findings. Guideline
 * violations count on their own when enforced, so a finding is never counted
 * twice.
 */
export function mergeVerdict(
  gate: EffectiveReviewSettings["mergeGate"],
  reviews: ReviewFinding[],
): MergeVerdict {
  const isStandard = (finding: ReviewFinding) =>
    gate.enforceGuidelines && finding.category === "standards";
  const threshold =
    gate.blockOn === "none" ? -1 : REVIEW_SEVERITIES.indexOf(gate.blockOn);
  const severe = reviews.filter(
    (finding) => !isStandard(finding) && REVIEW_SEVERITIES.indexOf(finding.severity) <= threshold,
  ).length;
  const standards = reviews.filter(isStandard).length;

  const level = `${gate.blockOn} severity${gate.blockOn === "critical" ? "" : " or worse"}`;
  const rules = [
    gate.blockOn !== "none" && `findings of ${level}`,
    gate.enforceGuidelines && "coding-guideline violations",
  ].filter((rule): rule is string => Boolean(rule));

  const reasons: string[] = [];
  if (severe > 0) reasons.push(`${plural(severe, "finding")} of ${level}`);
  if (standards > 0) reasons.push(plural(standards, "coding-guideline violation"));
  return {
    blocked: reasons.length > 0,
    reasons,
    rule: rules.length > 0 ? `blocks on ${rules.join(" and ")}` : "nothing is configured to block",
  };
}
