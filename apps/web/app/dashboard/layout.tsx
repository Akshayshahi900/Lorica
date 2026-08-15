"use client";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Sidebar } from "@/components/Sidebar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") router.push("/");
  }, [status, router]);

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-bg-base flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-accent-violet border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!session) return null;

  return (
    <div className="min-h-screen bg-bg-base flex">
      <Sidebar session={session} />
      <main className="flex-1 min-w-0 overflow-auto">{children}</main>
    </div>
  );
}
