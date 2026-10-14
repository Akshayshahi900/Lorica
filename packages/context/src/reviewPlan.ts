import {
  type ChangedFile,
  type GraphTrace,
  type PrMetadata,
  type ReviewContext,
  type ReviewFinding,
  type ReviewResult,
} from "../../types/src/types";
import { assembleReviewContext } from "./reviewContext";

// ---------------------------------------------------------------------------
// File filtering
// ---------------------------------------------------------------------------

export type ExclusionReason =
  | "no_patch" // binary, or too large for GitHub to return a diff
  | "removed" // nothing added, so no line a finding could point to
  | "lockfile"
  | "generated"
  | "vendored"
  | "asset"
  | "documentation"
  | "configured"; // matched the review settings' excludePaths

export type ExcludedFile = { filePath: string; reason: ExclusionReason };

const LOCKFILES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "npm-shrinkwrap.json",
  "cargo.lock",
  "poetry.lock",
  "pipfile.lock",
  "uv.lock",
  "composer.lock",
  "gemfile.lock",
  "go.sum",
  "packages.lock.json",
  "podfile.lock",
  "pubspec.lock",
  "mix.lock",
  "flake.lock",
]);

const VENDORED_DIRS = /(^|\/)(node_modules|vendor|third_party|bower_components|\.yarn)\//;
const GENERATED_DIRS =
  /(^|\/)(dist|coverage|generated|__generated__|\.next|\.turbo|\.nuxt)\//;
const GENERATED_FILES =
  /(\.min\.(js|css)|\.map|\.snap|\.pb\.go|_pb2\.py|\.g\.dart|\.generated\.\w+)$/;
const ASSET_EXTENSIONS =
  /\.(png|jpe?g|gif|webp|bmp|ico|svg|avif|mp3|mp4|mov|webm|wav|ogg|woff2?|ttf|otf|eot|pdf|zip|gz|tgz|tar|jar|wasm|exe|dll|so|dylib|bin)$/;
const DOCUMENTATION = /(\.(md|mdx|rst|adoc)$)|(^|\/)(LICEN[CS]E|CHANGELOG|AUTHORS|NOTICE)[^/]*$/i;

function exclusionReason(file: {
  filePath: string;
  status: string;
  patch?: string | null;
}): ExclusionReason | null {
  const path = file.filePath;
  const name = path.split("/").pop()!.toLowerCase();
  if (LOCKFILES.has(name)) return "lockfile";
  if (VENDORED_DIRS.test(path)) return "vendored";
  if (GENERATED_DIRS.test(path) || GENERATED_FILES.test(name)) return "generated";
  if (ASSET_EXTENSIONS.test(name)) return "asset";
  if (DOCUMENTATION.test(path)) return "documentation";
  if (file.status === "removed") return "removed";
  if (!file.patch) return "no_patch";
  return null;
}

/**
 * Splits a PR's files into those worth sending to the model and those that
 * only cost tokens: lockfiles, generated or vendored code, binaries, docs and
 * deletions. Excluded files are returned so the review can say what it skipped.
 */
export function filterReviewableFiles<
  T extends { filePath: string; status: string; patch?: string | null },
>(files: T[]): { reviewable: T[]; excluded: ExcludedFile[] } {
  const reviewable: T[] = [];
  const excluded: ExcludedFile[] = [];
  for (const file of files) {
    const reason = exclusionReason(file);
    if (reason) excluded.push({ filePath: file.filePath, reason });
    else reviewable.push(file);
  }
  return { reviewable, excluded };
}

// ---------------------------------------------------------------------------
// Token-aware chunking
// ---------------------------------------------------------------------------

/**
 * A deliberately pessimistic token estimate (~3 characters per token) of the
 * JSON the model receives. No tokenizer matches every OpenRouter model, and
 * overestimating only costs an extra chunk, while underestimating overflows.
 */
export function estimateTokens(value: unknown): number {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return Math.ceil(text.length / 3);
}

export type ReviewBudget = {
  /** Patch tokens per model request. */
  diffTokensPerChunk: number;
  /** Graph-trace tokens per model request, on top of the patches. */
  traceTokensPerChunk: number;
  /** Model requests per review; changes beyond this are left unreviewed. */
  maxChunks: number;
  /** The PR description is author prose; only its start is useful context. */
  maxDescriptionChars: number;
};

