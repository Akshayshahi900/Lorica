import { proxyToApi } from "@/lib/api-proxy";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  return proxyToApi("/api/settings/model/check", {
    method: "POST",
    body: await request.text(),
  });
}
