import { CloneRepoJob } from "@lorica/types";
import { Worker, Job } from "bullmq";
import { connection } from "@lorica/queue";
import { indexRepository } from "./indexer/indexRepository";
import { refreshCodeGraph } from "./indexer/refreshCodeGraph";

const indexQueueName = process.env.INDEX_QUEUE_NAME ?? "code-index";

export const indexWorker = new Worker(
  indexQueueName,
  async (job: Job<CloneRepoJob>) => {
    const { repositoryUrl, branch, commit } = job.data;
    return refreshCodeGraph({ repositoryUrl, branch, commit });
  },
  {
    connection,
    concurrency: 2,
    limiter: {
      max: 5,
      duration: 60_000,
    },
  },
);

// Without a listener, an 'error' event during a Redis outage crashes the process.
indexWorker.on("error", (error: Error) => {
  console.error(`[worker] stage=index.queue.error error_type=${error.name}`);
});

export { indexRepository, refreshCodeGraph };
