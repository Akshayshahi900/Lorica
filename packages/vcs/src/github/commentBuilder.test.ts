import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderAgentPrompt, renderReview } from "./commentBuilder";
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

  it("renders each finding as a collapsible section, most severe first", () => {
    const body = renderReview({
      summary: "Two issues.",
      reviews: [{ ...finding, severity: "low", suggestion: undefined }, finding],
    });
    assert.equal(body.match(/<details>/g)?.length, 3); // two findings + agent prompt
    assert.match(body, /2 issues found\*\* · 🔴 1 critical · 🔵 1 low/);
    assert.ok(body.indexOf("🔴 <b>1. Secret leaked.") < body.indexOf("🔵 <b>2. Secret leaked."));
    assert.match(body, /Critical · security · <code>src\/app\.ts:12<\/code>/);
    assert.match(body, /```ts\nconst x = y;\n```/);
    assert.equal(body.match(/Suggested fix\*\*/g)?.length, 1);
  });

  it("escapes HTML and keeps long headlines to one line", () => {
    const body = renderReview({
      summary: "s",
      reviews: [{ ...finding, comment: `Uses \`a<b>\` here. ${"word ".repeat(40)}` }],
    });
    assert.match(body, /<b>1\. Uses <code>a&lt;b&gt;<\/code> here\.<\/b>/);

    const long = renderReview({ summary: "s", reviews: [{ ...finding, comment: "word ".repeat(40) }] });
    const headline = long.match(/<b>1\. (.*?)<\/b>/)![1]!;
    assert.ok(headline.length <= 91 && headline.endsWith("…"));
  });

  it("includes a copyable agent prompt covering every finding", () => {
    const body = renderReview({
      summary: "s",
      reviews: [finding, { ...finding, filePath: "src/db.ts", lineNumber: 40, suggestion: undefined }],
    });
    const prompt = renderAgentPrompt([finding]);
    assert.match(body, /Fix with your AI coding assistant/);
    assert.match(body, /```text\nYou are fixing issues/);
    assert.match(body, /1\. \[critical · security\] src\/app\.ts:12/);
    assert.match(body, /2\. \[critical · security\] src\/db\.ts:40/);
    assert.match(prompt, /Issue:\n {5}Secret leaked\.\n {3}Suggested fix:\n {5}Read it from the environment\./);
  });

  it("uses a longer fence when the code snippet contains backticks", () => {
    const body = renderReview({
      summary: "s",
      reviews: [{ ...finding, code: "const md = `\n```\n`;" }],
    });
    assert.match(body, /````ts\nconst md/);
  });
});
