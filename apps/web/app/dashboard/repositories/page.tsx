"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  FolderGit2,
  GitPullRequest,
  MessageSquare,
  Plus,
  CheckCircle2,
  ExternalLink,
} from "lucide-react";

import {
  fetchPullRequests,
  PullRequestRecord,
} from "@/lib/pull-requests";

type RepositorySummary = {
  name: string;
  fullName: string;
  prsReviewed: number;
  findings: number;
  lastReviewed: string | null;
};

export default function RepositoriesPage() {
  const [pullRequests, setPullRequests] = useState<PullRequestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function loadRepositories() {
      try {
        const data = await fetchPullRequests(controller.signal);
        setPullRequests(data);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          console.error(error);
          setError("Repository data is currently unavailable.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    loadRepositories();

    return () => controller.abort();
  }, []);

  const repositories = useMemo(() => {
    const map = new Map<string, RepositorySummary>();

    for (const pr of pullRequests) {
      const item = pr as any;

      /*
       * Adjust these field names if your PullRequestRecord uses
       * different names.
       */
      const fullName =
        item.repositoryFullName ??
        item.repoFullName ??
        item.repository ??
        item.repo ??
        "Unknown repository";

      const name =
        item.repositoryName ??
        item.repoName ??
        fullName.split("/").pop() ??
        "Unknown";

      const findings =
        item.commentCount ??
        item.comments ??
        item.findings ??
        0;

      const reviewedAt =
        item.reviewedAt ??
        item.completedAt ??
        item.updatedAt ??
        item.createdAt ??
        null;

      const existing = map.get(fullName);

      if (existing) {
        existing.prsReviewed += 1;
        existing.findings += Number(findings) || 0;

        if (
          reviewedAt &&
          (!existing.lastReviewed ||
            new Date(reviewedAt) >
              new Date(existing.lastReviewed))
        ) {
          existing.lastReviewed = reviewedAt;
        }
      } else {
        map.set(fullName, {
          name,
          fullName,
          prsReviewed: 1,
          findings: Number(findings) || 0,
          lastReviewed: reviewedAt,
        });
      }
    }

    return Array.from(map.values()).sort(
      (a, b) => b.prsReviewed - a.prsReviewed
    );
  }, [pullRequests]);

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
      {/* =========================================================
          HEADER
      ========================================================= */}
      <header className="relative overflow-hidden rounded-2xl border border-bg-border bg-bg-panel px-5 py-5 sm:px-6 sm:py-6">
        <div className="absolute -right-16 -top-20 h-48 w-48 rounded-full bg-accent-violet/10 blur-3xl" />

        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-accent-violet">
              Workspace
            </p>

            <h1 className="mt-1 text-xl font-semibold tracking-tight text-text-primary">
              Repositories
            </h1>

            <p className="text-xs text-text-muted font-mono mt-1">
              {loading
                ? "Loading repositories..."
                : `${repositories.length} ${
                    repositories.length === 1
                      ? "repository"
                      : "repositories"
                  } connected`}
            </p>
          </div>

          <Link
            href="/dashboard/install"
            className="inline-flex w-fit items-center justify-center gap-2 rounded-lg bg-text-primary px-4 py-2.5 text-xs font-semibold text-bg-base hover:bg-white transition-colors"
          >
            <Plus size={14} />
            Add repository
          </Link>
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
          REPOSITORY LIST
      ========================================================= */}
      <section>
        <div className="flex items-end justify-between mb-3">
          <div>
            <p className="text-xs font-mono uppercase tracking-wider text-text-muted">
              Connected repositories
            </p>

            <p className="text-xs text-text-muted mt-1">
              Lorica will automatically review pull requests from these
              repositories.
            </p>
          </div>
        </div>

        {loading ? (
          <RepositorySkeleton />
        ) : repositories.length === 0 ? (
          <EmptyRepositories />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {repositories.map((repository) => (
              <RepositoryCard
                key={repository.fullName}
                repository={repository}
              />
            ))}
          </div>
        )}
      </section>

      {/* =========================================================
          INSTALL CTA
      ========================================================= */}
      {!loading && (
        <section className="rounded-xl border border-bg-border bg-bg-panel p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <GitPullRequest
                  size={15}
                  className="text-accent-violet"
                />

                <h2 className="text-sm font-semibold text-text-primary">
                  Add another repository
                </h2>
              </div>

              <p className="text-xs text-text-muted mt-1.5 max-w-xl">
                Connect another GitHub repository and let Lorica review its
                pull requests automatically.
              </p>
            </div>

            <Link
              href="/dashboard/install"
              className="inline-flex w-fit items-center gap-2 rounded-lg border border-bg-border px-3.5 py-2 text-xs font-mono text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
            >
              Install Lorica
              <ArrowUpRight size={12} />
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}

/* ===============================================================
   REPOSITORY CARD
================================================================ */

function RepositoryCard({
  repository,
}: {
  repository: RepositorySummary;
}) {
  return (
    <div className="group rounded-xl border border-bg-border bg-bg-panel p-5 hover:border-accent-violet/30 transition-colors">
      {/* Top */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-bg-border bg-bg-base">
            <FolderGit2
              size={16}
              className="text-accent-violet"
            />
          </div>

          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-text-primary truncate">
              {repository.name}
            </h2>

            <p className="text-[11px] font-mono text-text-muted truncate mt-1">
              {repository.fullName}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 rounded-md border border-status-green/20 bg-status-green/5 px-2 py-1">
          <CheckCircle2
            size={11}
            className="text-status-green"
          />

          <span className="text-[10px] font-mono text-status-green">
            enabled
          </span>
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-bg-border my-5" />

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-text-muted">
            <GitPullRequest size={12} />

            <span className="text-[10px] font-mono uppercase tracking-wider">
              Reviews
            </span>
          </div>

          <p className="text-lg font-semibold text-text-primary mt-1">
            {repository.prsReviewed}
          </p>
        </div>

        <div>
          <div className="flex items-center gap-1.5 text-text-muted">
            <MessageSquare size={12} />

            <span className="text-[10px] font-mono uppercase tracking-wider">
              Findings
            </span>
          </div>

          <p className="text-lg font-semibold text-text-primary mt-1">
            {repository.findings}
          </p>
        </div>
      </div>

      {/* Bottom */}
      <div className="flex items-center justify-between mt-5 pt-4 border-t border-bg-border">
        <span className="text-[10px] font-mono text-text-muted">
          {repository.lastReviewed
            ? `Last reviewed ${formatRelativeTime(
                repository.lastReviewed
              )}`
            : "No reviews yet"}
        </span>

        <Link
          href={`/dashboard/pulls?repository=${encodeURIComponent(
            repository.fullName
          )}`}
          className="inline-flex items-center gap-1 text-xs font-mono text-accent-violet opacity-80 group-hover:opacity-100 transition-opacity"
        >
          View reviews
          <ArrowUpRight size={12} />
        </Link>
      </div>
    </div>
  );
}

/* ===============================================================
   EMPTY STATE
================================================================ */

function EmptyRepositories() {
  return (
    <div className="rounded-xl border border-dashed border-bg-border bg-bg-panel px-6 py-14 text-center">
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-lg border border-bg-border bg-bg-base">
        <FolderGit2
          size={18}
          className="text-text-muted"
        />
      </div>

      <h2 className="text-sm font-semibold text-text-primary mt-4">
        No repositories connected
      </h2>

      <p className="text-xs text-text-muted max-w-sm mx-auto mt-1.5 leading-relaxed">
        Connect a GitHub repository to start automatically reviewing your
        pull requests with Lorica.
      </p>

      <Link
        href="/dashboard/install"
        className="inline-flex items-center gap-2 mt-5 rounded-lg bg-text-primary text-bg-base px-4 py-2.5 text-xs font-semibold hover:bg-white transition-colors"
      >
        <Plus size={14} />
        Connect repository
      </Link>
    </div>
  );
}

/* ===============================================================
   LOADING
================================================================ */

function RepositorySkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {Array.from({ length: 2 }, (_, index) => (
        <div
          key={index}
          className="h-[250px] animate-pulse rounded-xl border border-bg-border bg-bg-panel p-5"
        >
          <div className="flex gap-3">
            <div className="h-9 w-9 rounded-lg bg-bg-hover" />

            <div className="space-y-2">
              <div className="h-3 w-28 rounded bg-bg-hover" />
              <div className="h-2.5 w-40 rounded bg-bg-hover" />
            </div>
          </div>

          <div className="mt-8 grid grid-cols-2 gap-3">
            <div className="h-16 rounded-lg bg-bg-hover" />
            <div className="h-16 rounded-lg bg-bg-hover" />
          </div>

          <div className="mt-6 h-3 w-32 rounded bg-bg-hover" />
        </div>
      ))}
    </div>
  );
}

/* ===============================================================
   TIME
================================================================ */

function formatRelativeTime(date: string) {
  const diff = Date.now() - new Date(date).getTime();

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ago`;
  }

  if (hours > 0) {
    return `${hours}h ago`;
  }

  if (minutes > 0) {
    return `${minutes}m ago`;
  }

  return "just now";
}