import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveReviewSettings, type ReviewSettings } from "../../types/src/reviewSettings";
import {
  excludeConfiguredPaths,
  pathInstructionsFor,
  reviewLimits,
  reviewSkipReason,
  type PullRequestFacts,
} from "./reviewSettings";

const pr: PullRequestFacts = {
  title: "Add billing export",
  author: "octocat",
  draft: false,
  baseRef: "main",
  action: "opened",
};

function skip(settings: ReviewSettings, overrides: Partial<PullRequestFacts> = {}) {
  return reviewSkipReason(resolveReviewSettings([settings]), { ...pr, ...overrides });
}

describe("deciding whether to review", () => {
  it("reviews everything by default", () => {
    assert.equal(skip({}), null);
    assert.equal(skip({}, { draft: true, action: "synchronize", baseRef: "dev" }), null);
  });

  it("follows the workflow switches", () => {
    assert.match(skip({ workflow: { autoReview: false } })!, /turned off/);
    assert.match(skip({ workflow: { reviewDrafts: false } }, { draft: true })!, /draft/);
    assert.equal(skip({ workflow: { reviewDrafts: false } }), null);
    assert.match(skip({ workflow: { reviewOnPush: false } }, { action: "synchronize" })!, /new commits/);
    assert.equal(skip({ workflow: { reviewOnPush: false } }, { action: "ready_for_review" }), null);
  });

  it("matches base branches as globs", () => {
    const settings = { workflow: { baseBranches: ["main", "release/*"] } };
    assert.equal(skip(settings), null);
    assert.equal(skip(settings, { baseRef: "release/2.0" }), null);
    assert.match(skip(settings, { baseRef: "feature/x" })!, /feature\/x is not configured/);
  });

  it("skips ignored title keywords and authors, ignoring case", () => {
    assert.match(skip({ workflow: { ignoreTitleKeywords: ["wip"] } }, { title: "WIP: billing" })!, /"wip"/);
    assert.match(
      skip({ workflow: { ignoreAuthors: ["Dependabot[bot]"] } }, { author: "dependabot[bot]" })!,
      /dependabot\[bot\]/,
    );
  });
});

describe("path rules", () => {
  it("excludes configured globs, matching bare patterns against file names", () => {
    const files = ["src/a.ts", "src/a.test.ts", "migrations/001.sql", "web/.storybook/x.ts"].map(
      (filePath) => ({ filePath }),
    );
    const { kept, excluded } = excludeConfiguredPaths(files, ["*.test.ts", "migrations/**", "**/.storybook/**"]);
    assert.deepEqual(kept.map((f) => f.filePath), ["src/a.ts"]);
    assert.deepEqual(excluded.map((f) => f.reason), ["configured", "configured", "configured"]);
  });

  it("keeps everything when nothing is excluded", () => {
    assert.equal(excludeConfiguredPaths([{ filePath: "a.ts" }], []).kept.length, 1);
  });

  it("selects only the path instructions that apply to the files in view", () => {
    const instructions = [
      { path: "src/api/**", instructions: "Validate input." },
      { path: "*.sql", instructions: "Check for locks." },
    ];
    assert.deepEqual(
      pathInstructionsFor(instructions, ["src/api/users.ts"]).map((i) => i.path),
      ["src/api/**"],
    );
    assert.deepEqual(pathInstructionsFor(instructions, ["web/page.tsx"]), []);
  });
});

describe("review limits", () => {
  it("come from the profile unless set explicitly", () => {
    assert.deepEqual(reviewLimits(resolveReviewSettings([{ profile: "quiet" }])), {
      minSeverity: "high",
      maxFindings: 5,
      label: "Quiet",
    });
    assert.deepEqual(
      reviewLimits(resolveReviewSettings([{ profile: "quiet", style: { minSeverity: "medium" } }])),
      { minSeverity: "medium", maxFindings: 5, label: "Quiet" },
    );
  });
});
