-- Make the review job table the durable source of truth for review delivery.
ALTER TYPE "ReviewJobStatus" ADD VALUE 'superseded';

ALTER TABLE "ReviewJob"
  ADD COLUMN "headSha" TEXT,
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "leaseUntil" TIMESTAMP(3),
  ADD COLUMN "lastError" TEXT,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Older rows predate per-commit tracking. The newest job of each PR is taken
-- to be for the PR's recorded head; earlier ones get unique placeholders, and
-- any still unfinished are retired so the dispatcher does not replay them.
UPDATE "ReviewJob" AS job
SET "headSha" = pr."headSha"
FROM "PullRequest" AS pr
WHERE job."pullRequestId" = pr."id"
  AND job."id" = (
    SELECT MAX(latest."id") FROM "ReviewJob" AS latest
    WHERE latest."pullRequestId" = pr."id"
  );

UPDATE "ReviewJob"
SET "headSha" = 'legacy-' || "id",
    "status" = CASE WHEN "status" IN ('queued', 'running') THEN 'failed'::"ReviewJobStatus" ELSE "status" END
WHERE "headSha" IS NULL;
ALTER TABLE "ReviewJob" ALTER COLUMN "headSha" SET NOT NULL;

CREATE UNIQUE INDEX "ReviewJob_pullRequestId_headSha_key" ON "ReviewJob"("pullRequestId", "headSha");
CREATE INDEX "ReviewJob_status_nextRunAt_idx" ON "ReviewJob"("status", "nextRunAt");
