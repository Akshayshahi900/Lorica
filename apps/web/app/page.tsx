"use client";

import { signIn, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import {
  Github,
  Zap,
  GitPullRequest,
  MessageSquare,
  Shield,
  ArrowRight,
} from "lucide-react";

export default function LandingPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (session) router.push("/dashboard");
  }, [session, router]);

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-bg-base flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-accent-violet border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-base flex flex-col overflow-hidden">
      {/* Grid texture */}
      <div
        className="fixed inset-0 pointer-events-none opacity-[0.025]"
        style={{
          backgroundImage:
            "linear-gradient(#7C6AF7 1px, transparent 1px), linear-gradient(90deg, #7C6AF7 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      {/* Header */}
      <header className="relative z-10 border-b border-bg-border px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-2.5">
            <img
              src="/assets/logo.png"
              alt="Lorica"
              className="w-9 h-9 object-contain"
            />

            <span className="font-mono font-semibold text-text-primary tracking-tight">
              Lorica
            </span>
          </div>

          {/* Navigation */}
          <div className="flex items-center gap-5">
            <a
              href="https://github.com/Akshayshahi900/Lorica"
              target="_blank"
              rel="noreferrer"
              className="text-text-muted text-sm hover:text-text-primary transition-colors flex items-center gap-1.5"
            >
              <Github size={14} />
              GitHub
            </a>

            <a
              href="https://github.com/Akshayshahi900/Lorica"
              target="_blank"
              rel="noreferrer"
              className="text-text-muted text-sm hover:text-text-primary transition-colors"
            >
              Docs
            </a>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="relative z-10 flex-1">
        {/* Hero */}
        <section className="px-6 pt-20 pb-16">
          <div className="max-w-3xl mx-auto">
            {/* Status */}
            <div className="flex justify-center">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-bg-border bg-bg-panel text-xs text-text-secondary font-mono mb-7">
                <span className="w-1.5 h-1.5 rounded-full bg-status-green animate-pulse_slow" />
                AI CODE REVIEW · GITHUB
              </div>
            </div>

            {/* Heading */}
            <h1 className="text-center text-4xl md:text-5xl font-semibold tracking-tight leading-[1.1] mb-5">
              AI code reviews that{" "}
              <span
                style={{
                  background:
                    "linear-gradient(135deg, #7C6AF7, #9B8AFA)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                understand your codebase.
              </span>
            </h1>

            {/* Description */}
            <p className="max-w-2xl mx-auto text-center text-text-secondary text-base md:text-lg leading-relaxed mb-9">
              Lorica analyzes your pull requests with repository context to
              find bugs, security issues, and risky changes before they reach
              production.
            </p>

            {/* Features */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-xl mx-auto mb-8">
              {[
                {
                  icon: GitPullRequest,
                  label: "PR Analysis",
                  description: "Understand the entire change",
                },
                {
                  icon: MessageSquare,
                  label: "Context-Aware",
                  description: "Reviews with codebase context",
                },
                {
                  icon: Shield,
                  label: "Security Checks",
                  description: "Catch risky changes",
                },
                {
                  icon: Zap,
                  label: "Actionable Fixes",
                  description: "Clear suggestions, not noise",
                },
              ].map(({ icon: Icon, label, description }) => (
                <div
                  key={label}
                  className="flex items-center gap-3 text-left bg-bg-panel border border-bg-border rounded-lg px-4 py-3 hover:border-accent-violet/30 transition-colors"
                >
                  <div className="flex-shrink-0">
                    <Icon
                      size={15}
                      className="text-accent-violet"
                    />
                  </div>

                  <div className="min-w-0">
                    <div className="font-mono text-xs text-text-primary">
                      {label}
                    </div>
                    <div className="text-[11px] text-text-muted mt-0.5">
                      {description}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* CTA */}
            <div className="max-w-xl mx-auto">
              <button
                onClick={() =>
                  signIn("github", { callbackUrl: "/dashboard" })
                }
                className="group w-full flex items-center justify-center gap-2.5 bg-text-primary text-bg-base font-semibold py-3.5 px-5 rounded-lg hover:bg-white transition-all duration-150 text-sm"
              >
                <Github size={17} />

                <span>Install Lorica on GitHub</span>

                <ArrowRight
                  size={15}
                  className="transition-transform group-hover:translate-x-0.5"
                />
              </button>

              <p className="text-center text-text-muted text-[11px] mt-3 font-mono">
                Only the GitHub permissions Lorica needs.
              </p>
            </div>
          </div>
        </section>

        {/* Product preview */}
        <section className="px-6 pb-20">
          <div className="max-w-5xl mx-auto">
            <div className="relative rounded-xl border border-bg-border bg-bg-panel overflow-hidden shadow-2xl">
              {/* Fake browser header */}
              <div className="h-10 border-b border-bg-border flex items-center px-4 gap-2">
                <span className="w-2 h-2 rounded-full bg-bg-border" />
                <span className="w-2 h-2 rounded-full bg-bg-border" />
                <span className="w-2 h-2 rounded-full bg-bg-border" />

                <div className="ml-4 flex-1 max-w-sm h-5 rounded bg-bg-base border border-bg-border" />
              </div>

              {/* Review preview */}
              <div className="p-6 md:p-10">
                <div className="flex items-center justify-between mb-7">
                  <div>
                    <div className="font-mono text-xs text-text-muted mb-2">
                      PULL REQUEST #184
                    </div>

                    <h2 className="text-lg font-semibold text-text-primary">
                      Refactor authentication middleware
                    </h2>
                  </div>

                  <span className="hidden sm:block text-xs font-mono px-2.5 py-1 rounded-full border border-bg-border text-text-secondary">
                    Lorica Review
                  </span>
                </div>

                <div className="space-y-3">
                  {/* Review comment */}
                  <div className="border border-bg-border rounded-lg p-4 bg-bg-base">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="w-2 h-2 rounded-full bg-status-green" />

                      <span className="font-mono text-xs text-text-secondary">
                        Review comment
                      </span>

                      <span className="ml-auto text-[10px] font-mono text-text-muted">
                        HIGH
                      </span>
                    </div>

                    <p className="text-sm text-text-secondary leading-relaxed">
                      This change may allow unauthenticated requests to reach
                      the database before token validation is completed.
                    </p>
                  </div>

                  {/* Suggestion */}
                  <div className="border border-accent-violet/20 rounded-lg p-4 bg-bg-base">
                    <div className="flex items-center gap-2 mb-3">
                      <Zap
                        size={13}
                        className="text-accent-violet"
                      />

                      <span className="font-mono text-xs text-text-secondary">
                        Suggested fix
                      </span>
                    </div>

                    <div className="font-mono text-xs text-text-muted leading-relaxed">
                      Move token validation before the database request.
                    </div>
                  </div>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-3 mt-6">
                  <div className="border border-bg-border rounded-lg p-3">
                    <div className="font-mono text-lg text-text-primary">
                      12
                    </div>
                    <div className="text-[10px] text-text-muted mt-1">
                      Files analyzed
                    </div>
                  </div>

                  <div className="border border-bg-border rounded-lg p-3">
                    <div className="font-mono text-lg text-text-primary">
                      3
                    </div>
                    <div className="text-[10px] text-text-muted mt-1">
                      Issues found
                    </div>
                  </div>

                  <div className="border border-bg-border rounded-lg p-3">
                    <div className="font-mono text-lg text-text-primary">
                      2
                    </div>
                    <div className="text-[10px] text-text-muted mt-1">
                      Suggestions
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="px-6 pb-24">
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-12">
              <p className="font-mono text-xs text-accent-violet mb-3">
                HOW IT WORKS
              </p>

              <h2 className="text-2xl md:text-3xl font-semibold tracking-tight text-text-primary">
                From pull request to review.
              </h2>

              <p className="text-text-secondary text-sm mt-3">
                No manual review setup. Just connect GitHub and keep shipping.
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-4">
              {[
                {
                  number: "01",
                  title: "Connect GitHub",
                  description:
                    "Install Lorica and select the repositories you want to review.",
                },
                {
                  number: "02",
                  title: "Open a PR",
                  description:
                    "Lorica analyzes your changes and the surrounding codebase.",
                },
                {
                  number: "03",
                  title: "Fix & Ship",
                  description:
                    "Get contextual comments, security findings, and actionable fixes.",
                },
              ].map(({ number, title, description }) => (
                <div
                  key={number}
                  className="border border-bg-border bg-bg-panel rounded-lg p-5"
                >
                  <div className="font-mono text-xs text-accent-violet mb-5">
                    {number}
                  </div>

                  <h3 className="text-sm font-semibold text-text-primary mb-2">
                    {title}
                  </h3>

                  <p className="text-xs text-text-muted leading-relaxed">
                    {description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Differentiator */}
        <section className="px-6 pb-24">
          <div className="max-w-3xl mx-auto">
            <div className="border border-bg-border bg-bg-panel rounded-xl p-7 md:p-10">
              <p className="font-mono text-xs text-accent-violet mb-4">
                WHY LORICA
              </p>

              <h2 className="text-2xl md:text-3xl font-semibold tracking-tight text-text-primary mb-4">
                Lorica doesn't just read the diff.
              </h2>

              <p className="text-text-secondary text-sm md:text-base leading-relaxed">
                It uses repository context to understand how changed files,
                functions, and dependencies relate to each other — giving your
                pull requests reviews that are grounded in the codebase.
              </p>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-bg-border px-6 py-5">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <span className="text-text-muted text-xs font-mono">
            Built by Akshay Shahi
          </span>

          <span className="text-text-muted text-xs font-mono">
            Lorica · AI Code Reviewer
          </span>
        </div>
      </footer>
    </div>
  );
}