import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

// NEXT_PUBLIC_API_URL is kept as a backwards-compatible local-development
// setting. LORICA_API_URL is preferred because this value is only needed on
// the server.
const apiBaseUrl =
  process.env.LORICA_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:5000";
const apiAccessToken = process.env.LORICA_API_TOKEN;

export async function GET() {
  const session = await getServerSession(authOptions);
  const login = (session as { login?: string } | null)?.login;

  if (!login) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const response = await fetch(
      `${apiBaseUrl.replace(/\/$/, "")}/api/pulls?owner=${encodeURIComponent(login)}`,
      {
        cache: "no-store",
        // Local development can run without API_ACCESS_TOKEN. Production
        // validates that configuration in the API service.
        headers: apiAccessToken
          ? { "x-lorica-api-token": apiAccessToken }
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
