const WAKE_TIMEOUT_MS = 60_000;

// Render free-tier services spin down after inactivity, and a sleeping worker
// never picks the review job off the queue. Hitting its public /health endpoint
// starts it booting while the webhook is still being persisted.
export function wakeWorker() {
  const workerUrl = process.env.LORICA_WORKER_URL?.trim().replace(/\/+$/, "");
  if (!workerUrl) return;

  const startedAt = Date.now();
  fetch(`${workerUrl}/health`, {
    cache: "no-store",
    signal: AbortSignal.timeout(WAKE_TIMEOUT_MS),
  })
    .then((response) => {
      console.info(
        `[api] stage=worker_wake.completed status=${response.status} duration_ms=${Date.now() - startedAt}`,
      );
    })
    .catch((error) => {
      const errorType = error instanceof Error ? error.name : "unknown";
      console.warn(
        `[api] stage=worker_wake.failed error_type=${errorType} duration_ms=${Date.now() - startedAt}`,
      );
    });
}
