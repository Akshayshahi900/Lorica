-- Per-user review model. Absent rows keep the deployment's default model.
CREATE TABLE "ModelSettings" (
    "id" SERIAL NOT NULL,
    "owner" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "baseUrl" TEXT,
    "apiKeyCiphertext" TEXT,
    "contextWindow" INTEGER,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ModelSettings_owner_key" ON "ModelSettings"("owner");
