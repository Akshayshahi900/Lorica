"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { PRTable, PRRow } from "@/components/PRTable";
import { fetchPullRequests, toPRRows } from "@/lib/pull-requests";

export default function PullsPage() {
  const [prs, setPrs] = useState<PRRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPullRequests = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      setPrs(toPRRows(await fetchPullRequests(signal)));
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      console.error(error);
      setError("Failed to load pull requests");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadPullRequests(controller.signal);
    return () => controller.abort();
  }, [loadPullRequests]);

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-accent-violet">Review history</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-text-primary">Pull Requests</h1>
          <p className="text-xs text-text-muted font-mono mt-1">All pull requests processed by Lorica</p>
        </div>
        <button onClick={() => loadPullRequests()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-bg-border bg-bg-panel px-3 py-2 text-xs font-mono text-text-secondary transition-colors hover:border-accent-violet/40 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60">
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      <div className="bg-bg-panel border border-bg-border rounded-xl p-4">
        {loading && (
          <div className="text-sm text-text-muted">
            Loading pull requests...
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-status-red/20 bg-status-red/5 p-4 text-sm text-status-red">
            <p>{error}</p>
            <button onClick={() => loadPullRequests()} className="mt-2 text-xs font-mono underline underline-offset-4">Try again</button>
          </div>
        )}

        {!loading && !error && (
          <PRTable rows={prs} />
        )}
      </div>
    </div>
  );
}
