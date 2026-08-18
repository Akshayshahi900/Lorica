import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

const apiBaseUrl = process.env.LORICA_API_URL ?? process.env.NEXT_PUBLIC_API_URL;
const apiAccessToken = process.env.LORICA_API_TOKEN;

export async function GET() {
  const session = await getServerSession(authOptions);
  const login = (session as { login?: string } | null)?.login;

  if (!login) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!apiBaseUrl) {
    return NextResponse.json(
      { error: "The Lorica API URL is not configured" },
      { status: 500 },
    );
  }

  if (!apiAccessToken) {
    return NextResponse.json(
      { error: "The Lorica API token is not configured" },
      { status: 500 },
    );
  }

  try {
    const response = await fetch(
      `${apiBaseUrl.replace(/\/$/, "")}/api/pulls?owner=${encodeURIComponent(login)}`,
      {
        cache: "no-store",
        headers: { "x-lorica-api-token": apiAccessToken },
      },
    );
    const body = await response.json();

    return NextResponse.json(body, { status: response.status });
  } catch (error) {
    console.error("Failed to request pull requests from the Lorica API", error);
    return NextResponse.json(
      { error: "Unable to reach the Lorica API" },
      { status: 502 },
    );
  }
}
