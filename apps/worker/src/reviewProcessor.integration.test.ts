import { after, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@lorica/db";
import { resetTestDatabase } from "@lorica/db/src/testing";
import { closeQueues } from "@lorica/queue";
import {
  createReviewProcessor,
  type ReviewDependencies,
} from "./reviewProcessor";
import { dispatchDueReviews } from "./dispatcher";
import { MAX_ATTEMPTS } from "./reviewJobs";
import { REVIEW_COMMENT_MARKER } from "@lorica/vcs";
import type { ReviewResult } from "@lorica/types";

const HEAD = "sha-head";

/**
 * In-memory GitHub/indexer/LLM; `head` is what GitHub reports as the PR head
 * and `comments` are the PR's comments.
 */
function fakeGitHub(overrides: Partial<ReviewDependencies> = {}) {
  const state = {
    head: HEAD,
    draft: false,
    comments: [] as { id: number; body: string }[],
    edits: 0,
    llmCalls: 0,
    prompts: [] as string[],
    ownerSettings: null as unknown,
    repoConfig: null as string | null,
    repoConfigRef: null as string | null,
    statuses: [] as { sha: string; state: string; description: string }[],
    /** What the model returns; null for one low-severity finding. */
    result: null as ReviewResult | null,
  };
  const deps: ReviewDependencies = {
    fetchFiles: async () => [
      { filePath: "src/a.ts", status: "modified", patch: "@@ -1 +1 @@\n-a\n+b" },
    ],
    fetchDetails: async () => ({
      title: "Change a",
      description: null,
      author: "dev",
      baseSha: "sha-base",
      headSha: state.head,
      baseRef: "main",
      draft: state.draft,
    }),
    indexCommit: async () => {},
    loadGraphContext: async () => ({ indexedCommit: state.head, traces: [] }),
    loadModelConfig: async () => null,
    loadOwnerSettings: async () => state.ownerSettings,
    fetchRepoConfig: async (_pr, ref) => {
      state.repoConfigRef = ref;
      return state.repoConfig === null
        ? null
        : { path: ".lorica.yaml", source: state.repoConfig };
    },
    review: async (_context, prompt) => {
      state.llmCalls++;
      state.prompts.push(prompt);
      if (state.result) return state.result;
      return {
        summary: "One issue.",
        reviews: [
          {
            filePath: "src/a.ts",
            lineNumber: 1,
            code: "b",
            severity: "low",
            category: "maintainability",
            comment: "Name this better.",
          },
        ],
      };
    },
    findComment: async () =>
      state.comments
        .filter((comment) => comment.body.startsWith(REVIEW_COMMENT_MARKER))
        .pop() ?? null,
    postComment: async (_pr, body) => {
      state.comments.push({ id: state.comments.length + 1, body });
    },
    updateComment: async (_pr, commentId, body) => {
      state.comments.find((comment) => comment.id === commentId)!.body = body;
      state.edits++;
    },
    setCommitStatus: async (_pr, sha, status, description) => {
      state.statuses.push({ sha, state: status, description });
    },
    ...overrides,
  };
  return { state, deps };
}

async function seedJob(headSha = HEAD) {
  const repository = await prisma.repository.create({
    data: { githubId: 1n, name: "widgets", fullName: "acme/widgets", owner: "acme" },
  });
  const pullRequest = await prisma.pullRequest.create({
    data: {
      githubPrId: 10n,
      prNumber: 3,
      repoName: "widgets",
      repoOwner: "acme",
      installationId: 77,
      headSha,
      status: "pending",
      action: "opened",
      repositoryId: repository.id,
    },
  });
  return prisma.reviewJob.create({
    data: { pullRequestId: pullRequest.id, headSha, status: "queued" },
  });
}

const job = (id: number) => prisma.reviewJob.findUniqueOrThrow({ where: { id } });
const pr = () => prisma.pullRequest.findFirstOrThrow();

beforeEach(resetTestDatabase);
after(async () => {
  await closeQueues();
  await prisma.$disconnect();
});

describe("review processing: success cases", () => {
  it("reviews the head commit and publishes exactly one marked comment", async () => {
    const { id } = await seedJob();
    const { state, deps } = fakeGitHub();

    assert.equal(await createReviewProcessor(deps)(id), "completed");

    assert.equal(state.comments.length, 1);
    assert.match(state.comments[0]!.body, new RegExp(`lorica-review-job:${id}`));
    const done = await job(id);
    assert.equal(done.status, "completed");
    assert.equal(done.commentsCount, 1);
    assert.equal(done.leaseToken, null);
    assert.ok(done.completedAt);
    assert.equal((await pr()).status, "completed");
  });

  it("runs a job only once when it is delivered twice at the same time", async () => {
    const { id } = await seedJob();
    const { state, deps } = fakeGitHub();
    const processReview = createReviewProcessor(deps);

    const outcomes = await Promise.all([processReview(id), processReview(id)]);

    assert.deepEqual(outcomes.sort(), ["completed", "skipped"]);
    assert.equal(state.comments.length, 1);
    assert.equal(state.llmCalls, 1);
  });

  it("does not post again when an earlier attempt already posted", async () => {
    const { id } = await seedJob();
    const { state, deps } = fakeGitHub();
    const earlier = `${REVIEW_COMMENT_MARKER}\nearlier review\n<!-- lorica-review-job:${id} -->`;
    state.comments.push({ id: 1, body: earlier });

    assert.equal(await createReviewProcessor(deps)(id), "completed");

    assert.equal(state.comments.length, 1);
    assert.equal(state.comments[0]!.body, earlier);
    assert.equal(state.edits, 0);
    assert.equal((await job(id)).status, "completed");
  });

  it("updates the PR's review comment for each new commit instead of posting another", async () => {
    const first = await seedJob();
    const { state, deps } = fakeGitHub();
    const processReview = createReviewProcessor(deps);
    state.comments.push({ id: 1, body: "LGTM, thanks!" });
    assert.equal(await processReview(first.id), "completed");

    const second = await pushCommit("sha-second");
    state.head = "sha-second";
    assert.equal(await processReview(second), "completed");
    const third = await pushCommit("sha-third");
    state.head = "sha-third";
    assert.equal(await processReview(third), "completed");

    // The human comment plus exactly one Lorica comment, showing the latest review.
    assert.equal(state.comments.length, 2);
    assert.equal(state.comments[0]!.body, "LGTM, thanks!");
    const review = state.comments[1]!.body;
    assert.ok(review.startsWith(REVIEW_COMMENT_MARKER));
    assert.match(review, new RegExp(`lorica-review-job:${third}\\b`));
    assert.doesNotMatch(review, new RegExp(`lorica-review-job:(${first.id}|${second})\\b`));
    assert.equal(state.edits, 2);
    assert.equal((await job(third)).status, "completed");
  });

  it("skips a job that is completed or still backing off", async () => {
    const { id } = await seedJob();
    const { state, deps } = fakeGitHub();
    await prisma.reviewJob.update({
      where: { id },
      data: { nextRunAt: new Date(Date.now() + 60_000) },
    });

    assert.equal(await createReviewProcessor(deps)(id), "skipped");
    assert.equal(state.llmCalls, 0);
  });
});

describe("review processing: review settings", () => {
  it("completes without reviewing when the workflow rules the PR out", async () => {
    const { id } = await seedJob();
    const { state, deps } = fakeGitHub();
    state.draft = true;
    state.ownerSettings = { workflow: { reviewDrafts: false } };

    assert.equal(await createReviewProcessor(deps)(id), "not_reviewed");

    assert.equal(state.llmCalls, 0);
    assert.equal(state.comments.length, 0);
    const done = await job(id);
    assert.equal(done.status, "completed");
    assert.equal(done.skipReason, "draft pull requests are not reviewed");
    assert.equal((await pr()).status, "completed");
  });

  it("layers the repository config from the base commit over the owner's settings", async () => {
    const { id } = await seedJob();
    const { state, deps } = fakeGitHub();
    state.ownerSettings = { profile: "assertive", guidelines: "Org: use the shared logger." };
    state.repoConfig = "profile: quiet\nguidelines: 'Repo: no default exports.'\nstyle:\n  fixPrompt: false\n";

    assert.equal(await createReviewProcessor(deps)(id), "completed");

    assert.equal(state.repoConfigRef, "sha-base");
    assert.match(state.prompts[0]!, /QUIET\./);
    assert.match(state.prompts[0]!, /Org: use the shared logger\.\n\nRepo: no default exports\./);
    // Quiet drops the fake model's low-severity finding and the fix prompt.
    const body = state.comments[0]!.body;
    assert.match(body, /No actionable issues found/);
    assert.match(body, /1 lower-severity finding was hidden by the Quiet review settings/);
    assert.match(body, /Quiet profile/);
    assert.equal((await job(id)).commentsCount, 0);
  });

  it("reviews with the owner's settings and says so when the repository config is broken", async () => {
    const { id } = await seedJob();
    const { state, deps } = fakeGitHub();
    state.repoConfig = "profil: quiet\n";

    assert.equal(await createReviewProcessor(deps)(id), "completed");

    const body = state.comments[0]!.body;
    assert.match(body, /`\.lorica\.yaml` was ignored: .*profil/);
    assert.match(body, /1 issue found/);
    assert.match(body, /Chill profile/);
  });
});

describe("review processing: merge gate", () => {
  const blocking: ReviewResult = {
    summary: "Two issues.",
    reviews: [
      {
        filePath: "src/a.ts",
        lineNumber: 1,
        code: "b",
        severity: "high" as const,
        category: "security" as const,
        comment: "Leaks a token.",
      },
      {
        filePath: "src/a.ts",
        lineNumber: 1,
        code: "b",
        severity: "low" as const,
        category: "standards" as const,
        comment: "Guideline: use the shared logger.",
      },
    ],
    postMergeActions: [
      { category: "configuration" as const, action: "Set `TOKEN_TTL` in production.", reason: "Read by src/a.ts." },
    ],
  };

  it("marks the head commit pending, then passes a review without blocking findings", async () => {
    const { id } = await seedJob();
    const { state, deps } = fakeGitHub();

    assert.equal(await createReviewProcessor(deps)(id), "completed");

    assert.deepEqual(
      state.statuses.map(({ sha, state }) => `${sha}:${state}`),
      [`${HEAD}:pending`, `${HEAD}:success`],
    );
    assert.match(state.comments[0]!.body, /✅ Ready to merge/);
  });

  it("blocks the merge on severe findings and guideline violations, and lists post-merge actions", async () => {
    const { id } = await seedJob();
    const { state, deps } = fakeGitHub();
    state.result = blocking;
    state.ownerSettings = { profile: "quiet", guidelines: "Use the shared logger." };

    assert.equal(await createReviewProcessor(deps)(id), "completed");

    assert.match(state.prompts[0]!, /enforced before merging/);
    assert.match(state.prompts[0]!, /POST-MERGE ACTIONS/);
    assert.deepEqual(state.statuses.at(-1), {
      sha: HEAD,
      state: "failure",
      description: "Merge blocked: 1 finding of high severity or worse, 1 coding-guideline violation",
    });
    const body = state.comments[0]!.body;
    // Quiet hides low findings, but not a guideline violation the gate enforces.
    assert.match(body, /2 issues found/);
    assert.match(body, /⛔ Merge blocked/);
    assert.match(body, /After merging[\s\S]*Set `TOKEN_TTL` in production\./);
  });

  it("follows the repository's gate settings and can be turned off", async () => {
    const { id } = await seedJob();
    const { state, deps } = fakeGitHub();
    state.result = blocking;
    state.repoConfig = "mergeGate:\n  enabled: false\nstyle:\n  postMergeActions: false\n";

    assert.equal(await createReviewProcessor(deps)(id), "completed");

    assert.deepEqual(state.statuses, []);
    assert.doesNotMatch(state.prompts[0]!, /POST-MERGE ACTIONS/);
    assert.doesNotMatch(state.comments[0]!.body, /Merge blocked|Ready to merge|After merging/);
  });

  it("passes a pull request the workflow rules out, so a required status never hangs", async () => {
    const { id } = await seedJob();
    const { state, deps } = fakeGitHub();
    state.ownerSettings = { workflow: { autoReview: false } };

    assert.equal(await createReviewProcessor(deps)(id), "not_reviewed");

    assert.deepEqual(state.statuses, [
      { sha: HEAD, state: "success", description: "Not reviewed: automatic reviews are turned off" },
    ]);
  });

  it("reviews anyway and says so when GitHub denies setting the status", async () => {
    const { id } = await seedJob();
    let calls = 0;
    const { state, deps } = fakeGitHub({
      setCommitStatus: async () => {
        calls++;
        throw Object.assign(new Error("Resource not accessible"), { status: 403 });
      },
    });

    assert.equal(await createReviewProcessor(deps)(id), "completed");

    assert.equal(calls, 1);
    assert.match(state.comments[0]!.body, /could not set its merge-gate commit status/);
  });

  it("reports an error instead of leaving the status pending when the review fails for good", async () => {
    const { id } = await seedJob();
    await prisma.reviewJob.update({ where: { id }, data: { attempts: MAX_ATTEMPTS - 1 } });
    const { state, deps } = fakeGitHub({
      review: async () => {
        throw new Error("still down");
      },
    });

    assert.equal(await createReviewProcessor(deps)(id), "failed");

    assert.deepEqual(state.statuses.map((status) => status.state), ["pending", "error"]);
  });
});

describe("review processing: review settings failures", () => {
  it("reviews with the defaults when GitHub denies reading the config file", async () => {
    const { id } = await seedJob();
    const { state, deps } = fakeGitHub({
      fetchRepoConfig: async () => {
        throw Object.assign(new Error("Resource not accessible"), { status: 403 });
      },
    });

    assert.equal(await createReviewProcessor(deps)(id), "completed");

    assert.match(state.comments[0]!.body, /could not read the repository's `\.lorica\.yaml`/);
    assert.match(state.comments[0]!.body, /Chill profile/);
  });

  it("retries rather than guessing when the config file cannot be fetched", async () => {
    const { id } = await seedJob();
    const { state, deps } = fakeGitHub({
      fetchRepoConfig: async () => {
        throw Object.assign(new Error("Server Error"), { status: 502 });
      },
    });

    assert.equal(await createReviewProcessor(deps)(id), "retry");

    assert.equal(state.llmCalls, 0);
    assert.equal(state.comments.length, 0);
    assert.equal((await job(id)).status, "queued");
  });

  it("ignores dashboard settings saved under an incompatible schema", async () => {
    const { id } = await seedJob();
    const { state, deps } = fakeGitHub();
    state.ownerSettings = { profile: "loud" };

    assert.equal(await createReviewProcessor(deps)(id), "completed");

    assert.match(state.comments[0]!.body, /dashboard could not be read and were ignored/);
  });
});

describe("review processing: only the current head publishes", () => {
  it("supersedes a job whose commit is no longer the head before reviewing", async () => {
    const { id } = await seedJob("sha-old");
    const { state, deps } = fakeGitHub();
    state.head = "sha-new";

    assert.equal(await createReviewProcessor(deps)(id), "superseded");

    assert.equal(state.llmCalls, 0);
    assert.equal(state.comments.length, 0);
    assert.equal((await job(id)).status, "superseded");
    // The real head gets a review even if its webhook never arrived.
    const replacement = await prisma.reviewJob.findFirstOrThrow({
      where: { headSha: "sha-new" },
    });
    assert.equal(replacement.status, "queued");
    assert.equal((await pr()).headSha, "sha-new");
  });

  it("does not publish when the head moves while the review runs", async () => {
    const { id } = await seedJob();
    const { state, deps } = fakeGitHub();
    const review = deps.review;
    deps.review = async (...args) => {
      const result = await review(...args);
      state.head = "sha-pushed-during-review";
      return result;
    };

    assert.equal(await createReviewProcessor(deps)(id), "superseded");

    assert.equal(state.comments.length, 0);
    assert.equal((await job(id)).status, "superseded");
    assert.equal(
      (await prisma.reviewJob.findFirstOrThrow({
        where: { headSha: "sha-pushed-during-review" },
      })).status,
      "queued",
    );
  });

  it("does not publish when a webhook supersedes the job mid-review", async () => {
    const { id } = await seedJob();
    const { state, deps } = fakeGitHub({
      review: async () => {
        // What the webhook intake does when a newer commit arrives.
        await prisma.reviewJob.update({
          where: { id },
          data: { status: "superseded" },
        });
        return { summary: "late", reviews: [] };
      },
    });

    assert.equal(await createReviewProcessor(deps)(id), "lost");

    assert.equal(state.comments.length, 0);
    assert.equal((await job(id)).status, "superseded");
  });

  it("does not publish or record results after losing the lease", async () => {
    const { id } = await seedJob();
    const { state, deps } = fakeGitHub({
      review: async () => {
        // This attempt stalled; its lease lapsed and another attempt claimed it.
        await prisma.reviewJob.update({
          where: { id },
          data: { leaseToken: "another-attempt" },
        });
        return { summary: "slow", reviews: [] };
      },
    });

    assert.equal(await createReviewProcessor(deps)(id), "lost");

    assert.equal(state.comments.length, 0);
    const current = await job(id);
    assert.equal(current.status, "running");
    assert.equal(current.leaseToken, "another-attempt");
  });

  it("records nothing when a failure comes after losing the lease", async () => {
    const { id } = await seedJob();
    const { deps } = fakeGitHub({
      review: async () => {
        await prisma.reviewJob.update({
          where: { id },
          data: { leaseToken: "another-attempt" },
        });
        throw new Error("LLM timeout");
      },
    });

    assert.equal(await createReviewProcessor(deps)(id), "lost");
    const current = await job(id);
    assert.equal(current.status, "running");
    assert.equal(current.lastError, null);
  });
});

describe("review processing: failure cases", () => {
  it("schedules a retry with backoff after a transient failure", async () => {
    const { id } = await seedJob();
    const { state, deps } = fakeGitHub({
      review: async () => {
        throw new Error("LLM 503");
      },
    });

    assert.equal(await createReviewProcessor(deps)(id), "retry");

    const retried = await job(id);
    assert.equal(retried.status, "queued");
    assert.equal(retried.attempts, 1);
    assert.equal(retried.leaseToken, null);
    assert.match(retried.lastError!, /LLM 503/);
    assert.ok(retried.nextRunAt.getTime() > Date.now() + 50_000);
    assert.equal(state.comments.length, 0);
    assert.equal((await pr()).status, "pending");
  });

  it("fails at once when GitHub says the PR is gone", async () => {
    const { id } = await seedJob();
    const { deps } = fakeGitHub({
      fetchDetails: async () => {
        throw Object.assign(new Error("Not Found"), { status: 404 });
      },
    });

    assert.equal(await createReviewProcessor(deps)(id), "failed");
    assert.equal((await job(id)).status, "failed");
    assert.equal((await pr()).status, "failed");
  });

  it("fails after the last attempt", async () => {
    const { id } = await seedJob();
    await prisma.reviewJob.update({
      where: { id },
      data: { attempts: MAX_ATTEMPTS - 1 },
    });
    const { deps } = fakeGitHub({
      review: async () => {
        throw new Error("still down");
      },
    });

    assert.equal(await createReviewProcessor(deps)(id), "failed");
    assert.equal((await job(id)).attempts, MAX_ATTEMPTS);
  });

  it("reclaims a job whose worker died, and retires it once attempts run out", async () => {
    const { id } = await seedJob();
    const { state, deps } = fakeGitHub();
    const expired = { status: "running" as const, leaseToken: "dead-worker", leaseUntil: new Date(Date.now() - 1_000) };

    await prisma.reviewJob.update({ where: { id }, data: { ...expired, attempts: 1 } });
    assert.equal(await createReviewProcessor(deps)(id), "completed");
    assert.equal(state.comments.length, 1);

    const second = await seedJob2();
    await prisma.reviewJob.update({
      where: { id: second },
      data: { ...expired, attempts: MAX_ATTEMPTS },
    });
    assert.equal(await createReviewProcessor(deps)(second), "skipped");
    assert.equal((await job(second)).status, "failed");
    assert.equal(state.comments.length, 1);
  });

  it("runs due jobs in-process when Redis is unavailable", async () => {
    const { id } = await seedJob();
    const ran: number[] = [];

    await dispatchDueReviews({
      enqueue: async () => {
        throw new Error("Timed out enqueueing review job");
      },
      runInline: async (reviewJobId) => {
        ran.push(reviewJobId);
      },
    });

    assert.deepEqual(ran, [id]);
  });
});

async function seedJob2() {
  const pullRequest = await pr();
  const created = await prisma.reviewJob.create({
    data: { pullRequestId: pullRequest.id, headSha: "sha-other", status: "queued" },
  });
  return created.id;
}

/** What the webhook intake records when a new commit is pushed to the PR. */
async function pushCommit(headSha: string) {
  const pullRequest = await prisma.pullRequest.update({
    where: { id: (await pr()).id },
    data: { headSha, action: "synchronize", status: "pending" },
  });
  const created = await prisma.reviewJob.create({
    data: { pullRequestId: pullRequest.id, headSha, status: "queued" },
  });
  return created.id;
}
