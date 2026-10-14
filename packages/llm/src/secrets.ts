import crypto from "node:crypto";

const VERSION = "v1";

function encryptionKey(env: Record<string, string | undefined>): Buffer {
  const secret = env.LLM_SETTINGS_ENCRYPTION_KEY?.trim();
  if (!secret) {
    throw new Error(
      "LLM_SETTINGS_ENCRYPTION_KEY is not set; it is required to store model API keys",
    );
  }
  // Any high-entropy string works (e.g. `openssl rand -base64 32`).
  return crypto.createHash("sha256").update(secret).digest();
}

/** Encrypts a user's model API key for storage (AES-256-GCM). */
export function encryptSecret(
  plaintext: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(env), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), ciphertext]
    .map((part) => (typeof part === "string" ? part : part.toString("base64")))
    .join(":");
}

export function decryptSecret(
  stored: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const [version, iv, tag, ciphertext] = stored.split(":");
  if (version !== VERSION || !iv || !tag || !ciphertext) {
    throw new Error("Stored API key has an unknown format");
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(env),
    Buffer.from(iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
