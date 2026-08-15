"use client";
import { useSession } from "next-auth/react";
import {
  MessageSquare,
  GitPullRequest,
  Clock,
  Cpu,
  TrendingUp,
  Zap,
} from "lucide-react";
import { StatCard } from "@/components/StatCard";
import { PRTable, PRRow } from "@/components/PRTable";
import { ActivityFeed, ActivityItem } from "@/components/ActivityFeed";
import { InstallBanner } from "@/components/InstallBanner";

// ─── Mock data — replace with real API calls in production ──────────────────

const MOCK_STATS = {
  totalComments: 847,
  prsReviewed: 134,
  avgReviewTime: "42s",
  issuesCaught: 61,
  approvalRate: 78,
  reposInstalled: 3,
};

const MOCK_PRS: PRRow[] = [
  {
    id: 1,
    repo: "chat-app",
    title: "feat: add WebSocket reconnection logic with exponential backoff",
    number: 83,
    comments: 7,
    status: "reviewed",
    author: "akshaySh",
    reviewedAt: "2 min ago",
    url: "#",
  },
  {
    id: 2,
    repo: "hy-proxy",
    title: "fix: race condition in epoll event handling under high concurrency",
    number: 29,
    comments: 4,
    status: "reviewed",
    author: "akshaySh",
    reviewedAt: "1h ago",
    url: "#",
  },
  {
    id: 3,
    repo: "Voidstore",
    title: "refactor: extract RESP parser into standalone module",
    number: 55,
    comments: 3,
    status: "reviewed",
    author: "akshaySh",
    reviewedAt: "3h ago",
    url: "#",
  },
  {
    id: 4,
    repo: "Outmoni",
    title: "chore: upgrade Prisma to v5 and migrate schema",
    number: 101,
    comments: 0,
    status: "skipped",
    author: "akshaySh",
    reviewedAt: "5h ago",
    url: "#",
  },
  {
    id: 5,
    repo: "SaffronAI",
    title: "feat: stream LLM responses over SSE for lower perceived latency",
    number: 17,
    comments: 9,
    status: "reviewed",
    author: "akshaySh",
    reviewedAt: "Yesterday",
    url: "#",
  },
];

const MOCK_ACTIVITY: ActivityItem[] = [
  {
    id: "a1",
    type: "review",
    message: "Reviewed PR #83 — 7 comments added",
    repo: "chat-app",
    ts: "2m",
  },
  {
    id: "a2",
    type: "comment",
    message: "Flagged potential null-deref in reconnect handler",
    repo: "chat-app · PR #83",
    ts: "2m",
  },
  {
    id: "a3",
    type: "review",
    message: "Reviewed PR #29 — race condition identified",
    repo: "hy-proxy",
    ts: "1h",
  },
  {
    id: "a4",
    type: "install",
    message: "Bot installed on repository",
    repo: "Voidstore",
    ts: "3h",
  },
  {
    id: "a5",
    type: "review",
    message: "Reviewed PR #55 — 3 style issues",
    repo: "Voidstore",
    ts: "3h",
  },
  {
    id: "a6",
    type: "comment",
    message: "Suggested extracting constants into config file",
    repo: "Voidstore · PR #55",
    ts: "3h",
  },
  {
    id: "a7",
    type: "review",
    message: "Skipped PR #101 — chore only, no logic changes",
    repo: "Outmoni",
    ts: "5h",
  },
];

// ────────────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { data: session } = useSession();
  const stats = MOCK_STATS;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Overview</h1>
          <p className="text-xs text-text-muted font-mono mt-0.5">
            {new Date().toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}
            &nbsp;· all repos
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs font-mono text-status-green bg-status-green/10 border border-status-green/20 px-3 py-1.5 rounded-lg">
          <span className="w-1.5 h-1.5 rounded-full bg-status-green animate-pulse_slow" />
           is active
        </div>
      </div>

      {/* Install banner — only shown if no repos installed */}
      <InstallBanner installedCount={stats.reposInstalled} />

      {/* KPI cards */}
      <section>
        <p className="text-xs font-mono text-text-muted uppercase tracking-wider mb-3">
          Key metrics · last 30 days
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <StatCard
            label="PR Comments"
            value={stats.totalComments}
            sub="inline review comments"
            icon={MessageSquare}
            trend={{ value: "+18%", up: true }}
            accent
          />
          <StatCard
            label="PRs Reviewed"
            value={stats.prsReviewed}
            sub="across all repos"
            icon={GitPullRequest}
            trend={{ value: "+11%", up: true }}
          />
          <StatCard
            label="Avg Review Time"
            value={stats.avgReviewTime}
            sub="end-to-end latency"
            icon={Clock}
            trend={{ value: "−8s", up: true }}
          />
          <StatCard
            label="Issues Caught"
            value={stats.issuesCaught}
            sub="bugs, security, style"
            icon={Cpu}
            trend={{ value: "+5%", up: true }}
          />
          <StatCard
            label="Approval Rate"
            value={`${stats.approvalRate}%`}
            sub="PRs with no blocking issues"
            icon={TrendingUp}
          />
          <StatCard
            label="Repos Installed"
            value={stats.reposInstalled}
            sub="active repositories"
            icon={Zap}
          />
        </div>
      </section>

      {/* Recent PRs + Activity */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* PR table */}
        <section className="xl:col-span-2 bg-bg-panel border border-bg-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-text-primary">
              Recent Pull Requests
            </h2>
            <a
              href="/dashboard/pulls"
              className="text-xs font-mono text-accent-violet hover:underline"
            >
              View all →
            </a>
          </div>
          <PRTable rows={MOCK_PRS} />
        </section>

        {/* Activity feed */}
        <section className="bg-bg-panel border border-bg-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-text-primary">
              Activity
            </h2>
            <span className="text-xs font-mono text-text-muted">live</span>
          </div>
          <ActivityFeed items={MOCK_ACTIVITY} />
        </section>
      </div>
    </div>
  );
}
