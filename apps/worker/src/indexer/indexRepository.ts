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
  const logDetails = process.env.LOG_INDEX_DETAILS === "true";
  const logAst = process.env.LOG_INDEX_AST === "true";
  const parsedFiles: ParsedFile[] = [];
  console.log(`Found ${files.length} source files`);
  for (const filePath of files) {
    const source = await readFile(filePath, "utf-8");
    const tree = parseTypeScript(source);
    const relativePath = path.relative(repoDir, filePath);
    parsedFiles.push({ relativePath, tree });

    if (logAst) console.log(`\n[ast] ${relativePath}\n${tree.rootNode.toString()}`);
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
  if (process.env.LOG_CODE_GRAPH === "true") console.dir(graph, { depth: null });
  return graph;
}
