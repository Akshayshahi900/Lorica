import { Request, Response } from "express";
import crypto from "crypto";

function verifySignature(
  payload: Buffer,
  signature: string,
  secret: string,
): boolean {
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", secret).update(payload).digest("hex");

  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (sigBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
}

export const handleWebhook = async (req: Request, res: Response) => {
  // Handle the webhook payload here
  // verify the signature
  //reject if invalid
  console.log("STARTING WEBHOOK HANDLER");
  console.log("Secret:", process.env.WEBHOOK_SECRET);
  const signature = req.headers["x-hub-signature-256"];
  if (typeof signature !== "string") {
    return res.status(401).send("Unauthorized: No signature provided");
  }
  const isValid = verifySignature(
    req.body,
    signature,
    process.env.WEBHOOK_SECRET!,
  );

  if (!isValid) {
    return res.status(401).send("Invalid Signature");
  }
  // signature is valid , now parse the JSON
  const payload = JSON.parse(req.body.toString("utf-8"));
  const event = req.header("X-Github-Event");

  if(event !== "pull_request"){
    return res.status(200).send("Ignoring non pull_request event");
  }
  const action = payload.action;
  if(action !== "opened" && action !== "reopened" && action !== "synchronize"){
    return res.status(200).send("Ignoring non opened/reopened/synchronize action");
  }
console.log(`Processing PR ${action}`);
console.log(payload.pull_request.title);
    res.status(200).send("Webhook received");
};
