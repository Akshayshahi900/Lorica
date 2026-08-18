"use client";
import { signOut } from "next-auth/react";
import { Session } from "next-auth";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  GitPullRequest,
  Settings,
  LogOut,
  Puzzle,
} from "lucide-react";
import clsx from "clsx";

const NAV = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Overview" },
  { href: "/dashboard/pulls", icon: GitPullRequest, label: "Pull Requests" },
  { href: "/dashboard/install", icon: Puzzle, label: "Install Bot" },
  { href: "/dashboard/settings", icon: Settings, label: "Settings" },
];

export function Sidebar({ session }: { session: Session }) {
  const pathname = usePathname();

  return (
    <>
    <aside className="hidden lg:flex w-56 flex-shrink-0 bg-bg-panel border-r border-bg-border flex-col h-screen sticky top-0">
      {/* Logo */}
      <div className="px-4 py-4 border-b border-bg-border flex items-center gap-2.5">
        <span className="text-lg">🐇</span>
        <span className="font-mono font-semibold text-text-primary text-sm tracking-tight">
          lorica
        </span>
        <span className="ml-auto w-2 h-2 rounded-full bg-status-green animate-pulse_slow flex-shrink-0" title="Bot online" />
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-0.5">
        {NAV.map(({ href, icon: Icon, label }) => {
          const active =
            href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={clsx(
                "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-all duration-100",
                active
                  ? "bg-accent-violet-glow text-accent-violet border border-accent-violet/20"
                  : "text-text-secondary hover:bg-bg-hover hover:text-text-primary border border-transparent"
              )}
            >
              <Icon size={14} className="flex-shrink-0" />
              <span className="font-mono text-xs">{label}</span>
            </Link>
          );
        })}
      </nav>

      {/* User */}
      <div className="border-t border-bg-border p-3">
        <div className="flex items-center gap-2.5 mb-2">
          {session.user?.image ? (
            <Image
              src={session.user.image}
              alt={session.user.name ?? "User"}
              width={28}
              height={28}
              className="rounded-full flex-shrink-0 ring-1 ring-bg-border"
            />
          ) : (
            <div className="w-7 h-7 rounded-full bg-bg-hover flex-shrink-0" />
          )}
          <div className="min-w-0">
            <p className="text-xs font-medium text-text-primary truncate">
              {session.user?.name}
            </p>
            <p className="text-xs text-text-muted font-mono truncate">
              {(session as any).login ?? session.user?.email}
            </p>
          </div>
        </div>
        <button
          onClick={() => signOut({ callbackUrl: "/" })}
          className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-xs text-text-muted hover:text-status-red hover:bg-bg-hover transition-all duration-100 font-mono border border-transparent hover:border-status-red/20"
        >
          <LogOut size={12} />
          Sign out
        </button>
      </div>
    </aside>
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-20 border-t border-bg-border bg-bg-panel/95 backdrop-blur px-2 py-2 grid grid-cols-4 gap-1 safe-area-bottom">
      {NAV.map(({ href, icon: Icon, label }) => {
        const active = href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-label={label}
            className={clsx(
              "flex min-h-12 flex-col items-center justify-center gap-1 rounded-lg text-[10px] font-mono transition-colors",
              active ? "bg-accent-violet-glow text-accent-violet" : "text-text-muted hover:text-text-secondary",
            )}
          >
            <Icon size={16} />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
    </>
  );
}
