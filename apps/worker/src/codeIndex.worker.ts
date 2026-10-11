import { CloneRepoJob, CodeGraph } from "@lorica/types";
import { Worker, Job } from "bullmq";
import { connection } from "@lorica/queue";
import { execFile } from "child_process";
import { promisify } from "util";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { indexRepository } from "./indexer/indexRepository";
import { persistCodeGraph } from "./neo4j";

const execFileAsync = promisify(execFile);
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

/** Refreshes a branch graph at the exact SHA supplied by a webhook. */
export async function refreshCodeGraph(input: {
  repositoryUrl: string;
  cloneRepositoryUrl?: string;
  branch: string;
  commit: string;
}): Promise<CodeGraph> {
  const repoDir = await mkdtemp(path.join(tmpdir(), "lorica-"));
  try {
    // Do not log repositoryUrl: for private PRs it can contain an installation token.
    console.log(`Cloning repository at ${input.commit}`);
    await execFileAsync("git", ["clone", "--no-checkout", "--depth", "1", input.cloneRepositoryUrl ?? input.repositoryUrl, repoDir]);
    await execFileAsync("git", ["fetch", "--depth", "1", "origin", input.commit], { cwd: repoDir });
    await execFileAsync("git", ["checkout", "--detach", "FETCH_HEAD"], { cwd: repoDir });

    const graph = await indexRepository(repoDir, input.repositoryUrl, input.branch, input.commit);
    await persistCodeGraph(graph, {
      repositoryUrl: input.repositoryUrl,
      branch: input.branch,
      commit: input.commit,
    });
    console.log(`Graph saved to Neo4j at ${input.commit}`);
    return graph;
  } finally {
    await rm(repoDir, { recursive: true, force: true });
  }
}

export { indexRepository };
