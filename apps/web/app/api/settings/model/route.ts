import { proxyToApi } from "@/lib/api-proxy";

export const dynamic = "force-dynamic";
// Saving runs a test review against the chosen model, which can be slow.
export const maxDuration = 300;

export async function GET() {
  return proxyToApi("/api/settings/model");
}

export async function PUT(request: Request) {
  return proxyToApi("/api/settings/model", {
    method: "PUT",
    body: await request.text(),
  });
}

export async function DELETE() {
  return proxyToApi("/api/settings/model", { method: "DELETE" });
}
