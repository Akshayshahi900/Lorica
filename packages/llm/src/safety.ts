import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 6) {
    const lower = address.toLowerCase();
    if (lower.startsWith("::ffff:")) return isPrivateAddress(lower.slice(7));
    return (
      lower === "::" ||
      lower === "::1" ||
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      lower.startsWith("fe80")
    );
  }
  const [a, b] = address.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b! >= 64 && b! <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, including cloud metadata
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && b === 168)
  );
}

/**
 * The worker sends requests to whatever base URL a user saves. In production
 * that must not become a way to reach the worker's own network (databases,
 * cloud metadata), so private addresses are refused unless the operator opts
 * in with LLM_ALLOW_PRIVATE_BASE_URLS=true (e.g. Ollama on the same host).
 */
export async function assertSafeBaseUrl(
  baseUrl: string,
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error("Base URL must be an absolute URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Base URL must use http or https");
  }
  if (url.username || url.password) {
    throw new Error("Base URL must not contain credentials; use the API key field");
  }

  const allowPrivate =
    env.LLM_ALLOW_PRIVATE_BASE_URLS === "true" ||
    (env.LLM_ALLOW_PRIVATE_BASE_URLS !== "false" && env.NODE_ENV !== "production");
  if (allowPrivate) return;

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(hostname)
    ? [hostname]
    : (await lookup(hostname, { all: true })).map((entry) => entry.address);
  if (addresses.some(isPrivateAddress)) {
    throw new Error(
      "Base URL resolves to a private network address. Set LLM_ALLOW_PRIVATE_BASE_URLS=true on the API and worker to allow local models.",
    );
  }
}
