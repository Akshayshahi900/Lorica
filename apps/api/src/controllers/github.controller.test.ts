import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { verifySignature } from "./webhookSignature";

describe("GitHub webhook signature verification", () => {
  const body = Buffer.from('{"action":"opened"}');
  const secret = "test-webhook-secret";
  const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

  it("accepts the HMAC for the exact raw request body", () => {
    assert.equal(verifySignature(body, signature, secret), true);
  });

  it("rejects a changed body, secret, malformed signature, or wrong prefix", () => {
    assert.equal(verifySignature(Buffer.from(`${body} `), signature, secret), false);
    assert.equal(verifySignature(body, signature, "wrong-secret"), false);
    assert.equal(verifySignature(body, "sha1=" + signature.slice(7), secret), false);
    assert.equal(verifySignature(body, "sha256=bad", secret), false);
  });
});
