import { Queue, QueueEvents } from "bullmq";
import { connection } from "@lorica/queue";
import type { CloneRepoJob, CodeGraph } from "@lorica/types";
import path from "path";
import { pathToFileURL } from "url";
import { mkdir, writeFile } from "fs/promises";

type IndexResult = {
  success: boolean;
  graph: CodeGraph;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function validateGraph(graph: CodeGraph): void {
  assert(graph.nodes.length > 0, "The indexer returned no graph nodes");
  assert(
    graph.nodes.some((node) => node.type === "File"),
    "The indexer returned no source-file nodes",
  );

  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  assert(nodeIds.size === graph.nodes.length, "The graph contains duplicate node IDs");
  assert(
    graph.relationships.every(
      (relationship) => nodeIds.has(relationship.from) && nodeIds.has(relationship.to),
    ),
    "The graph contains a relationship with a missing node",
  );
}

async function main() {
  // A dedicated queue prevents a separately running `pnpm dev` worker from
  // consuming this test job.
  const queueName = `code-index-smoke-${process.pid}`;
  // The smoke test is intentionally verbose. Set LOG_INDEX_DETAILS=false to
  // suppress per-file output, or LOG_INDEX_AST=true to print raw Tree-sitter ASTs.
  process.env.LOG_INDEX_DETAILS ??= "true";
  process.env.INDEX_QUEUE_NAME = queueName;
  const { indexWorker } = await import("./codeIndex.worker.js");
  const localRepositoryUrl = pathToFileURL(
    path.resolve(process.env.LORICA_ROOT ?? process.cwd()),
  ).href;
  const repositoryUrl =
    process.env.INDEX_TEST_REPOSITORY_URL ??
    localRepositoryUrl;
  const branch = process.env.INDEX_TEST_BRANCH ?? "main";
  const queue = new Queue<CloneRepoJob>(queueName, { connection });
  const events = new QueueEvents(queueName, { connection });

  try {
    await indexWorker.waitUntilReady();
    await events.waitUntilReady();

    const job = await queue.add("index-repository", {
      reviewId: "index-worker-smoke-test",
      repositoryUrl,
      branch,
      commit: "",
      commitSha: "",
    });
    console.log(`Created index job: ${job.id}`);

    const result = (await job.waitUntilFinished(events, 120_000)) as IndexResult;
    assert(result.success, "The index worker did not report success");
    validateGraph(result.graph);

    const artifactsDirectory = path.resolve(
      process.env.LORICA_ROOT ?? process.cwd(),
      "apps/worker/.artifacts",
    );
    const graphPath = path.join(artifactsDirectory, "index-graph.json");
    await mkdir(artifactsDirectory, { recursive: true });
    await writeFile(graphPath, `${JSON.stringify(result.graph, null, 2)}\n`);

    console.log(
      `Index smoke test passed: ${result.graph.nodes.length} nodes, ` +
        `${result.graph.relationships.length} relationships.`,
    );
    console.log(`Graph artifact written to ${graphPath}`);
  } finally {
    await events.close();
    await indexWorker.close();
    await queue.close();
    await connection.quit();
  }
}

main().catch((error) => {
  console.error("Index smoke test failed:", error);
  process.exitCode = 1;
});
