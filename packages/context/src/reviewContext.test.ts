import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assembleReviewContext } from "./reviewContext";
import {
  ReviewContextSchema,
  ReviewResultSchema,
} from "../../types/src/types";
import { REVIEW_PROMPT } from "../../llm/src/prompt";

const validContext = {
  schemaVersion: "1" as const,
  pullRequest: {
    repository: "acme/widget",
    number: 12,
    title: "Handle empty input",
    description: null,
    author: "octocat",
    baseSha: "base123",
    headSha: "head456",
    event: "fresh" as const,
  },
  changedFiles: [{ filePath: "src/input.ts", status: "modified" as const, patch: "@@ -1 +1 @@" }],
  graph: {
    indexedCommit: "head456",
    traces: [{
      changedFile: "src/input.ts",
      symbol: "parseInput",
      direction: "depended_on_by" as const,
      relationship: "CALLS" as const,
      relatedFile: "src/main.ts",
      relatedSymbol: "main",
      evidence: "main calls parseInput",
    }],
  },
};

describe("review contracts and prompt", () => {
  it("assembles and validates versioned model context", () => {
    const context = assembleReviewContext({
      pullRequest: validContext.pullRequest,
      changedFiles: validContext.changedFiles,
      indexedCommit: validContext.graph.indexedCommit,
      traces: validContext.graph.traces,
      unavailableReason: "none",
    });
    assert.deepEqual(ReviewContextSchema.parse(context), context);
    assert.equal(context.graph.unavailableReason, "none");
  });

  it("rejects invalid context and review result fields", () => {
    assert.equal(ReviewContextSchema.safeParse({ ...validContext, schemaVersion: "2" }).success, false);
    assert.equal(ReviewContextSchema.safeParse({
      ...validContext,
      changedFiles: [{ ...validContext.changedFiles[0], status: "unknown" }],
    }).success, false);
    assert.equal(ReviewResultSchema.safeParse({ summary: "one finding", reviews: [{
      filePath: "src/input.ts", lineNumber: 1.5, code: "x", severity: "urgent",
      category: "bug", comment: "problem",
    }] }).success, false);
    assert.equal(ReviewResultSchema.safeParse({ summary: "clean", reviews: [] }).success, true);
  });

  it("sets evidence and output constraints when constructing the review prompt", () => {
    assert.match(REVIEW_PROMPT, /validated JSON review context/);
    assert.match(REVIEW_PROMPT, /ONLY actionable review findings/);
    assert.match(REVIEW_PROMPT, /exact file path from the diff/);
    assert.match(REVIEW_PROMPT, /Return ONLY valid JSON/);
  });
});
