import type { CodeGraph } from "@lorica/types";
import { execFile } from "child_process";
import { promisify } from "util";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { indexRepository } from "./indexRepository";
import { persistCodeGraph } from "../neo4j";

const execFileAsync = promisify(execFile);

/** Refreshes a branch graph at the exact SHA supplied by a webhook. */
export async function refreshCodeGraph(input: {
  repositoryUrl: string;
  cloneRepositoryUrl?: string;
  branch: string;
  commit: string;
}): Promise<CodeGraph> {
  const repoDir = await mkdtemp(path.join(tmpdir(), "lorica-"));
  let stage = "clone";
  try {
    // Do not log repositoryUrl: for private PRs it can contain an installation token.
    console.info(`[worker] stage=index.clone.started commit=${input.commit}`);
    await execFileAsync("git", [
      "clone",
      "--no-checkout",
      "--depth",
      "1",
      input.cloneRepositoryUrl ?? input.repositoryUrl,
      repoDir,
    ]);
    await execFileAsync(
      "git",
      ["fetch", "--depth", "1", "origin", input.commit],
      { cwd: repoDir },
    );
    await execFileAsync("git", ["checkout", "--detach", "FETCH_HEAD"], {
      cwd: repoDir,
    });

    stage = "index";
    console.info(`[worker] stage=index.checkout.ready commit=${input.commit}`);
    const graph = await indexRepository(
      repoDir,
      input.repositoryUrl,
      input.branch,
      input.commit,
    );
    stage = "neo4j_persist";
    console.info(
      `[worker] stage=neo4j.persist.started nodes=${graph.nodes.length} relationships=${graph.relationships.length} commit=${input.commit}`,
    );
    await persistCodeGraph(graph, {
      repositoryUrl: input.repositoryUrl,
      branch: input.branch,
      commit: input.commit,
    });
    console.info(
      `[worker] stage=neo4j.persist.completed nodes=${graph.nodes.length} relationships=${graph.relationships.length} commit=${input.commit}`,
    );
    return graph;
  } catch (error) {
    const errorType = error instanceof Error ? error.name : "unknown";
    console.error(
      `[worker] stage=index.${stage}.failed commit=${input.commit} error_type=${errorType}`,
    );
    throw error;
  } finally {
    await rm(repoDir, { recursive: true, force: true });
  }
}
