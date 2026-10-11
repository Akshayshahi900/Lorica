import type { CodeGraph } from "@lorica/types";
import { readFile } from "fs/promises";
import path from "path";
import { discoverSourceFiles } from "./discoverFiles";
import { parseTypeScript } from "./parser";
import { extractFile } from "./extractFile";
import { extractRelationships, type ParsedFile } from "./relationships";

/** Builds the code graph from a checked-out repository tree. */
export async function indexRepository(
  repoDir: string,
  _repositoryUrl: string,
  _branch: string,
  _commit: string,
): Promise<CodeGraph> {
  const files = await discoverSourceFiles(repoDir);
  const graph: CodeGraph = { nodes: [], relationships: [] };
  const parsedFiles: ParsedFile[] = [];
  console.info(`[worker] stage=index.parse.started files=${files.length}`);
  for (const filePath of files) {
    const source = await readFile(filePath, "utf-8");
    const tree = parseTypeScript(source);
    const relativePath = path.relative(repoDir, filePath);
    parsedFiles.push({ relativePath, tree });

    const fileGraph = extractFile(tree, relativePath);
    graph.nodes.push(...fileGraph.nodes);
    graph.relationships.push(...fileGraph.relationships);
  }
  extractRelationships(graph, parsedFiles);
  console.info(
    `[worker] stage=index.parse.completed files=${files.length} nodes=${graph.nodes.length} relationships=${graph.relationships.length}`,
  );
  return graph;
}
