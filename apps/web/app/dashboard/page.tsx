"use client";

import { useEffect, useState } from "react";
import { MessageSquare, GitPullRequest, Clock, Cpu, TrendingUp, Zap } from "lucide-react";
import { StatCard } from "@/components/StatCard";
import { PRTable } from "@/components/PRTable";
import { ActivityFeed } from "@/components/ActivityFeed";
import { InstallBanner } from "@/components/InstallBanner";
import {
  fetchPullRequests,
  PullRequestRecord,
  toActivityItems,
  toDashboardStats,
  toPRRows,
} from "@/lib/pull-requests";

export default function DashboardPage() {
  const [pullRequests, setPullRequests] = useState<PullRequestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function loadDashboard() {
      try {
        setPullRequests(await fetchPullRequests(controller.signal));
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          console.error(error);
          setError("Live review data is currently unavailable.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    loadDashboard();
    return () => controller.abort();
  }, []);

  const stats = toDashboardStats(pullRequests);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Overview</h1>
          <p className="text-xs text-text-muted font-mono mt-0.5">
            {new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
            &nbsp;· your repositories
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs font-mono text-status-green bg-status-green/10 border border-status-green/20 px-3 py-1.5 rounded-lg">
          <span className="w-1.5 h-1.5 rounded-full bg-status-green animate-pulse_slow" />
          Bot is active
        </div>
      </div>

      {error && (
        <div className="border border-status-red/20 bg-status-red/5 rounded-xl px-4 py-3 text-sm text-status-red">{error}</div>
      )}

      <InstallBanner installedCount={stats.reposInstalled} />

      <section>
        <p className="text-xs font-mono text-text-muted uppercase tracking-wider mb-3">Key metrics · all recorded reviews</p>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <StatCard label="Review Findings" value={stats.totalComments} sub="findings posted by Lorica" icon={MessageSquare} accent />
          <StatCard label="PRs Reviewed" value={stats.prsReviewed} sub="completed reviews" icon={GitPullRequest} />
          <StatCard label="Avg Review Time" value={stats.avgReviewTime} sub="webhook to completed review" icon={Clock} />
          <StatCard label="Issues Caught" value={stats.issuesCaught} sub="findings across completed reviews" icon={Cpu} />
          <StatCard label="Clean Review Rate" value={stats.approvalRate === null ? "—" : `${stats.approvalRate}%`} sub="reviews with no findings" icon={TrendingUp} />
          <StatCard label="Repositories" value={stats.reposInstalled} sub="repositories with review history" icon={Zap} />
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <section className="xl:col-span-2 bg-bg-panel border border-bg-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-text-primary">Recent Pull Requests</h2>
            <a href="/dashboard/pulls" className="text-xs font-mono text-accent-violet hover:underline">View all →</a>
          </div>
          {loading ? <div className="text-sm text-text-muted">Loading pull requests...</div> : <PRTable rows={toPRRows(pullRequests.slice(0, 5))} />}
        </section>

        <section className="bg-bg-panel border border-bg-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-text-primary">Activity</h2>
            <span className="text-xs font-mono text-text-muted">recent</span>
          </div>
          {loading ? <div className="text-sm text-text-muted">Loading activity...</div> : <ActivityFeed items={toActivityItems(pullRequests)} />}
        </section>
      </div>
    </div>
  );
}
