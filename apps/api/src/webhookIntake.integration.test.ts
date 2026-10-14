import { createHmac, randomUUID } from "node:crypto";
import { after, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@lorica/db";
import { resetTestDatabase } from "@lorica/db/src/testing";
import { closeQueues } from "@lorica/queue";
import { handleWebhook } from "./controllers/github.controller";

const SECRET = "integration-webhook-secret";
process.env.WEBHOOK_SECRET = SECRET;
delete process.env.LORICA_WORKER_URL;

const PR_ID = 5001;

function pullRequestEvent(
  sha: string,
  {
    action = "synchronize",
    updatedAt = "2026-10-15T10:00:00Z",
  }: { action?: string; updatedAt?: string } = {},
) {
  return {
    action,
    installation: { id: 77 },
    repository: {
      id: 9001,
      name: "widgets",
      full_name: "acme/widgets",
      owner: { login: "acme" },
    },
    pull_request: {
      id: PR_ID,
      number: 12,
      title: "Add widgets",
      user: { login: "dev" },
      updated_at: updatedAt,
      head: { sha },
    },
  };
}

async function deliver(
  body: unknown,
  {
    deliveryId = randomUUID(),
    event = "pull_request",
    secret = SECRET,
  }: { deliveryId?: string; event?: string; secret?: string } = {},
) {
  const raw = Buffer.from(JSON.stringify(body));
  const headers: Record<string, string> = {
    "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`,
    "x-github-event": event,
    "x-github-delivery": deliveryId,
  };
  let status = 0;
  const req = {
    body: raw,
    headers,
    header: (name: string) => headers[name.toLowerCase()],
  };
  const res = {
    status(code: number) {
      status = code;
      return res;
    },
    send() {
      return res;
    },
  };
  await handleWebhook(req as never, res as never);
  return status;
}

async function jobs() {
  return prisma.reviewJob.findMany({
    orderBy: { id: "asc" },
    select: { headSha: true, status: true, attempts: true },
  });
}

async function pullRequest() {
  return prisma.pullRequest.findUniqueOrThrow({
    where: { githubPrId: BigInt(PR_ID) },
  });
}

beforeEach(resetTestDatabase);
after(async () => {
  await closeQueues();
  await prisma.$disconnect();
});

describe("webhook intake: success cases", () => {
  it("records a new PR, its review job and the delivery", async () => {
    const deliveryId = randomUUID();
    assert.equal(
      await deliver(pullRequestEvent("sha-1", { action: "opened" }), { deliveryId }),
      200,
    );

    assert.deepEqual(await jobs(), [
      { headSha: "sha-1", status: "queued", attempts: 0 },
    ]);
    const pr = await pullRequest();
    assert.equal(pr.headSha, "sha-1");
    assert.equal(pr.status, "pending");
    const delivery = await prisma.webhookDelivery.findUniqueOrThrow({
      where: { id: deliveryId },
    });
    assert.equal(delivery.action, "opened");
    assert.ok(delivery.reviewJobId);
  });

  it("treats a redelivery of the same delivery id as a no-op", async () => {
    const deliveryId = randomUUID();
    await deliver(pullRequestEvent("sha-1"), { deliveryId });
    const job = await prisma.reviewJob.findFirstOrThrow();
    await prisma.reviewJob.update({
      where: { id: job.id },
      data: { status: "completed" },
    });
    await prisma.pullRequest.update({
      where: { githubPrId: BigInt(PR_ID) },
      data: { status: "completed" },
    });

    assert.equal(await deliver(pullRequestEvent("sha-1"), { deliveryId }), 200);

    assert.deepEqual(await jobs(), [
      { headSha: "sha-1", status: "completed", attempts: 0 },
    ]);
    assert.equal((await pullRequest()).status, "completed");
    assert.equal(await prisma.webhookDelivery.count(), 1);
  });

  it("re-queues a commit the review settings skipped once its PR leaves draft", async () => {
    await deliver(pullRequestEvent("sha-1", { action: "opened" }));
    const job = await prisma.reviewJob.findFirstOrThrow();
    await prisma.reviewJob.update({
      where: { id: job.id },
      data: { status: "completed", skipReason: "draft pull requests are not reviewed" },
    });

    // A push to a skipped draft is not a reason to look again.
    await deliver(pullRequestEvent("sha-1", { action: "synchronize", updatedAt: "2026-10-15T10:01:00Z" }));
    assert.equal((await prisma.reviewJob.findFirstOrThrow()).status, "completed");

    await deliver(pullRequestEvent("sha-1", { action: "ready_for_review", updatedAt: "2026-10-15T10:02:00Z" }));
    const requeued = await prisma.reviewJob.findFirstOrThrow();
    assert.equal(requeued.status, "queued");
    assert.equal(requeued.skipReason, null);
    assert.equal((await pullRequest()).status, "pending");
  });

  it("does not let a redelivery revive a review that gave up", async () => {
    // Only a new event (tested below) earns a failed review more attempts;
    // replaying the event that already produced it does not.
    const deliveryId = randomUUID();
    await deliver(pullRequestEvent("sha-1"), { deliveryId });
    await prisma.reviewJob.updateMany({ data: { status: "failed", attempts: 9 } });

    assert.equal(await deliver(pullRequestEvent("sha-1"), { deliveryId }), 200);

    assert.deepEqual(await jobs(), [
      { headSha: "sha-1", status: "failed", attempts: 9 },
    ]);
  });

  it("deduplicates concurrent copies of one delivery", async () => {
    const deliveryId = randomUUID();
    const statuses = await Promise.all(
      Array.from({ length: 5 }, () =>
        deliver(pullRequestEvent("sha-1"), { deliveryId }),
      ),
    );
    assert.deepEqual(statuses, [200, 200, 200, 200, 200]);
    assert.equal(await prisma.reviewJob.count(), 1);
    assert.equal(await prisma.webhookDelivery.count(), 1);
  });

  it("maps distinct deliveries for the same commit to one review job", async () => {
    const statuses = await Promise.all([
      deliver(pullRequestEvent("sha-1", { action: "opened" })),
      deliver(pullRequestEvent("sha-1", { action: "reopened" })),
      deliver(pullRequestEvent("sha-1")),
    ]);
    assert.deepEqual(statuses, [200, 200, 200]);
    assert.deepEqual(await jobs(), [
      { headSha: "sha-1", status: "queued", attempts: 0 },
    ]);
    assert.equal(await prisma.webhookDelivery.count(), 3);
  });

  it("supersedes queued and running reviews of older commits", async () => {
    await deliver(pullRequestEvent("sha-1", { updatedAt: "2026-10-15T10:00:00Z" }));
    await deliver(pullRequestEvent("sha-2", { updatedAt: "2026-10-15T10:01:00Z" }));
    // sha-2's review is in progress when sha-3 is pushed.
    await prisma.reviewJob.updateMany({
      where: { headSha: "sha-2" },
      data: { status: "running", leaseToken: "attempt-1" },
    });

    await deliver(pullRequestEvent("sha-3", { updatedAt: "2026-10-15T10:02:00Z" }));

    assert.deepEqual(await jobs(), [
      { headSha: "sha-1", status: "superseded", attempts: 0 },
      { headSha: "sha-2", status: "superseded", attempts: 0 },
      { headSha: "sha-3", status: "queued", attempts: 0 },
    ]);
    assert.equal((await pullRequest()).headSha, "sha-3");
  });

  it("ignores an out-of-order delivery for an older commit", async () => {
    await deliver(pullRequestEvent("sha-new", { updatedAt: "2026-10-15T10:05:00Z" }));
    assert.equal(
      await deliver(pullRequestEvent("sha-old", { updatedAt: "2026-10-15T10:00:00Z" })),
      200,
    );

    assert.deepEqual(await jobs(), [
      { headSha: "sha-new", status: "queued", attempts: 0 },
    ]);
    assert.equal((await pullRequest()).headSha, "sha-new");
  });

  it("gives a failed review a fresh set of attempts on a new event", async () => {
    await deliver(pullRequestEvent("sha-1"));
    await prisma.reviewJob.updateMany({
      data: { status: "failed", attempts: 9, lastError: "LLM down" },
    });

    await deliver(pullRequestEvent("sha-1", { action: "reopened" }));

    const [job] = await prisma.reviewJob.findMany();
    assert.equal(job!.status, "queued");
    assert.equal(job!.attempts, 0);
    assert.equal(job!.lastError, null);
    assert.equal((await pullRequest()).status, "pending");
  });

  it("acknowledges unsupported events and actions without recording them", async () => {
    assert.equal(await deliver({ zen: "hi" }, { event: "ping" }), 200);
    assert.equal(
      await deliver(pullRequestEvent("sha-1", { action: "closed" })),
      200,
    );
    assert.equal(await prisma.webhookDelivery.count(), 0);
    assert.equal(await prisma.reviewJob.count(), 0);
  });
});

describe("webhook intake: failure cases", () => {
  it("rejects a bad signature without recording anything", async () => {
    assert.equal(
      await deliver(pullRequestEvent("sha-1"), { secret: "wrong-secret" }),
      401,
    );
    assert.equal(await prisma.pullRequest.count(), 0);
    assert.equal(await prisma.webhookDelivery.count(), 0);
  });

  it("rolls back a failed delivery so its redelivery is processed", async () => {
    const deliveryId = randomUUID();
    const broken = pullRequestEvent("sha-1", { action: "opened" }) as any;
    delete broken.installation; // fails while creating the pull request

    assert.equal(await deliver(broken, { deliveryId }), 500);
    assert.equal(await prisma.webhookDelivery.count(), 0);
    assert.equal(await prisma.repository.count(), 0);

    // GitHub's redelivery reuses the delivery id.
    assert.equal(
      await deliver(pullRequestEvent("sha-1", { action: "opened" }), { deliveryId }),
      200,
    );
    assert.deepEqual(await jobs(), [
      { headSha: "sha-1", status: "queued", attempts: 0 },
    ]);
  });
});
