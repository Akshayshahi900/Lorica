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
  FolderGit2,
  CircleCheck,
} from "lucide-react";
import clsx from "clsx";

const WORKSPACE_NAV = [
  {
    href: "/dashboard",
    icon: LayoutDashboard,
    label: "Overview",
  },
  {
    href: "/dashboard/pulls",
    icon: GitPullRequest,
    label: "Pull Requests",
  },
  {
    href: "/dashboard/repositories",
    icon: FolderGit2,
    label: "Repositories",
  },
];

const CONFIG_NAV = [
  {
    href: "/dashboard/settings",
    icon: Settings,
    label: "Settings",
  },
];

const MOBILE_NAV = [
  {
    href: "/dashboard",
    icon: LayoutDashboard,
    label: "Overview",
  },
  {
    href: "/dashboard/pulls",
    icon: GitPullRequest,
    label: "Pull Requests",
  },
  {
    href: "/dashboard/repositories",
    icon: FolderGit2,
    label: "Repositories",
  },
  {
    href: "/dashboard/settings",
    icon: Settings,
    label: "Settings",
  },
];

export function Sidebar({ session }: { session: Session }) {
  const pathname = usePathname();

  const isActive = (href: string) => {
    return href === "/dashboard"
      ? pathname === "/dashboard"
      : pathname.startsWith(href);
  };

  return (
    <>
      {/* =========================================================
          DESKTOP SIDEBAR
      ========================================================= */}
      <aside className="hidden lg:flex w-60 flex-shrink-0 bg-bg-panel border-r border-bg-border flex-col h-screen sticky top-0">
        {/* Logo */}
        <div className="px-4 py-4 border-b border-bg-border flex items-center gap-2.5">
          <img
            src="/assets/logo.png"
            alt="Lorica"
            className="w-9 h-9 object-contain"
          />

          <span className="font-mono font-semibold text-text-primary text-sm tracking-tight">
            Lorica
          </span>
        </div>

        {/* Navigation */}
        <div className="flex-1 flex flex-col px-2 py-4">
          {/* Workspace */}
          <div>
            <p className="px-3 mb-2 text-[10px] font-mono uppercase tracking-[0.16em] text-text-muted">
              Workspace
            </p>

            <nav className="space-y-0.5">
              {WORKSPACE_NAV.map(
                ({ href, icon: Icon, label }) => {
                  const active = isActive(href);

                  return (
                    <Link
                      key={href}
                      href={href}
                      className={clsx(
                        "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-all duration-100 border",
                        active
                          ? "bg-accent-violet-glow text-accent-violet border-accent-violet/20"
                          : "text-text-secondary hover:bg-bg-hover hover:text-text-primary border-transparent"
                      )}
                    >
                      <Icon
                        size={14}
                        className="flex-shrink-0"
                      />

                      <span className="font-mono text-xs">
                        {label}
                      </span>
                    </Link>
                  );
                }
              )}
            </nav>
          </div>

          {/* Configuration */}
          <div className="mt-7">
            <p className="px-3 mb-2 text-[10px] font-mono uppercase tracking-[0.16em] text-text-muted">
              Configuration
            </p>

            <nav className="space-y-0.5">
              {CONFIG_NAV.map(
                ({ href, icon: Icon, label }) => {
                  const active = isActive(href);

                  return (
                    <Link
                      key={href}
                      href={href}
                      className={clsx(
                        "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-all duration-100 border",
                        active
                          ? "bg-accent-violet-glow text-accent-violet border-accent-violet/20"
                          : "text-text-secondary hover:bg-bg-hover hover:text-text-primary border-transparent"
                      )}
                    >
                      <Icon
                        size={14}
                        className="flex-shrink-0"
                      />

                      <span className="font-mono text-xs">
                        {label}
                      </span>
                    </Link>
                  );
                }
              )}
            </nav>
          </div>

          {/* Bot Status */}
          <div className="mt-auto px-1 pt-6">
            <div className="rounded-lg border border-status-green/15 bg-status-green/5 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <CircleCheck
                  size={13}
                  className="text-status-green flex-shrink-0"
                />

                <span className="text-[10px] font-mono uppercase tracking-wider text-status-green">
                  Bot active
                </span>
              </div>

              <p className="text-[10px] font-mono text-text-muted mt-1.5 pl-5">
                GitHub reviews enabled
              </p>
            </div>
          </div>
        </div>

        {/* User */}
        <div className="border-t border-bg-border p-3">
          <div className="flex items-center gap-2.5 mb-2.5">
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

              <p className="text-[11px] text-text-muted font-mono truncate">
                {(session as any).login ?? session.user?.email}
              </p>
            </div>
          </div>

          <button
            onClick={() =>
              signOut({ callbackUrl: "/" })
            }
            className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-xs text-text-muted hover:text-status-red hover:bg-bg-hover transition-all duration-100 font-mono border border-transparent hover:border-status-red/20"
          >
            <LogOut size={12} />
            Sign out
          </button>
        </div>
      </aside>

      {/* =========================================================
          MOBILE NAVIGATION
      ========================================================= */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-20 border-t border-bg-border bg-bg-panel/95 backdrop-blur px-2 py-2 grid grid-cols-4 gap-1 safe-area-bottom">
        {MOBILE_NAV.map(
          ({ href, icon: Icon, label }) => {
            const active = isActive(href);

            return (
              <Link
                key={href}
                href={href}
                aria-label={label}
                className={clsx(
                  "flex min-h-12 flex-col items-center justify-center gap-1 rounded-lg text-[10px] font-mono transition-colors",
                  active
                    ? "bg-accent-violet-glow text-accent-violet"
                    : "text-text-muted hover:text-text-secondary"
                )}
              >
                <Icon size={16} />
                <span>{label}</span>
              </Link>
            );
          }
        )}
      </nav>
    </>
  );
}