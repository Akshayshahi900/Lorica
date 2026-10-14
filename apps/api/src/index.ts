import "dotenv/config"; // MUST be the first import — before githubRoutes

import crypto from "crypto";
import express from "express";
import cors from "cors";
import githubRoutes from "./routes/github.routes";
import pullRequestRoutes from "./routes/pr.routes";
import { reconcile } from "./reconcile";

const app = express();

const webOrigins = (process.env.WEB_ORIGIN ?? "http://localhost:3001")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({ origin: webOrigins }));

app.use("/webhooks", express.raw({ type: "application/json" }), githubRoutes);
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Home");
});
app.get("/health", (req, res) => {
  res.send("OK");
});

const apiAccessToken = process.env.API_ACCESS_TOKEN;
const isProduction = process.env.NODE_ENV === "production";

app.use("/api", (req, res, next) => {
  if (!apiAccessToken) {
    if (isProduction) {
      return res
        .status(503)
        .json({ error: "API_ACCESS_TOKEN is not configured" });
    }

    // The dashboard proxy is the only local consumer. Requiring an unconfigured
    // shared secret made every local dashboard request fail before the route ran.
    return next();
  }

  const token = req.header("x-lorica-api-token");
  if (!token || token.length !== apiAccessToken.length) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const isValid = crypto.timingSafeEqual(
    Buffer.from(token),
    Buffer.from(apiAccessToken),
  );
  if (!isValid) return res.status(401).json({ error: "Unauthorized" });

  next();
});

app.use("/api/pulls", pullRequestRoutes);

// Called by the scheduled reconcile workflow so missed webhooks are recovered
// even when nothing else wakes the API.
app.post("/api/internal/reconcile", async (_req, res) => {
  res.json(await reconcile());
});

const port = Number(process.env.PORT ?? 5000);

app.listen(port, () => {
  console.info(`[api] stage=server.ready port=${port}`);
  // A boot often means the API was asleep and may have missed deliveries.
  setTimeout(() => void reconcile(), 30_000);
});
