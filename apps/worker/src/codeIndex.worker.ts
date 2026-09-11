import { CloneRepoJob, CodeGraph } from "@lorica/types";
import { Worker, Job } from "bullmq";
import { connection } from "@lorica/queue";
import { execFile } from "child_process";
import { promisify } from "util";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { discoverSourceFiles } from "./indexer/discoverFiles";
import { parseTypeScript } from "./indexer/parser";
import { extractFile } from "./indexer/extractFile";
import { extractRelationships, type ParsedFile } from "./indexer/relationships";
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

export async function indexRepository(
  repoDir: string,
  repositoryUrl: string,
  branch: string,
  commit: string,
): Promise<CodeGraph> {
  // discover all files
  const files = await discoverSourceFiles(repoDir);

  const graph: CodeGraph = {
    nodes: [],
    relationships: [],
  };
  const logDetails = process.env.LOG_INDEX_DETAILS === "true";
  const logAst = process.env.LOG_INDEX_AST === "true";
  const parsedFiles: ParsedFile[] = [];
  console.log(`Found ${files.length} source files`);
  for (const filePath of files) {
    const source = await readFile(filePath, "utf-8");

    const tree = parseTypeScript(source);
    const relativePath = path.relative(repoDir, filePath);
    parsedFiles.push({ relativePath, tree });

    if (logAst) {
      console.log(`\n[ast] ${relativePath}\n${tree.rootNode.toString()}`);
    }

    const fileGraph = extractFile(tree, relativePath);

    if (logDetails) {
      const symbols = fileGraph.nodes
        .filter((node) => node.type !== "File")
        .map((node) => `${node.type}:${node.properties.name ?? node.id}`);
      console.log(
        `[index] ${relativePath} | read + parsed | ` +
          `${fileGraph.nodes.length} nodes, ${fileGraph.relationships.length} relationships` +
          (symbols.length ? ` | ${symbols.join(", ")}` : ""),
      );
    }

    graph.nodes.push(...fileGraph.nodes);
    graph.relationships.push(...fileGraph.relationships);
  }

  extractRelationships(graph, parsedFiles);

  console.log(`Nodes: ${graph.nodes.length}`);
  console.log(`Relationships: ${graph.relationships.length}`);

  if (process.env.LOG_CODE_GRAPH === "true") {
    console.dir(graph, { depth: null });
  }

  return graph;
}
