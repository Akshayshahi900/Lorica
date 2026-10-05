import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { serverEnv } from "@/lib/env";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const targets = [
    { name: "api", url: `${serverEnv.apiUrl}/health` },
    ...(serverEnv.workerUrl
      ? [{ name: "worker", url: `${serverEnv.workerUrl}/health` }]
      : []),
  ];

  const results = await Promise.all(
    targets.map(async ({ name, url }) => {
      try {
        const response = await fetch(url, {
          cache: "no-store",
          signal: AbortSignal.timeout(10_000),
        });
        return { service: name, ok: response.ok, status: response.status };
      } catch (error) {
        console.warn(`Dashboard wake request failed for ${name}`, error);
        return { service: name, ok: false };
      }
    }),
  );

  return NextResponse.json({ results });
}
