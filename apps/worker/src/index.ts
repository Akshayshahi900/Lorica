import "dotenv/config";
import './codeIndex.worker';
import './diff.worker';
import express from "express";

const health = express();
health.get("/health", (_req, res) => res.send("OK"));
health.listen(process.env.PORT || 10000, () => {
  console.log("worker health endpoint listening");
});
console.log('[lorica:worker] All workers booted, waiting for jobs...');

process.on('SIGTERM', () => {
  console.log('[lorica:worker] Shutting down gracefully');
  process.exit(0);
});
