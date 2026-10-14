import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildReviewPrompt, REVIEW_PROMPT } from "./prompt";

const base = { profile: "chill" as const, guidelines: [], pathInstructions: [], tone: null };

describe("building the review prompt", () => {
  it("keeps the base prompt and its output contract for every profile", () => {
    for (const profile of ["quiet", "chill", "assertive"] as const) {
      const prompt = buildReviewPrompt({ ...base, profile });
      assert.ok(prompt.startsWith(REVIEW_PROMPT.trim()));
      assert.match(prompt, new RegExp(`REVIEW PROFILE[\\s\\S]*${profile.toUpperCase()}\\.`));
      assert.match(prompt, /return ONLY JSON in the structure defined under OUTPUT\.$/);
    }
  });

  it("adds only the sections that are configured", () => {
    const plain = buildReviewPrompt(base);
    assert.doesNotMatch(plain, /TEAM CODING GUIDELINES|PATH-SPECIFIC|TONE/);

    const prompt = buildReviewPrompt({
      ...base,
      guidelines: ["Use the shared logger.", "No default exports."],
      pathInstructions: [{ path: "src/api/**", instructions: "Validate input." }],
      tone: "Brief.",
    });
    assert.match(prompt, /<guidelines>\nUse the shared logger\.\n\nNo default exports\.\n<\/guidelines>/);
    assert.match(prompt, /<instructions path="src\/api\/\*\*">\nValidate input\.\n<\/instructions>/);
    assert.match(prompt, /TONE[\s\S]*Brief\./);
  });
});
