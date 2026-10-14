"use client";
import { useSession } from "next-auth/react";
import { signOut } from "next-auth/react";
import Image from "next/image";
import { LogOut } from "lucide-react";
import ModelSettings from "@/components/ModelSettings";
import ReviewSettings from "@/components/ReviewSettings";

export default function SettingsPage() {
  const { data: session } = useSession();

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-text-primary">Settings</h1>
        <p className="text-xs text-text-muted font-mono mt-0.5">
          Account and bot configuration
        </p>
      </div>

      {/* Account */}
      <div className="bg-bg-panel border border-bg-border rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-text-primary">Account</h2>
        <div className="flex items-center gap-3">
          {session?.user?.image && (
            <Image
              src={session.user.image}
              alt={session.user.name ?? "User"}
              width={40}
              height={40}
              className="rounded-full ring-2 ring-bg-border"
            />
          )}
          <div>
            <p className="text-sm font-medium text-text-primary">
              {session?.user?.name}
            </p>
            <p className="text-xs font-mono text-text-muted">
              @{(session as any)?.login ?? session?.user?.email}
            </p>
          </div>
        </div>
        <button
          onClick={() => signOut({ callbackUrl: "/" })}
          className="flex items-center gap-2 px-4 py-2 text-xs font-mono text-status-red border border-status-red/20 bg-status-red/5 rounded-lg hover:bg-status-red/10 transition-colors"
        >
          <LogOut size={12} />
          Sign out
        </button>
      </div>

      <ModelSettings />

      <ReviewSettings />

      {/* Danger zone */}
      <div className="bg-bg-panel border border-status-red/20 rounded-xl p-5 space-y-3">
        <h2 className="text-sm font-semibold text-status-red">Danger zone</h2>
        <p className="text-xs text-text-secondary">
          Deleting your account removes all review history and uninstalls the bot
          from all repositories.
        </p>
        <button className="px-4 py-2 text-xs font-mono text-status-red border border-status-red/30 rounded-lg hover:bg-status-red/10 transition-colors">
          Delete account
        </button>
      </div>
    </div>
  );
}
