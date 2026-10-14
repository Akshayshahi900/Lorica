-- Deduplicate webhook deliveries, order head updates, and fence publishing
-- to the attempt that holds a review job's lease.
ALTER TABLE "PullRequest" ADD COLUMN "headUpdatedAt" TIMESTAMP(3);
ALTER TABLE "ReviewJob" ADD COLUMN "leaseToken" TEXT;

CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "action" TEXT,
    "reviewJobId" INTEGER,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);
