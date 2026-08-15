"use client";
import { signIn, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Github, Zap, GitPullRequest, MessageSquare, Shield } from "lucide-react";

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
    <div className="min-h-screen bg-bg-base flex flex-col">
      {/* Grid texture overlay */}
      <div
        className="fixed inset-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage:
            "linear-gradient(#7C6AF7 1px, transparent 1px), linear-gradient(90deg, #7C6AF7 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      {/* Header */}
      <header className="relative z-10 border-b border-bg-border px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="text-xl">🐇</span>
          <span className="font-mono font-semibold text-text-primary tracking-tight">
            rabbit
          </span>
          <span className="text-text-muted font-mono text-xs px-1.5 py-0.5 rounded border border-bg-border">
            v1
          </span>
        </div>
        <a
          href="https://github.com"
          target="_blank"
          rel="noreferrer"
          className="text-text-muted text-sm hover:text-text-secondary transition-colors flex items-center gap-1.5"
        >
          <Github size={14} />
          Docs
        </a>
      </header>

      {/* Hero */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-6">
        <div className="max-w-md w-full">
          {/* Status pill */}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-bg-border bg-bg-panel text-xs text-text-secondary font-mono mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-status-green animate-pulse_slow" />
            Bot online · reviewing PRs
          </div>

          <h1 className="text-4xl font-semibold tracking-tight mb-3 leading-tight">
            Code review,{" "}
            <span
              style={{
                background: "linear-gradient(135deg, #7C6AF7, #9B8AFA)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              automated.
            </span>
          </h1>
          <p className="text-text-secondary text-base mb-8 leading-relaxed">
            Install Lorica on your GitHub repos and get instant, context-aware
            PR reviews — powered by AI, without the wait.
          </p>

          {/* Feature list */}
          <div className="grid grid-cols-2 gap-2 mb-8">
            {[
              { icon: GitPullRequest, label: "PR analysis" },
              { icon: MessageSquare, label: "Inline comments" },
              { icon: Shield, label: "Security checks" },
              { icon: Zap, label: "< 60s reviews" },
            ].map(({ icon: Icon, label }) => (
              <div
                key={label}
                className="flex items-center gap-2 text-sm text-text-secondary bg-bg-panel border border-bg-border rounded-lg px-3 py-2.5"
              >
                <Icon size={13} className="text-accent-violet flex-shrink-0" />
                <span className="font-mono text-xs">{label}</span>
              </div>
            ))}
          </div>

          {/* CTA */}
          <button
            onClick={() => signIn("github", { callbackUrl: "/dashboard" })}
            className="w-full flex items-center justify-center gap-2.5 bg-text-primary text-bg-base font-semibold py-3 px-5 rounded-lg hover:bg-white transition-all duration-150 text-sm"
          >
            <Github size={16} />
            Continue with GitHub
          </button>
          <p className="text-center text-text-muted text-xs mt-3 font-mono">
            We only request the permissions we need.
          </p>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-bg-border px-6 py-4 flex items-center justify-between">
        <span className="text-text-muted text-xs font-mono">
          Built by Akshay Shahi
        </span>
        <span className="text-text-muted text-xs font-mono">
          Lorica· AI Code Reviewer
        </span>
      </footer>
    </div>
  );
}
