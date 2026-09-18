"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  MessageSquare,
  GitPullRequest,
  Clock,
  ShieldAlert,
  TrendingUp,
  Zap,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import Link from "next/link";

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
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    loadDashboard();

    return () => controller.abort();
  }, []);

  const stats = toDashboardStats(pullRequests);

  const recentPullRequests = useMemo(
    () => pullRequests.slice(0, 5),
    [pullRequests]
  );

  const attentionPullRequests = useMemo(
    () =>
      pullRequests
        .filter((pr) => {
          // Keep this intentionally conservative.
          // Any PR with comments/findings is worth looking at.
          return (pr as any).commentCount > 0 || (pr as any).comments > 0;
        })
        .slice(0, 3),
    [pullRequests]
  );

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-5 sm:space-y-6">
      {/* =========================================================
          HEADER
      ========================================================= */}
      <header className="relative overflow-hidden rounded-2xl border border-bg-border bg-bg-panel px-5 py-5 sm:px-6 sm:py-6">
        <div className="absolute -right-16 -top-20 h-48 w-48 rounded-full bg-accent-violet/10 blur-3xl" />

        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-accent-violet">
              Overview
            </p>

            <h1 className="mt-1 text-xl font-semibold tracking-tight text-text-primary">
              Code review activity
            </h1>

            <p className="text-xs text-text-muted font-mono mt-1">
              {today} · {stats.reposInstalled}{" "}
              {stats.reposInstalled === 1 ? "repository" : "repositories"}
            </p>
          </div>

          <div className="flex w-fit items-center gap-2 text-xs font-mono text-status-green bg-status-green/10 border border-status-green/20 px-3 py-1.5 rounded-lg">
            <span className="w-1.5 h-1.5 rounded-full bg-status-green animate-pulse_slow" />
            Lorica is active
          </div>
        </div>
      </header>

      {/* =========================================================
          ERROR
      ========================================================= */}
      {error && (
        <div className="border border-status-red/20 bg-status-red/5 rounded-xl px-4 py-3 text-sm text-status-red">
          {error}
        </div>
      )}

      {/* =========================================================
          INSTALL BANNER
      ========================================================= */}
      <InstallBanner installedCount={stats.reposInstalled} />

      {/* =========================================================
          NEEDS ATTENTION
      ========================================================= */}
      {!loading && attentionPullRequests.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-xs font-mono text-text-muted uppercase tracking-wider">
                Needs attention
              </p>

              <p className="text-xs text-text-muted mt-1">
                Recent reviews with findings
              </p>
            </div>

            <Link
              href="/dashboard/pulls"
              className="inline-flex items-center gap-1 text-xs font-mono text-accent-violet hover:underline"
            >
              View all
              <ArrowUpRight size={12} />
            </Link>
          </div>

          <div className="space-y-2">
            {attentionPullRequests.map((pr, index) => (
              <div
                key={(pr as any).id ?? (pr as any).number ?? index}
                className="group flex items-center justify-between gap-4 rounded-xl border border-bg-border bg-bg-panel px-4 py-3.5 hover:border-accent-violet/30 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-status-red/10 border border-status-red/20">
                    <AlertTriangle
                      size={14}
                      className="text-status-red"
                    />
                  </div>

                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text-primary truncate">
                      {(pr as any).title ??
                        (pr as any).name ??
                        `Pull request #${(pr as any).number ?? "—"}`}
                    </p>

                    <p className="text-[11px] font-mono text-text-muted mt-0.5">
                      PR #{(pr as any).number ?? "—"} · review has findings
                    </p>
                  </div>
                </div>

                <Link
                  href={`/dashboard/pulls/${(pr as any).number ?? ""}`}
                  className="shrink-0 text-xs font-mono text-accent-violet opacity-80 group-hover:opacity-100 transition-opacity"
                >
                  Review →
                </Link>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* =========================================================
          RECENT PULL REQUESTS
      ========================================================= */}
      <section className="bg-bg-panel border border-bg-border rounded-xl p-4 sm:p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-[11px] font-mono uppercase tracking-[0.16em] text-text-muted">
              Pull requests
            </p>

            <h2 className="mt-1 text-sm font-semibold text-text-primary">
              Recent reviews
            </h2>
          </div>

          <Link
            href="/dashboard/pulls"
            className="inline-flex items-center gap-1 text-xs font-mono text-accent-violet hover:underline"
          >
            View all
            <ArrowUpRight size={12} />
          </Link>
        </div>

        {loading ? (
          <div className="space-y-3">
            <TableSkeleton />
            <TableSkeleton />
            <TableSkeleton />
          </div>
        ) : recentPullRequests.length === 0 ? (
          <EmptyReviews />
        ) : (
          <PRTable rows={toPRRows(recentPullRequests)} />
        )}
      </section>

      {/* =========================================================
          METRICS
      ========================================================= */}
      <section>
        <div className="mb-3">
          <p className="text-xs font-mono text-text-muted uppercase tracking-wider">
            Review metrics
          </p>

          <p className="text-xs text-text-muted mt-1">
            Across all recorded reviews
          </p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {loading ? (
            <MetricSkeleton />
          ) : (
            <>
              <StatCard
                label="PRs Reviewed"
                value={stats.prsReviewed}
                sub="completed reviews"
                icon={GitPullRequest}
                accent
              />

              <StatCard
                label="Findings"
                value={stats.totalComments}
                sub="comments posted by Lorica"
                icon={MessageSquare}
              />

              <StatCard
                label="Clean Review Rate"
                value={
                  stats.approvalRate === null
                    ? "—"
                    : `${stats.approvalRate}%`
                }
                sub="reviews with no findings"
                icon={CheckCircle2}
              />

              <StatCard
                label="Avg Review Time"
                value={stats.avgReviewTime}
                sub="total elapsed time"
                icon={Clock}
              />

              <StatCard
                label="Repositories"
                value={stats.reposInstalled}
                sub="with review history"
                icon={Zap}
              />

              <StatCard
                label="Issues Caught"
                value={stats.issuesCaught}
                sub="findings across reviews"
                icon={ShieldAlert}
              />
            </>
          )}
        </div>
      </section>

      {/* =========================================================
          ACTIVITY
      ========================================================= */}
      <section className="bg-bg-panel border border-bg-border rounded-xl p-4 sm:p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-[11px] font-mono uppercase tracking-[0.16em] text-text-muted">
              Timeline
            </p>

            <h2 className="mt-1 text-sm font-semibold text-text-primary">
              Recent activity
            </h2>
          </div>

          <span className="text-xs font-mono text-text-muted">
            recent
          </span>
        </div>

        {loading ? (
          <div className="space-y-3">
            <ActivitySkeleton />
            <ActivitySkeleton />
            <ActivitySkeleton />
          </div>
        ) : (
          <ActivityFeed items={toActivityItems(pullRequests)} />
        )}
      </section>
    </div>
  );
}

/* ===============================================================
   LOADING STATES
================================================================ */

function MetricSkeleton() {
  return (
    <>
      {Array.from({ length: 6 }, (_, index) => (
        <div
          key={index}
          className="h-[154px] animate-pulse rounded-xl border border-bg-border bg-bg-panel p-4"
        >
          <div className="h-3 w-20 rounded bg-bg-hover" />

          <div className="mt-8 h-7 w-14 rounded bg-bg-hover" />

          <div className="mt-2 h-3 w-28 rounded bg-bg-hover" />
        </div>
      ))}
    </>
  );
}

function TableSkeleton() {
  return (
    <div className="h-14 animate-pulse rounded-lg border border-bg-border bg-bg-base" />
  );
}

function ActivitySkeleton() {
  return (
    <div className="h-12 animate-pulse rounded-lg bg-bg-base" />
  );
}

/* ===============================================================
   EMPTY STATE
================================================================ */

function EmptyReviews() {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-bg-border bg-bg-base mb-4">
        <GitPullRequest
          size={17}
          className="text-text-muted"
        />
      </div>

      <h3 className="text-sm font-medium text-text-primary">
        No pull requests yet
      </h3>

      <p className="text-xs text-text-muted mt-1 max-w-xs">
        Once Lorica reviews a pull request, your review history will appear
        here.
      </p>

      <Link
        href="/dashboard/pulls"
        className="mt-4 text-xs font-mono text-accent-violet hover:underline"
      >
        View pull requests →
      </Link>
    </div>
  );
}