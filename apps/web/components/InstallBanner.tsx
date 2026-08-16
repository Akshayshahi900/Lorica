"use client";
import { Puzzle, ArrowRight } from "lucide-react";

export function InstallBanner({ installedCount }: { installedCount: number }) {
  const appName = process.env.NEXT_PUBLIC_GITHUB_APP_NAME ?? "lorica-review";

  if (installedCount > 0) return null;

  return (
    <div className="border border-accent-violet/30 bg-accent-violet-glow rounded-xl p-4 flex items-start gap-4">
      <div className="w-9 h-9 rounded-lg bg-accent-violet/20 flex items-center justify-center flex-shrink-0">
        <Puzzle size={16} className="text-accent-violet" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text-primary">
          Install Lorica on your repos
        </p>
        <p className="text-xs text-text-secondary mt-0.5 leading-relaxed">
          Add the GitHub App to one or more repositories and Lorica will
          automatically review every new pull request.
        </p>
      </div>
      <a
        href={`https://github.com/apps/${appName}/installations/new`}
        target="_blank"
        rel="noreferrer"
        className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-accent-violet text-white text-xs font-mono rounded-lg hover:bg-accent-violet-dim transition-colors"
      >
        Install
        <ArrowRight size={11} />
      </a>
    </div>
  );
}
