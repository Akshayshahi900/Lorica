-- Additive only: a new table and a nullable column, so code from before this
-- migration keeps working against the new schema (safe to roll the code back).
-- Every statement is idempotent: if a deploy is interrupted part-way, or the
-- schema was pushed by hand, re-running this migration finishes the job
-- instead of failing (resolve a failed run with
-- `prisma migrate resolve --rolled-back 20261017090000_review_settings`).

-- Per-owner review settings. Absent rows keep the default (Chill) behaviour.
CREATE TABLE IF NOT EXISTS "ReviewSettings" (
    "id" SERIAL NOT NULL,
    "owner" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ReviewSettings_owner_key" ON "ReviewSettings"("owner");

-- Why the review settings ruled a commit out of review, if they did. Nullable
-- with no default, so PostgreSQL adds it without rewriting the table.
ALTER TABLE "ReviewJob" ADD COLUMN IF NOT EXISTS "skipReason" TEXT;