export const DEFAULT_REVIEW_BUDGET: ReviewBudget = {
  diffTokensPerChunk: 16_000,
  traceTokensPerChunk: 3_000,
  maxChunks: 8,
  maxDescriptionChars: 2_000,
};

/** Reads budget overrides from REVIEW_* environment variables. */
export function reviewBudgetFromEnv(
  env: Record<string, string | undefined> = process.env,
): ReviewBudget {
  const read = (name: string, fallback: number) => {
    const value = Number(env[name]);
    return Number.isInteger(value) && value > 0 ? value : fallback;
  };
  return {
    diffTokensPerChunk: read("REVIEW_DIFF_TOKENS_PER_CHUNK", DEFAULT_REVIEW_BUDGET.diffTokensPerChunk),
    traceTokensPerChunk: read("REVIEW_TRACE_TOKENS_PER_CHUNK", DEFAULT_REVIEW_BUDGET.traceTokensPerChunk),
    maxChunks: read("REVIEW_MAX_CHUNKS", DEFAULT_REVIEW_BUDGET.maxChunks),
    maxDescriptionChars: read("REVIEW_MAX_DESCRIPTION_CHARS", DEFAULT_REVIEW_BUDGET.maxDescriptionChars),
  };
}

/** Smallest diff budget per chunk; below it a hunk loses its surroundings. */
const MIN_DIFF_TOKENS_PER_CHUNK = 1_000;

/**
 * Shrinks the per-chunk budgets so one chunk, plus the `reservedTokens` every
 * request spends on the prompt, metadata and answer, fits in a model's
 * context window. A smaller model gets more, smaller chunks rather than a
 * request it cannot read. An unknown window leaves the budget unchanged.
 */
export function fitBudgetToContextWindow(
  budget: ReviewBudget,
  contextWindow: number | null | undefined,
  reservedTokens: number,
): ReviewBudget {
  if (!contextWindow) return budget;
  const available = contextWindow - reservedTokens;
  if (available >= budget.diffTokensPerChunk + budget.traceTokensPerChunk) {
    return budget;
  }
  const traceTokensPerChunk = Math.max(
    0,
    Math.min(budget.traceTokensPerChunk, Math.floor(available * 0.15)),
  );
  return {
    ...budget,
    traceTokensPerChunk,
    diffTokensPerChunk: Math.max(
      MIN_DIFF_TOKENS_PER_CHUNK,
      available - traceTokensPerChunk,
    ),
  };
}

const HUNK_HEADER =/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/;

/**
 * Re-cuts one hunk into hunks of at most `maxTokens`, each with a header
 * recomputed for its own lines, so line numbers stay exact in every piece.
 */
function splitHunk(hunk: string, maxTokens: number): string[] {
  const [header, ...lines] = hunk.split("\n");
  const match = header!.match(HUNK_HEADER);
  if (!match) return [hunk];
  let oldLine = Number(match[1]);
  let newLine = Number(match[2]);
  const section = match[3];

  const pieces: string[] = [];
  let body: string[] = [];
  let start = { old: oldLine, new: newLine };
  let counts = { old: 0, new: 0 };
  const flush = () => {
    if (body.length === 0) return;
    pieces.push(
      `@@ -${start.old},${counts.old} +${start.new},${counts.new} @@${section}\n${body.join("\n")}`,
    );
    body = [];
    start = { old: oldLine, new: newLine };
    counts = { old: 0, new: 0 };
  };

  let bodyTokens = 0;
  for (const line of lines) {
    const lineTokens = estimateTokens(line) + 1;
    // "\ No newline at end of file" belongs to the line before it.
    if (bodyTokens + lineTokens > maxTokens && !line.startsWith("\\")) {
      flush();
      bodyTokens = 0;
    }
    body.push(line);
    bodyTokens += lineTokens;
    if (line.startsWith("+")) {
      counts.new++;
      newLine++;
    } else if (line.startsWith("-")) {
      counts.old++;
      oldLine++;
    } else if (!line.startsWith("\\")) {
      counts.old++;
      counts.new++;
      oldLine++;
      newLine++;
    }
  }
  flush();
  return pieces;
}

