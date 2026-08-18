import "dotenv/config"; // MUST be the first import — before githubRoutes

import crypto from "crypto";
import express from "express";
import cors from "cors";
import githubRoutes from "./routes/github.routes";
import pullRequestRoutes from "./routes/pr.routes";

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

app.use("/api", (req, res, next) => {
  if (!apiAccessToken) {
    return res.status(500).json({ error: "API_ACCESS_TOKEN is not configured" });
  }

  const token = req.header("x-lorica-api-token");
  if (!token || token.length !== apiAccessToken.length) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const isValid = crypto.timingSafeEqual(Buffer.from(token), Buffer.from(apiAccessToken));
  if (!isValid) return res.status(401).json({ error: "Unauthorized" });

  next();
});

app.use("/api/pulls", pullRequestRoutes);
app.use((req, res, next) => {
  console.log(">>>", req.method, req.url);
  next();
});

app.listen(5000, () => {
  console.log("Listening on 5000");
});
