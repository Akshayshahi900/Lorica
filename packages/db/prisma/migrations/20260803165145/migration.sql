/*
  Warnings:

  - You are about to drop the column `number` on the `PullRequest` table. All the data in the column will be lost.
  - Added the required column `prNumber` to the `PullRequest` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "PullRequest" DROP COLUMN "number",
ADD COLUMN     "prNumber" INTEGER NOT NULL;
