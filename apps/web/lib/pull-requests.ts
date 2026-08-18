import { PRRow } from "@/components/PRTable";
import { ActivityItem } from "@/components/ActivityFeed";

export interface PullRequestRecord {
  id: number;
  repo: string;
  repoOwner: string;
  repoFullName: string;
  number: number;
  title: string | null;
  author: string | null;
  status: "pending" | "processing" | "completed" | "failed";
  action: string;
  createdAt: string;
  updatedAt: string;
  reviewJob: {
    id: number;
    status: "queued" | "running" | "completed" | "failed";
    commentsCount: number;
    createdAt: string;
    completedAt: string | null;
  } | null;
}

interface PullRequestsResponse {
  data: PullRequestRecord[];
  count: number;
}

export interface DashboardStats {
  totalComments: number;
  prsReviewed: number;
  avgReviewTime: string;
  issuesCaught: number;
  approvalRate: number | null;
  reposInstalled: number;
}

function timeAgo(date: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.round(milliseconds / 1_000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function toPRRows(pullRequests: PullRequestRecord[]): PRRow[] {
  return pullRequests.map((pullRequest) => ({
    id: pullRequest.id,
    repo: pullRequest.repo,
    title: pullRequest.title ?? `Pull request #${pullRequest.number}`,
    number: pullRequest.number,
    comments: pullRequest.reviewJob?.commentsCount ?? 0,
    status:
      pullRequest.status === "completed"
        ? "reviewed"
        : pullRequest.status === "failed"
          ? "failed"
          : "pending",
    author: pullRequest.author ?? pullRequest.repoOwner,
    reviewedAt: timeAgo(pullRequest.reviewJob?.completedAt ?? pullRequest.updatedAt),
    url: `https://github.com/${pullRequest.repoFullName}/pull/${pullRequest.number}`,
  }));
}

export function toDashboardStats(pullRequests: PullRequestRecord[]): DashboardStats {
  const completed = pullRequests.filter((pullRequest) => pullRequest.status === "completed");
  const comments = completed.reduce(
    (total, pullRequest) => total + (pullRequest.reviewJob?.commentsCount ?? 0),
    0,
  );
  const durations = completed
    .filter((pullRequest) => pullRequest.reviewJob?.completedAt)
    .map((pullRequest) => {
      const end = new Date(pullRequest.reviewJob!.completedAt!).getTime();
      return end - new Date(pullRequest.createdAt).getTime();
    });
  const noFindingReviews = completed.filter(
    (pullRequest) => (pullRequest.reviewJob?.commentsCount ?? 0) === 0,
  ).length;

  return {
    totalComments: comments,
    prsReviewed: completed.length,
    avgReviewTime:
      durations.length > 0
        ? formatDuration(durations.reduce((total, duration) => total + duration, 0) / durations.length)
        : "—",
    issuesCaught: comments,
    approvalRate: completed.length > 0 ? Math.round((noFindingReviews / completed.length) * 100) : null,
    reposInstalled: new Set(pullRequests.map((pullRequest) => pullRequest.repoFullName)).size,
  };
}

export function toActivityItems(pullRequests: PullRequestRecord[]): ActivityItem[] {
  return pullRequests.slice(0, 6).map((pullRequest) => {
    const completed = pullRequest.status === "completed";
    const failed = pullRequest.status === "failed";
    const findings = pullRequest.reviewJob?.commentsCount ?? 0;

    return {
      id: `pr-${pullRequest.id}-${pullRequest.updatedAt}`,
      type: failed ? "error" : completed ? "review" : "comment",
      message: failed
        ? `Review failed for PR #${pullRequest.number}`
        : completed
          ? `Reviewed PR #${pullRequest.number} — ${findings} finding${findings === 1 ? "" : "s"}`
          : `Review queued for PR #${pullRequest.number}`,
      repo: pullRequest.repoFullName,
      ts: timeAgo(pullRequest.reviewJob?.completedAt ?? pullRequest.updatedAt),
    };
  });
}

export async function fetchPullRequests(signal?: AbortSignal): Promise<PullRequestRecord[]> {
  const response = await fetch("/api/pulls", { signal, cache: "no-store" });
  const payload = (await response.json()) as PullRequestsResponse | { error?: string };

  if (!response.ok || !("data" in payload)) {
    throw new Error("error" in payload ? payload.error ?? "Failed to load pull requests" : "Failed to load pull requests");
  }

  return payload.data;
}
