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

const HEAD = "sha-head";

/** In-memory GitHub/indexer/LLM; `head` is what GitHub reports as the PR head. */
function fakeGitHub(overrides: Partial<ReviewDependencies> = {}) {
  const state = {
    head: HEAD,
    posted: [] as string[],
    llmCalls: 0,
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
    }),
    indexCommit: async () => {},
    loadGraphContext: async () => ({ indexedCommit: state.head, traces: [] }),
    review: async () => {
      state.llmCalls++;
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
    hasComment: async (_pr, marker) =>
      state.posted.some((body) => body.includes(marker)),
    postComment: async (_pr, body) => {
      state.posted.push(body);
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

    assert.equal(state.posted.length, 1);
    assert.match(state.posted[0]!, new RegExp(`lorica-review-job:${id}`));
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
    assert.equal(state.posted.length, 1);
    assert.equal(state.llmCalls, 1);
  });

  it("does not post again when an earlier attempt already posted", async () => {
    const { id } = await seedJob();
    const { state, deps } = fakeGitHub();
    state.posted.push(`earlier review\n<!-- lorica-review-job:${id} -->`);

    assert.equal(await createReviewProcessor(deps)(id), "completed");

    assert.equal(state.posted.length, 1);
    assert.equal((await job(id)).status, "completed");
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

describe("review processing: only the current head publishes", () => {
  it("supersedes a job whose commit is no longer the head before reviewing", async () => {
    const { id } = await seedJob("sha-old");
    const { state, deps } = fakeGitHub();
    state.head = "sha-new";

    assert.equal(await createReviewProcessor(deps)(id), "superseded");

    assert.equal(state.llmCalls, 0);
    assert.equal(state.posted.length, 0);
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

    assert.equal(state.posted.length, 0);
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

    assert.equal(state.posted.length, 0);
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

    assert.equal(state.posted.length, 0);
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
    assert.equal(state.posted.length, 0);
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
    assert.equal(state.posted.length, 1);

    const second = await seedJob2();
    await prisma.reviewJob.update({
      where: { id: second },
      data: { ...expired, attempts: MAX_ATTEMPTS },
    });
    assert.equal(await createReviewProcessor(deps)(second), "skipped");
    assert.equal((await job(second)).status, "failed");
    assert.equal(state.posted.length, 1);
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
