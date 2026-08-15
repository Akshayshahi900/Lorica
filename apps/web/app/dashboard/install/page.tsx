"use client";
import { Github, ArrowRight, CheckCircle2, Terminal, Puzzle, Key } from "lucide-react";

const APP_NAME = process.env.NEXT_PUBLIC_GITHUB_APP_NAME ?? "rabbit-review";

const STEPS = [
  {
    icon: Puzzle,
    title: "Install GitHub App",
    description:
      "Click the button below to open the GitHub App installation page. Select which repositories you want Lorica to review — you can add more at any time.",
    action: (
      <a
        href={`https://github.com/apps/${APP_NAME}/installations/new`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-2 px-4 py-2 bg-accent-violet text-white text-xs font-mono rounded-lg hover:bg-accent-violet-dim transition-colors"
      >
        <Github size={13} />
        Install Lorica on GitHub
        <ArrowRight size={11} />
      </a>
    ),
  },
  {
    icon: Terminal,
    title: "Verify the webhook",
    description:
      "After installing, open any pull request in the selected repo. Lorica will post its first review within 60 seconds. Check the PR comments tab.",
    action: null,
  },
  {
    icon: Key,
    title: "Configure (optional)",
    description:
      "Add a .rabbit.yml file to the root of your repo to customise review rules — which files to skip, strictness level, and focus areas.",
    action: (
      <pre className="mt-2 text-xs font-mono bg-bg-base border border-bg-border rounded-lg p-3 text-text-secondary leading-relaxed">
        {`# .rabbit.yml\nstrictness: standard   # strict | standard | relaxed\nskip:\n  - "**/*.test.ts"\n  - "docs/**"\nfocus:\n  - security\n  - performance`}
      </pre>
    ),
  },
];

const INSTALLED_REPOS = [
  { name: "chat-app", active: true },
  { name: "hy-proxy", active: true },
  { name: "Voidstore", active: true },
];

export default function InstallPage() {
  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-text-primary">Install Bot</h1>
        <p className="text-xs text-text-muted font-mono mt-0.5">
          Get Lorica reviewing pull requests in 3 steps
        </p>
      </div>

      {/* Installed repos */}
      {INSTALLED_REPOS.length > 0 && (
        <div className="bg-bg-panel border border-bg-border rounded-xl p-4">
          <h2 className="text-sm font-semibold text-text-primary mb-3">
            Installed repositories
          </h2>
          <ul className="space-y-2">
            {INSTALLED_REPOS.map((r) => (
              <li
                key={r.name}
                className="flex items-center gap-3 text-sm font-mono"
              >
                <CheckCircle2 size={13} className="text-status-green flex-shrink-0" />
                <span className="text-text-primary">{r.name}</span>
                {r.active && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-status-green/10 border border-status-green/20 text-status-green font-mono uppercase tracking-wider">
                    active
                  </span>
                )}
              </li>
            ))}
          </ul>
          <a
            href={`https://github.com/apps/${APP_NAME}/installations/new`}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex items-center gap-1.5 text-xs font-mono text-accent-violet hover:underline"
          >
            Add more repos <ArrowRight size={10} />
          </a>
        </div>
      )}

      {/* Steps */}
      <div className="space-y-3">
        {STEPS.map((step, i) => (
          <div
            key={i}
            className="bg-bg-panel border border-bg-border rounded-xl p-5 flex gap-4"
          >
            <div className="flex flex-col items-center gap-1.5">
              <div className="w-7 h-7 rounded-lg bg-accent-violet/20 border border-accent-violet/30 flex items-center justify-center flex-shrink-0">
                <step.icon size={13} className="text-accent-violet" />
              </div>
              {i < STEPS.length - 1 && (
                <div className="w-px flex-1 bg-bg-border min-h-4" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-xs font-mono text-text-muted">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="text-sm font-semibold text-text-primary">
                  {step.title}
                </h3>
              </div>
              <p className="text-xs text-text-secondary leading-relaxed">
                {step.description}
              </p>
              {step.action && <div className="mt-3">{step.action}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
