"use client";

import { useEffect, useState } from "react";
import { PRTable, PRRow } from "@/components/PRTable";
import { fetchPullRequests, toPRRows } from "@/lib/pull-requests";

export default function PullsPage() {
  const [prs, setPrs] = useState<PRRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function loadPullRequests() {
      try {
        setPrs(toPRRows(await fetchPullRequests(controller.signal)));
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        console.error(error);
        setError("Failed to load pull requests");
      } finally {
        setLoading(false);
      }
    }

    loadPullRequests();
    return () => controller.abort();
  }, []);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-text-primary">
          Pull Requests
        </h1>

        <p className="text-xs text-text-muted font-mono mt-0.5">
          All PRs reviewed by Lorica
        </p>
      </div>

      <div className="bg-bg-panel border border-bg-border rounded-xl p-4">
        {loading && (
          <div className="text-sm text-text-muted">
            Loading pull requests...
          </div>
        )}

        {error && (
          <div className="text-sm text-red-400">
            {error}
          </div>
        )}

        {!loading && !error && (
          <PRTable rows={prs} />
        )}
      </div>
    </div>
  );
}
