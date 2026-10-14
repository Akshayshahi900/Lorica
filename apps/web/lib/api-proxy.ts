import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { serverEnv } from "@/lib/env";

/**
 * Forwards a dashboard request to the Lorica API on behalf of the signed-in
 * user. The owner is the session's GitHub login unless the route passes an
 * `owner` it has already authorized (see authorizeSettingsOwner); it is never
 * taken from client input unchecked.
 */
export async function proxyToApi(
  path: string,
  {
    method = "GET",
    body,
    owner,
  }: { method?: string; body?: string; owner?: string } = {},
): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  const login = (session as { login?: string } | null)?.login;

  if (!login) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const query = new URLSearchParams({ owner: owner ?? login, actor: login });
  try {
    const response = await fetch(
      `${serverEnv.apiUrl}${path}?${query}`,
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
