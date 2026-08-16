"use client";
import { PRTable, PRRow } from "@/components/PRTable";

const ALL_PRS: PRRow[] = [
  { id: 1, repo: "chat-app", title: "feat: WebSocket reconnection with exponential backoff", number: 83, comments: 7, status: "reviewed", author: "akshaySh", reviewedAt: "2 min ago", url: "#" },
  { id: 2, repo: "hy-proxy", title: "fix: race condition in epoll event handling", number: 29, comments: 4, status: "reviewed", author: "akshaySh", reviewedAt: "1h ago", url: "#" },
  { id: 3, repo: "Voidstore", title: "refactor: extract RESP parser into standalone module", number: 55, comments: 3, status: "reviewed", author: "akshaySh", reviewedAt: "3h ago", url: "#" },
  { id: 4, repo: "Outmoni", title: "chore: upgrade Prisma to v5 and migrate schema", number: 101, comments: 0, status: "skipped", author: "akshaySh", reviewedAt: "5h ago", url: "#" },
  { id: 5, repo: "SaffronAI", title: "feat: stream LLM responses over SSE", number: 17, comments: 9, status: "reviewed", author: "akshaySh", reviewedAt: "Yesterday", url: "#" },
  { id: 6, repo: "Thread_pool", title: "perf: tune work-stealing threshold for core count", number: 12, comments: 5, status: "reviewed", author: "akshaySh", reviewedAt: "2 days ago", url: "#" },
  { id: 7, repo: "chat-app", title: "fix: message ordering under concurrent sends", number: 79, comments: 2, status: "reviewed", author: "akshaySh", reviewedAt: "2 days ago", url: "#" },
];

export default function PullsPage() {
  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-text-primary">Pull Requests</h1>
        <p className="text-xs text-text-muted font-mono mt-0.5">All PRs reviewed by Lorica</p>
      </div>

      <div className="bg-bg-panel border border-bg-border rounded-xl p-4">
        <PRTable rows={ALL_PRS} />
      </div>
    </div>
  );
}
