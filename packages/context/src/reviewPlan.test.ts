import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_REVIEW_BUDGET,
  estimateTokens,
  filterReviewableFiles,
  fitBudgetToContextWindow,
  mergeReviewResults,
  planReview,
  splitPatch,
  type ReviewBudget,
} from "./reviewPlan";
import type { ChangedFile, ReviewFinding } from "../../types/src/types";

const pullRequest = {
  repository: "acme/widget",
  number: 7,
  title: "Big change",
  description: null,
  author: "octocat",
  baseSha: "base",
  headSha: "head",
  event: "fresh" as const,
};

/** A one-hunk patch adding `lines` lines starting at new line 1. */
function addedPatch(lines: number, text = "const value = compute();"): string {
  const body = Array.from({ length: lines }, (_, i) => `+${text} // ${i + 1}`);
  return [`@@ -0,0 +1,${lines} @@`, ...body].join("\n");
}

function file(filePath: string, patch = addedPatch(3)): ChangedFile {
  return { filePath, status: "modified", patch };
}

function finding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    filePath: "src/a.ts",
    lineNumber: 1,
    code: "x",
    severity: "medium",
    category: "bug",
    comment: "Problem.",
    ...overrides,
  };
}

/** New-file line numbers of every added line, from the hunk headers. */
function addedLineNumbers(patch: string): number[] {
  const numbers: number[] = [];
  let line = 0;
  for (const text of patch.split("\n")) {
    const header = text.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (header) line = Number(header[1]);
    else if (text.startsWith("+")) numbers.push(line++);
    else if (!text.startsWith("-") && !text.startsWith("\\")) line++;
  }
  return numbers;
}

describe("review file filtering", () => {
  it("excludes files that carry no reviewable code", () => {
    const { reviewable, excluded } = filterReviewableFiles([
      { filePath: "src/app.ts", status: "modified", patch: "@@" },
      { filePath: "app/global.d.ts", status: "modified", patch: "@@" },
      { filePath: "requirements.txt", status: "modified", patch: "@@" },
      { filePath: "pnpm-lock.yaml", status: "modified", patch: "@@" },
      { filePath: "apps/api/generated/prisma/client.ts", status: "modified", patch: "@@" },
      { filePath: "node_modules/x/index.js", status: "added", patch: "@@" },
      { filePath: "public/bundle.min.js", status: "added", patch: "@@" },
      { filePath: "docs/logo.png", status: "added", patch: undefined },
      { filePath: "README.md", status: "modified", patch: "@@" },
      { filePath: "src/old.ts", status: "removed", patch: "@@" },
      { filePath: "src/huge.ts", status: "modified", patch: undefined },
    ]);
    assert.deepEqual(
      reviewable.map((f) => f.filePath),
      ["src/app.ts", "app/global.d.ts", "requirements.txt"],
    );
    assert.deepEqual(
      excluded.map((f) => f.reason),
      ["lockfile", "generated", "vendored", "generated", "asset", "documentation", "removed", "no_patch"],
    );
  });
});

describe("patch splitting", () => {
  it("keeps a patch that fits whole", () => {
    const patch = addedPatch(5);
    assert.deepEqual(splitPatch(patch, 10_000), [patch]);
  });

  it("splits a huge hunk into pieces that fit and keep exact line numbers", () => {
    const patch = [
      "@@ -10,4 +10,6 @@ function run()",
      " keep();",
      "-old();",
      ...Array.from({ length: 200 }, (_, i) => `+added(${i});`),
      " tail();",
      "\\ No newline at end of file",
    ].join("\n");
    const pieces = splitPatch(patch, 300);
    assert.ok(pieces.length > 1);
    for (const piece of pieces) assert.ok(estimateTokens(piece) <= 300 + 30);
    assert.deepEqual(
      pieces.flatMap(addedLineNumbers),
      addedLineNumbers(patch),
    );
    assert.ok(pieces.every((piece) => piece.startsWith("@@ -") && piece.includes("function run()")));
    assert.ok(!pieces.some((piece) => piece.startsWith("@@") && piece.split("\n")[1]?.startsWith("\\")));
  });
});

