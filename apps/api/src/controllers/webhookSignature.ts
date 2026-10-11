import crypto from "crypto";

export function verifySignature(
  payload: Buffer,
  signature: string,
  secret: string,
): boolean {
  const expected =
    "sha256=" + crypto.createHmac("sha256", secret).update(payload).digest("hex");
  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (sigBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
}
