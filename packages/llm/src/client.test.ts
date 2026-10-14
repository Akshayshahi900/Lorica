import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseReviewResult } from "./client";

const finding = {
  filePath: "src/app.ts",
  lineNumber: 12,
  code: "const x = y;",
  severity: "high",
  category: "bug",
  comment: "y is undefined here.",
};

describe("LLM review result parsing", () => {
  it("accepts a valid review result", () => {
    const result = parseReviewResult(JSON.stringify({ summary: "One issue.", reviews: [finding] }));
    assert.equal(result.reviews.length, 1);
    assert.equal(result.reviews[0]?.severity, "high");
  });

  it("rejects empty and non-JSON content", () => {
    assert.throws(() => parseReviewResult(""), /empty response/);
    assert.throws(() => parseReviewResult(undefined), /empty response/);
    assert.throws(() => parseReviewResult("Sure! Here is my review:"), /invalid JSON/);
  });

  it("rejects JSON that does not match the schema", () => {
    assert.throws(() => parseReviewResult(JSON.stringify({ summary: "x" })));
    assert.throws(() =>
      parseReviewResult(JSON.stringify({ summary: "x", reviews: [{ ...finding, severity: "urgent" }] })),
    );
    assert.throws(() =>
      parseReviewResult(JSON.stringify({ summary: "x", reviews: [{ ...finding, lineNumber: 1.5 }] })),
    );
  });
});
