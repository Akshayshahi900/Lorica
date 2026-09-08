-- Keep the pull-request metadata needed by the dashboard and retain the
-- number of findings produced by each completed review.
ALTER TABLE "PullRequest"
  ADD COLUMN "title" TEXT,
  ADD COLUMN "author" TEXT;

ALTER TABLE "ReviewJob"
  ADD COLUMN "commentsCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "completedAt" TIMESTAMP(3);
