/*
  Warnings:

  - You are about to drop the column `title` on the `PullRequest` table. All the data in the column will be lost.
  - Added the required column `installationId` to the `PullRequest` table without a default value. This is not possible if the table is not empty.
  - Added the required column `repoName` to the `PullRequest` table without a default value. This is not possible if the table is not empty.
  - Added the required column `repoOwner` to the `PullRequest` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "PullRequest" DROP COLUMN "title",
ADD COLUMN     "installationId" INTEGER NOT NULL,
ADD COLUMN     "repoName" TEXT NOT NULL,
ADD COLUMN     "repoOwner" TEXT NOT NULL;
