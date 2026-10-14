import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { authorizeSettingsOwner } from "@/lib/accounts";
import { proxyToApi } from "@/lib/api-proxy";

export const dynamic = "force-dynamic";

/** `?account=` picks an organisation; only its admins get through. */
async function withOwner(
  request: Request,
  forward: (owner: string) => Promise<NextResponse>,
): Promise<NextResponse> {
  const session = await getServerSession(authOptions);
  const requested = new URL(request.url).searchParams.get("account");
  const owner = await authorizeSettingsOwner(session, requested);
  if (!owner) {
    return NextResponse.json(
      { error: requested ? `You are not an admin of ${requested}` : "Unauthorized" },
      { status: requested ? 403 : 401 },
    );
  }
  return forward(owner);
}

export async function GET(request: Request) {
  return withOwner(request, (owner) =>
    proxyToApi("/api/settings/review", { owner }),
  );
}

export async function PUT(request: Request) {
  const body = await request.text();
  return withOwner(request, (owner) =>
    proxyToApi("/api/settings/review", { method: "PUT", body, owner }),
  );
}

export async function DELETE(request: Request) {
  return withOwner(request, (owner) =>
    proxyToApi("/api/settings/review", { method: "DELETE", owner }),
  );
}
