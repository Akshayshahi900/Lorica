import { Request, Response } from "express";
import { prisma } from "@lorica/db";
export const getPullRequests = async (req: Request, res: Response) => {
  try {
    const owner = req.query.owner;

    if (typeof owner !== "string" || !owner.trim()) {
      return res.status(400).json({ error: "A repository owner is required" });
    }

    const pullRequests = await prisma.pullRequest.findMany({
      where: {
        repoOwner: {
          equals: owner,
          mode: "insensitive",
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      include: {
        repository: true,
        reviewJobs: {
          orderBy: {
            createdAt: "desc",
          },
        },
      },
    });

    const data = pullRequests.map((pr) => {
      const latestReviewJob = pr.reviewJobs[0];

      return {
        id: pr.id,
        githubPrId: pr.githubPrId.toString(),

        repo: pr.repoName,
        repoOwner: pr.repoOwner,
        repoFullName: pr.repository.fullName,

        number: pr.prNumber,
        title: pr.title,
        author: pr.author,

        status: pr.status,
        action: pr.action,

        headSha: pr.headSha,

        reviewJob: latestReviewJob
          ? {
              id: latestReviewJob.id,
              status: latestReviewJob.status,
              commentsCount: latestReviewJob.commentsCount,
              createdAt: latestReviewJob.createdAt,
              completedAt: latestReviewJob.completedAt,
            }
          : null,

        createdAt: pr.createdAt,
        updatedAt: pr.updatedAt,
      };
    });

    return res.status(200).json({
      data,
      count: data.length,
    });
  } catch (error) {
    console.error("Failed to fetch pull requests:", error);

    return res.status(500).json({
      error: "Failed to fetch pull requests",
    });
  }
};
