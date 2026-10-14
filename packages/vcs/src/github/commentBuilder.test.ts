import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderReview } from "./commentBuilder";
import type { ReviewFinding } from "../../../types/src/types";

const finding: ReviewFinding = {
  filePath: "src/app.ts",
  lineNumber: 12,
  code: "const x = y;",
  severity: "critical",
  category: "security",
  comment: "Secret leaked.",
  suggestion: "Read it from the environment.",
};

describe("GitHub review comment rendering", () => {
  it("renders a clean result with the marker and summary", () => {
    const body = renderReview({ summary: "Looks good.", reviews: [] });
    assert.match(body, /^<!-- lorica-review -->/);
    assert.match(body, /No actionable issues found/);
    assert.match(body, /Looks good\./);
  });

  it("renders each finding with location, severity, and optional suggestion", () => {
    const body = renderReview({
      summary: "Two issues.",
      reviews: [finding, { ...finding, severity: "low", suggestion: undefined }],
    });
    assert.match(body, /🔴 1\. `src\/app\.ts:12`/);
    assert.match(body, /🔵 2\. `src\/app\.ts:12`/);
    assert.equal(body.match(/Suggested fix/g)?.length, 1);
  });

  it("uses a longer fence when the code snippet contains backticks", () => {
    const body = renderReview({
      summary: "s",
      reviews: [{ ...finding, code: "const md = `\n```\n`;" }],
    });
    assert.match(body, /````\nconst md/);
  });
});
