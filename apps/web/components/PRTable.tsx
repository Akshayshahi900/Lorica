"use client";
import { GitPullRequest, ExternalLink } from "lucide-react";
import clsx from "clsx";

export interface PRRow {
  id: number;
  repo: string;
  title: string;
  number: number;
  comments: number;
  status: "reviewed" | "pending" | "failed";
  author: string;
  reviewedAt: string;
  url: string;
}

const STATUS_STYLES: Record<PRRow["status"], string> = {
  reviewed: "text-status-green bg-status-green/10 border-status-green/20",
  pending: "text-status-yellow bg-status-yellow/10 border-status-yellow/20",
  failed: "text-status-red bg-status-red/10 border-status-red/20",
};

export function PRTable({ rows }: { rows: PRRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="text-center py-16 text-text-muted font-mono text-sm">
        <GitPullRequest size={24} className="mx-auto mb-3 opacity-30" />
        No PRs reviewed yet. Install the bot to get started.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px] text-sm">
        <thead>
          <tr className="border-b border-bg-border">
            {["Repository", "Pull Request", "Comments", "Status", "Reviewed", ""].map(
              (h) => (
                <th
                  key={h}
                  className="text-left text-xs font-mono text-text-muted uppercase tracking-wider py-2.5 px-3 first:pl-0"
                >
                  {h}
                </th>
              )
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-bg-border">
          {rows.map((row) => (
            <tr key={row.id} className="group hover:bg-bg-hover/60 transition-colors">
              <td className="py-3 px-3 pl-0">
                <span className="font-mono text-xs text-accent-violet bg-accent-violet-glow px-2 py-0.5 rounded border border-accent-violet/20">
                  {row.repo}
                </span>
              </td>
              <td className="py-3 px-3 max-w-xs">
                <p className="text-text-primary text-xs font-medium truncate group-hover:text-accent-violet transition-colors">
                  {row.title}
                </p>
                <p className="text-text-muted font-mono text-xs">
                  #{row.number} · @{row.author}
                </p>
              </td>
              <td className="py-3 px-3">
                <span className="font-mono text-text-primary font-semibold text-sm">
                  {row.comments}
                </span>
              </td>
              <td className="py-3 px-3">
                <span
                  className={clsx(
                    "inline-flex items-center px-2 py-0.5 rounded border text-xs font-mono",
                    STATUS_STYLES[row.status]
                  )}
                >
                  {row.status}
                </span>
              </td>
              <td className="py-3 px-3 font-mono text-xs text-text-muted">
                {row.reviewedAt}
              </td>
              <td className="py-3 px-3">
                <a
                  href={row.url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open pull request #${row.number} on GitHub`}
                  className="text-text-muted hover:text-accent-violet transition-colors lg:opacity-0 lg:group-hover:opacity-100"
                >
                  <ExternalLink size={12} />
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
