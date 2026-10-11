import "dotenv/config";
import "./codeIndex.worker";
import "./diff.worker";
import express from "express";

const health = express();
health.get("/health", (_req, res) => res.send("OK"));
health.listen(process.env.PORT || 10000, () => {
  console.info(
    `[worker] stage=health_server.ready port=${process.env.PORT || 10000}`,
  );
});
console.info("[worker] stage=workers.ready");

process.on("SIGTERM", () => {
  console.info("[worker] stage=shutdown.started signal=SIGTERM");
  process.exit(0);
});
