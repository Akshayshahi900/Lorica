import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { serverEnv } from "@/lib/env";

/**
 * Forwards a dashboard request to the Lorica API on behalf of the signed-in
 * user. The owner is always the session's GitHub login, never client input.
 */
export async function proxyToApi(
  path: string,
  { method = "GET", body }: { method?: string; body?: string } = {},
): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  const login = (session as { login?: string } | null)?.login;

  if (!login) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const response = await fetch(
      `${serverEnv.apiUrl}${path}?owner=${encodeURIComponent(login)}`,
      {
        method,
        body,
        cache: "no-store",
        headers: {
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(serverEnv.apiToken ? { "x-lorica-api-token": serverEnv.apiToken } : {}),
        },
      },
    );
    const payload = (await response.json().catch(() => null)) ?? {
      error: "The Lorica API returned an invalid response",
    };

    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    console.error(`Failed to request ${path} from the Lorica API`, error);
    return NextResponse.json(
      { error: "Unable to reach the Lorica API" },
      { status: 502 },
    );
  }
}