describe("review planning", () => {
  const budget: ReviewBudget = { ...DEFAULT_REVIEW_BUDGET, diffTokensPerChunk: 2_000, maxChunks: 3 };

  it("uses one chunk for a small PR", () => {
    const plan = planReview({
      pullRequest,
      changedFiles: [file("src/a.ts"), file("src/b.ts")],
      indexedCommit: "head",
      traces: [],
    });
    assert.equal(plan.contexts.length, 1);
    assert.deepEqual(plan.truncatedFiles, []);
  });

  it("bounds every chunk and reports what did not fit", () => {
    const changedFiles = Array.from({ length: 20 }, (_, i) => file(`src/f${i}.ts`, addedPatch(40)));
    const plan = planReview({ pullRequest, changedFiles, indexedCommit: "head", traces: [] }, budget);
    assert.equal(plan.contexts.length, 3);
    for (const context of plan.contexts) {
      assert.ok(estimateTokens(context.changedFiles) <= budget.diffTokensPerChunk);
    }
    const planned = plan.contexts.flatMap((c) => c.changedFiles.map((f) => f.filePath));
    assert.equal(planned.length + plan.truncatedFiles.length, 20);
  });

  it("reviews source before tests when the budget runs out", () => {
    const changedFiles = [
      file("src/a.test.ts", addedPatch(120)),
      file("src/z.ts", addedPatch(120)),
    ];
    const plan = planReview(
      { pullRequest, changedFiles, indexedCommit: "head", traces: [] },
      { ...budget, maxChunks: 1 },
    );
    assert.deepEqual(plan.contexts[0]!.changedFiles.map((f) => f.filePath), ["src/z.ts"]);
    assert.deepEqual(plan.truncatedFiles, ["src/a.test.ts"]);
  });

  it("gives each chunk only its own files' graph traces and truncates long descriptions", () => {
    const trace = (changedFile: string) => ({
      changedFile,
      symbol: null,
      direction: "depends_on" as const,
      relationship: "IMPORTS" as const,
      relatedFile: "src/lib.ts",
      relatedSymbol: null,
      evidence: `${changedFile} imports src/lib.ts`,
    });
    const plan = planReview(
      {
        pullRequest: { ...pullRequest, description: "x".repeat(10_000) },
        changedFiles: [file("src/a.ts", addedPatch(120)), file("src/b.ts", addedPatch(120))],
        indexedCommit: "head",
        traces: [trace("src/a.ts"), trace("src/b.ts")],
      },
      budget,
    );
    assert.equal(plan.contexts.length, 2);
    assert.deepEqual(plan.contexts.map((c) => c.graph.traces.map((t) => t.changedFile)), [["src/a.ts"], ["src/b.ts"]]);
    assert.ok(plan.contexts[0]!.pullRequest.description!.length < 2_100);
  });
});

describe("merging chunk results", () => {
  const plan = planReview({
    pullRequest,
    changedFiles: [file("src/a.ts"), file("src/b.ts")],
    indexedCommit: "head",
    traces: [],
  });
  const context = plan.contexts[0]!;

  it("combines findings, drops ones for files not shown, and keeps the worst duplicate", () => {
    const merged = mergeReviewResults(
      [
        { context, result: { summary: "a", reviews: [finding({ severity: "low" }), finding({ filePath: "src/ghost.ts" })] } },
        { context, result: { summary: "b", reviews: [finding({ severity: "high" }), finding({ filePath: "src/b.ts", severity: "critical" })] } },
      ],
      { excluded: [{ filePath: "pnpm-lock.yaml", reason: "lockfile" }], truncatedFiles: ["src/huge.ts"] },
    );
    assert.deepEqual(
      merged.reviews.map((r) => `${r.filePath}:${r.severity}`),
      ["src/b.ts:critical", "src/a.ts:high"],
    );
    assert.match(merged.summary, /Found 2 concrete issues across 2 reviewed files/);
    assert.match(merged.summary, /Skipped 1 file /);
    assert.match(merged.summary, /`src\/huge.ts` were not fully reviewed/);
  });

  it("enforces the settings' severity floor and finding cap, and says what it hid", () => {
    const reviews = [
      finding({ lineNumber: 1, severity: "low" }),
      finding({ lineNumber: 2, severity: "high" }),
      finding({ lineNumber: 3, severity: "critical" }),
      finding({ lineNumber: 4, severity: "high" }),
    ];
    const merged = mergeReviewResults(
      [{ context, result: { summary: "", reviews } }],
      { excluded: [{ filePath: "e2e/a.spec.ts", reason: "configured" }], truncatedFiles: [] },
      { minSeverity: "high", maxFindings: 2, label: "Quiet" },
    );
    assert.deepEqual(merged.reviews.map((r) => r.lineNumber), [3, 2]);
    assert.match(merged.summary, /Found 3 concrete issues across 2 reviewed files\./);
    assert.match(merged.summary, /1 lower-severity finding was hidden by the Quiet review settings/);
    assert.match(merged.summary, /Showing the 2 most severe; 1 more was left out/);
    assert.match(merged.summary, /Skipped 1 file excluded by the review settings/);
    assert.doesNotMatch(merged.summary, /cannot carry reviewable code/);
  });

  it("reports a clean review when every finding is below the floor", () => {
    const merged = mergeReviewResults(
      [{ context, result: { summary: "", reviews: [finding({ severity: "low" })] } }],
      { excluded: [], truncatedFiles: [] },
      { minSeverity: "high", maxFindings: 5, label: "Quiet" },
    );
    assert.deepEqual(merged.reviews, []);
    assert.match(merged.summary, /^No high-severity or worse issues found in 2 reviewed files\./);
  });

  it("says so when nothing was reviewable", () => {
    const merged = mergeReviewResults([], { excluded: [], truncatedFiles: [] });
    assert.deepEqual(merged, { summary: "No reviewable code changes in this PR.", reviews: [] });
  });
});

describe("fitting the budget to a context window", () => {
  it("leaves the budget alone when the window is unknown or large enough", () => {
    assert.equal(fitBudgetToContextWindow(DEFAULT_REVIEW_BUDGET, undefined, 10_000), DEFAULT_REVIEW_BUDGET);
    assert.equal(fitBudgetToContextWindow(DEFAULT_REVIEW_BUDGET, 200_000, 10_000), DEFAULT_REVIEW_BUDGET);
  });

  it("shrinks chunks so a request fits a small window", () => {
    const fitted = fitBudgetToContextWindow(DEFAULT_REVIEW_BUDGET, 16_384, 10_000);
    assert.ok(fitted.diffTokensPerChunk + fitted.traceTokensPerChunk <= 16_384 - 10_000);
    assert.ok(fitted.diffTokensPerChunk > fitted.traceTokensPerChunk);
    assert.equal(fitted.maxChunks, DEFAULT_REVIEW_BUDGET.maxChunks);
  });
});
