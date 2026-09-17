import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { serverEnv } from "@/lib/env";

export async function GET() {
  const session = await getServerSession(authOptions);
  const login = (session as { login?: string } | null)?.login;

  if (!login) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const response = await fetch(
      `${serverEnv.apiUrl}/api/pulls?owner=${encodeURIComponent(login)}`,
      {
        cache: "no-store",
        headers: serverEnv.apiToken
          ? { "x-lorica-api-token": serverEnv.apiToken }
          : undefined,
      },
    );
    const body = (await response.json().catch(() => null)) ?? {
      error: "The Lorica API returned an invalid response",
    };

    return NextResponse.json(body, { status: response.status });
  } catch (error) {
    console.error("Failed to request pull requests from the Lorica API", error);
    return NextResponse.json(
      { error: "Unable to reach the Lorica API" },
      { status: 502 },
    );
  }
}
