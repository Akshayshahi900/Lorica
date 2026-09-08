/*
  Warnings:

  - The primary key for the `PullRequest` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `id` column on the `PullRequest` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `Repository` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `createdAt` on the `Repository` table. All the data in the column will be lost.
  - You are about to drop the column `githubRepoId` on the `Repository` table. All the data in the column will be lost.
  - You are about to drop the column `installationId` on the `Repository` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `Repository` table. All the data in the column will be lost.
  - The `id` column on the `Repository` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `ReviewJob` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `updatedAt` on the `ReviewJob` table. All the data in the column will be lost.
  - The `id` column on the `ReviewJob` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the `ReviewComment` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[githubPrId]` on the table `PullRequest` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[githubId]` on the table `Repository` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[fullName]` on the table `Repository` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `action` to the `PullRequest` table without a default value. This is not possible if the table is not empty.
  - Added the required column `githubPrId` to the `PullRequest` table without a default value. This is not possible if the table is not empty.
  - Added the required column `title` to the `PullRequest` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `repositoryId` on the `PullRequest` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `status` on the `PullRequest` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Added the required column `fullName` to the `Repository` table without a default value. This is not possible if the table is not empty.
  - Added the required column `githubId` to the `Repository` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `pullRequestId` on the `ReviewJob` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `status` on the `ReviewJob` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "PullRequestStatus" AS ENUM ('pending', 'processing', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "ReviewJobStatus" AS ENUM ('queued', 'running', 'completed', 'failed');

-- DropForeignKey
ALTER TABLE "PullRequest" DROP CONSTRAINT "PullRequest_repositoryId_fkey";

-- DropForeignKey
ALTER TABLE "ReviewComment" DROP CONSTRAINT "ReviewComment_reviewJobId_fkey";

-- DropForeignKey
ALTER TABLE "ReviewJob" DROP CONSTRAINT "ReviewJob_pullRequestId_fkey";

-- DropIndex
DROP INDEX "PullRequest_repositoryId_number_key";

-- DropIndex
DROP INDEX "Repository_githubRepoId_key";

-- AlterTable
ALTER TABLE "PullRequest" DROP CONSTRAINT "PullRequest_pkey",
ADD COLUMN     "action" TEXT NOT NULL,
ADD COLUMN     "githubPrId" BIGINT NOT NULL,
ADD COLUMN     "title" TEXT NOT NULL,
DROP COLUMN "id",
ADD COLUMN     "id" SERIAL NOT NULL,
DROP COLUMN "repositoryId",
ADD COLUMN     "repositoryId" INTEGER NOT NULL,
DROP COLUMN "status",
ADD COLUMN     "status" "PullRequestStatus" NOT NULL,
ADD CONSTRAINT "PullRequest_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "Repository" DROP CONSTRAINT "Repository_pkey",
DROP COLUMN "createdAt",
DROP COLUMN "githubRepoId",
DROP COLUMN "installationId",
DROP COLUMN "updatedAt",
ADD COLUMN     "fullName" TEXT NOT NULL,
ADD COLUMN     "githubId" BIGINT NOT NULL,
DROP COLUMN "id",
ADD COLUMN     "id" SERIAL NOT NULL,
ADD CONSTRAINT "Repository_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "ReviewJob" DROP CONSTRAINT "ReviewJob_pkey",
DROP COLUMN "updatedAt",
DROP COLUMN "id",
ADD COLUMN     "id" SERIAL NOT NULL,
DROP COLUMN "pullRequestId",
ADD COLUMN     "pullRequestId" INTEGER NOT NULL,
DROP COLUMN "status",
ADD COLUMN     "status" "ReviewJobStatus" NOT NULL,
ADD CONSTRAINT "ReviewJob_pkey" PRIMARY KEY ("id");

-- DropTable
DROP TABLE "ReviewComment";

-- DropEnum
DROP TYPE "ReviewStatus";

-- CreateIndex
CREATE UNIQUE INDEX "PullRequest_githubPrId_key" ON "PullRequest"("githubPrId");

-- CreateIndex
CREATE UNIQUE INDEX "Repository_githubId_key" ON "Repository"("githubId");

-- CreateIndex
CREATE UNIQUE INDEX "Repository_fullName_key" ON "Repository"("fullName");

-- AddForeignKey
ALTER TABLE "PullRequest" ADD CONSTRAINT "PullRequest_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewJob" ADD CONSTRAINT "ReviewJob_pullRequestId_fkey" FOREIGN KEY ("pullRequestId") REFERENCES "PullRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