/** Splits a patch at hunk boundaries (and inside huge hunks) to fit `maxTokens`. */
export function splitPatch(patch: string, maxTokens: number): string[] {
  if (estimateTokens(patch) <= maxTokens) return [patch];

  const hunks = patch.split(/\n(?=@@ )/);
  const pieces: string[] = [];
  let current = "";
  for (const hunk of hunks) {
    const parts = estimateTokens(hunk) > maxTokens ? splitHunk(hunk, maxTokens) : [hunk];
    for (const part of parts) {
      const joined = current ? `${current}\n${part}` : part;
      if (current && estimateTokens(joined) > maxTokens) {
        pieces.push(current);
        current = part;
      } else {
        current = joined;
      }
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

/** Source before tests before config, so a capped review spends tokens where bugs live. */
function priority(filePath: string): number {
  if (/(^|\/)(__tests__|tests?|spec|e2e|fixtures?)\/|\.(test|spec)\.\w+$/i.test(filePath)) {
    return 1;
  }
  if (/\.(json|ya?ml|toml|ini|cfg|conf|lock|env\w*|xml|csv)$/i.test(filePath)) return 2;
  return 0;
}

export type ReviewPlan = {
  /** One validated model input per chunk, each within the budget. */
  contexts: ReviewContext[];
  /** Reviewable files (or parts of them) that did not fit within maxChunks. */
  truncatedFiles: string[];
};

/**
 * Packs the changed files into at most `maxChunks` review contexts. Files are
 * kept whole when possible and split at hunk boundaries when not; each chunk
 * carries only the graph traces for its own files.
 */
export function planReview(
  input: {
    pullRequest: PrMetadata;
    changedFiles: ChangedFile[];
    indexedCommit: string;
    traces: GraphTrace[];
    unavailableReason?: string;
  },
  budget: ReviewBudget = DEFAULT_REVIEW_BUDGET,
): ReviewPlan {
  const ordered = [...input.changedFiles].sort(
    (a, b) => priority(a.filePath) - priority(b.filePath) || a.filePath.localeCompare(b.filePath),
  );
  const pieces = ordered.flatMap((file) => {
    const overhead = estimateTokens({ ...file, patch: "" });
    return splitPatch(file.patch, budget.diffTokensPerChunk - overhead).map((patch) => ({
      ...file,
      patch,
    }));
  });

  const chunks: { files: ChangedFile[]; tokens: number }[] = [];
  const truncated = new Set<string>();
  for (const piece of pieces) {
    const tokens = estimateTokens(piece);
    const last = chunks.at(-1);
    if (tokens > budget.diffTokensPerChunk) {
      // A single line too long to split, such as minified code.
      truncated.add(piece.filePath);
    } else if (last && last.tokens + tokens <= budget.diffTokensPerChunk) {
      last.files.push(piece);
      last.tokens += tokens;
    } else if (chunks.length < budget.maxChunks) {
      chunks.push({ files: [piece], tokens });
    } else {
      // Out of chunks: use leftover room in any chunk before giving up.
      const room = chunks.find((chunk) => chunk.tokens + tokens <= budget.diffTokensPerChunk);
      if (room) {
        room.files.push(piece);
        room.tokens += tokens;
      } else {
        truncated.add(piece.filePath);
      }
    }
  }

  const description = input.pullRequest.description;
  const pullRequest: PrMetadata = {
    ...input.pullRequest,
    description:
      description && description.length > budget.maxDescriptionChars
        ? `${description.slice(0, budget.maxDescriptionChars)}… (truncated)`
        : description,
  };

  const contexts = chunks.map((chunk) => {
    const paths = new Set(chunk.files.map((file) => file.filePath));
    const traces: GraphTrace[] = [];
    let traceTokens = 0;
    for (const trace of input.traces) {
      if (!paths.has(trace.changedFile)) continue;
      const tokens = estimateTokens(trace);
      if (traceTokens + tokens > budget.traceTokensPerChunk) break;
      traces.push(trace);
      traceTokens += tokens;
    }
    return assembleReviewContext({
      pullRequest,
      changedFiles: chunk.files,
      indexedCommit: input.indexedCommit,
      traces,
      unavailableReason: input.unavailableReason,
    });
  });

  return { contexts, truncatedFiles: [...truncated] };
}

// ---------------------------------------------------------------------------
// Merging per-chunk results
// ---------------------------------------------------------------------------

const SEVERITY_RANK: Record<ReviewFinding["severity"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** The review settings' severity floor and finding cap; `label` names them in the summary. */
export type ReviewLimits = {
  minSeverity: ReviewFinding["severity"];
  maxFindings: number;
  label: string;
};

/**
 * Combines the per-chunk results into the single review a PR receives.
 * Findings on files a chunk was not shown are dropped as hallucinated, and a
 * line reported twice (a file split across chunks) keeps its most severe
 * finding. Findings below `limits.minSeverity`, or past `limits.maxFindings`,
 * are dropped. The summary says how much of the PR was actually reviewed.
 */
export function mergeReviewResults(
  chunks: { context: ReviewContext; result: ReviewResult }[],
  coverage: { excluded: ExcludedFile[]; truncatedFiles: string[] },
  limits?: ReviewLimits,
): ReviewResult {
  const byLine = new Map<string, ReviewFinding>();
  const reviewedFiles = new Set<string>();
  for (const { context, result } of chunks) {
    const shown = new Set(context.changedFiles.map((file) => file.filePath));
    shown.forEach((path) => reviewedFiles.add(path));
    for (const finding of result.reviews) {
      if (!shown.has(finding.filePath)) continue;
      const key = `${finding.filePath}:${finding.lineNumber}:${finding.category}`;
      const existing = byLine.get(key);
      if (!existing || SEVERITY_RANK[finding.severity] < SEVERITY_RANK[existing.severity]) {
        byLine.set(key, finding);
      }
    }
  }

  const sorted = [...byLine.values()].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      a.filePath.localeCompare(b.filePath) ||
      a.lineNumber - b.lineNumber,
  );
  // The model is asked to respect these too; enforcing them here makes them hold.
  const atSeverity = limits
    ? sorted.filter((finding) => SEVERITY_RANK[finding.severity] <= SEVERITY_RANK[limits.minSeverity])
    : sorted;
  const reviews = limits ? atSeverity.slice(0, limits.maxFindings) : atSeverity;
  const belowSeverity = sorted.length - atSeverity.length;
  const overLimit = atSeverity.length - reviews.length;

  const sentences = [
    reviewedFiles.size === 0
      ? "No reviewable code changes in this PR."
      : reviews.length === 0
      ? `No ${belowSeverity > 0 ? `${limits!.minSeverity}-severity or worse ` : "concrete "}issues found in ${plural(reviewedFiles.size, "reviewed file")}.`
      : `Found ${plural(atSeverity.length, "concrete issue")} across ${plural(reviewedFiles.size, "reviewed file")}.`,
  ];
  if (belowSeverity > 0) {
    sentences.push(
      `${plural(belowSeverity, "lower-severity finding")} ${belowSeverity === 1 ? "was" : "were"} hidden by the ${limits!.label} review settings.`,
    );
  }
  if (overLimit > 0) {
    sentences.push(`Showing the ${limits!.maxFindings} most severe; ${overLimit} more ${overLimit === 1 ? "was" : "were"} left out.`);
  }
  const configured = coverage.excluded.filter((file) => file.reason === "configured").length;
  const builtIn = coverage.excluded.length - configured;
  if (builtIn > 0) {
    sentences.push(
      `Skipped ${plural(builtIn, "file")} that cannot carry reviewable code (lockfiles, generated, vendored, binary, docs or deleted).`,
    );
  }
  if (configured > 0) {
    sentences.push(`Skipped ${plural(configured, "file")} excluded by the review settings.`);
  }
  if (coverage.truncatedFiles.length > 0) {
    const shown = coverage.truncatedFiles.slice(0, 5).map((path) => `\`${path}\``).join(", ");
    const more = coverage.truncatedFiles.length > 5 ? `, and ${coverage.truncatedFiles.length - 5} more` : "";
    sentences.push(
      `This PR exceeds the review size budget; changes in ${shown}${more} were not fully reviewed.`,
    );
  }
  return { summary: sentences.join(" "), reviews };
}
