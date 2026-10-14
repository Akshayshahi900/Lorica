import "dotenv/config";
import { connection } from "@lorica/queue";
import { Worker, Job } from "bullmq";
import { ReviewJobPayload } from "@lorica/types";
import { processReview } from "./reviewProcessor";

export const reviewWorker = new Worker<ReviewJobPayload>(
  "review",
  async (job: Job<ReviewJobPayload>) => processReview(job.data.reviewJobId),
  {
    connection,
    concurrency: 2,
  },
);

reviewWorker.on("completed", (job: Job<ReviewJobPayload>) => {
  console.info(`[worker] stage=review.queue_job.completed job=${job.id}`);
});

// Without a listener, an 'error' event during a Redis outage crashes the process.
reviewWorker.on("error", (error: Error) => {
  console.error(`[worker] stage=review.queue.error error_type=${error.name}`);
});

console.info("[worker] stage=review.worker.ready queue=review");
