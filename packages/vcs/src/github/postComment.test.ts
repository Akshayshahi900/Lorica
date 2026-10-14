import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Octokit } from "@octokit/rest";
import { findReviewComment, REVIEW_COMMENT_MARKER } from "./postComment";

type Comment = { id: number; body?: string; user: { type: string } | null };

function octokitWith(comments: Comment[]): Octokit {
  return {
    issues: { listComments: () => {} },
    paginate: async () => comments,
  } as unknown as Octokit;
}

const pr = { owner: "acme", repo: "widgets", prNumber: 3 };
const bot = { type: "Bot" };
const human = { type: "User" };

describe("finding the PR's Lorica review comment", () => {
  it("returns null when Lorica has not commented yet", async () => {
    const octokit = octokitWith([{ id: 1, body: "Nice work", user: human }]);
    assert.equal(await findReviewComment(octokit, pr), null);
  });

  it("returns the latest bot comment that starts with the review marker", async () => {
    const octokit = octokitWith([
      { id: 1, body: `${REVIEW_COMMENT_MARKER}\nold`, user: bot },
      { id: 2, body: "Nice work", user: human },
      { id: 3, body: `${REVIEW_COMMENT_MARKER}\nnew`, user: bot },
    ]);
    assert.deepEqual(await findReviewComment(octokit, pr), {
      id: 3,
      body: `${REVIEW_COMMENT_MARKER}\nnew`,
    });
  });

  it("ignores human comments and bot comments that only mention the marker", async () => {
    const octokit = octokitWith([
      { id: 1, body: `${REVIEW_COMMENT_MARKER}\nquoted review`, user: human },
      { id: 2, body: `see ${REVIEW_COMMENT_MARKER}`, user: bot },
      { id: 3, body: undefined, user: null },
    ]);
    assert.equal(await findReviewComment(octokit, pr), null);
  });
});
