import neo4j from "neo4j-driver";
import type { CodeGraph, GraphTrace } from "@lorica/types";

const PERSISTED_RELATIONSHIP_TYPES = [
  "DEFINES",
  "IMPORTS",
  "CALLS",
  "EXTENDS",
  "IMPLEMENTS",
  "USES",
] as const;

type GraphMetadata = {
  repositoryUrl: string;
  branch: string;
  commit: string;
};

function getNeo4jConfig() {
  const uri = process.env.NEO4J_URI;
  const user = process.env.NEO4J_USER;
  const password = process.env.NEO4J_PASSWORD;

  if (!uri || !user || !password) {
    throw new Error(
      "Neo4j is not configured. Set NEO4J_URI, NEO4J_USER, and NEO4J_PASSWORD.",
    );
  }

  return { uri, user, password };
}

export async function persistCodeGraph(
  graph: CodeGraph,
  metadata: GraphMetadata,
): Promise<void> {
  const { uri, user, password } = getNeo4jConfig();
  const repositoryKey = `${metadata.repositoryUrl}#${metadata.branch || "default"}`;
  const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  const session = driver.session();

  try {
    await driver.verifyConnectivity();

    await session.executeWrite(async (transaction) => {
      // Re-indexing replaces only this repository/branch's previous graph.
      await transaction.run(
        `MATCH (node:CodeGraphNode { repositoryKey: $repositoryKey })
         DETACH DELETE node`,
        { repositoryKey },
      );

      await transaction.run(
        `MERGE (repository:Repository { key: $repositoryKey })
         SET repository.url = $repositoryUrl,
             repository.branch = $branch,
             repository.commit = $commit,
             repository.indexedAt = datetime()`,
        { repositoryKey, ...metadata },
      );

      await transaction.run(
        `UNWIND $nodes AS row
         MATCH (repository:Repository { key: $repositoryKey })
         MERGE (node:CodeGraphNode { repositoryKey: $repositoryKey, id: row.id })
         SET node.kind = row.type
         SET node += row.properties
         WITH repository, node, row
         WHERE row.type = "File"
         MERGE (repository)-[:CONTAINS]->(node)`,
        { repositoryKey, nodes: graph.nodes },
      );

      for (const type of PERSISTED_RELATIONSHIP_TYPES) {
        const relationships = graph.relationships.filter(
          (relationship) => relationship.type === type,
        );
        if (!relationships.length) continue;
        await transaction.run(
          `UNWIND $relationships AS row
           MATCH (source:CodeGraphNode { repositoryKey: $repositoryKey, id: row.from })
           MATCH (target:CodeGraphNode { repositoryKey: $repositoryKey, id: row.to })
           MERGE (source)-[:${type}]->(target)`,
          { repositoryKey, relationships },
        );
      }
    });
  } finally {
    await session.close();
    await driver.close();
  }
}

/**
 * Retrieves only one-hop, typed evidence connected to changed files/symbols.
 * This deliberately avoids serializing the whole repository into the prompt.
 */
export async function getReviewGraphContext(input: {
  repositoryUrl: string;
  branch: string;
  changedFiles: string[];
}): Promise<{ indexedCommit: string; traces: GraphTrace[] }> {
  const { uri, user, password } = getNeo4jConfig();
  const repositoryKey = `${input.repositoryUrl}#${input.branch || "default"}`;
  const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  const session = driver.session({ defaultAccessMode: neo4j.session.READ });

  try {
    await driver.verifyConnectivity();
    const repository = await session.run(
      `MATCH (repository:Repository { key: $repositoryKey })
       RETURN repository.commit AS commit`,
      { repositoryKey },
    );
    const indexedCommit = repository.records[0]?.get("commit");
    if (typeof indexedCommit !== "string") {
      throw new Error(`No code graph is indexed for ${repositoryKey}`);
    }

    const result = await session.run(
      `UNWIND $changedFiles AS path
       MATCH (changed:CodeGraphNode { repositoryKey: $repositoryKey, path: path })
       MATCH (changed)-[rel:IMPORTS|CALLS|EXTENDS|IMPLEMENTS|USES]-(related:CodeGraphNode { repositoryKey: $repositoryKey })
       RETURN changed.path AS changedFile,
              changed.name AS changedSymbol,
              related.path AS relatedFile,
              related.name AS relatedSymbol,
              type(rel) AS relationship,
              startNode(rel).id = changed.id AS outgoing
       LIMIT 250`,
      { repositoryKey, changedFiles: input.changedFiles },
    );

    const traces = result.records.map((record) => {
      const relationship = record.get("relationship") as GraphTrace["relationship"];
      const changedFile = record.get("changedFile") as string;
      const relatedFile = record.get("relatedFile") as string | null;
      const relatedSymbol = record.get("relatedSymbol") as string | null;
      const outgoing = record.get("outgoing") as boolean;
      return {
        changedFile,
        symbol: (record.get("changedSymbol") as string | null) ?? null,
        direction: outgoing ? "depends_on" : "depended_on_by",
        relationship,
        relatedFile: relatedFile ?? null,
        relatedSymbol: relatedSymbol ?? null,
        evidence: `${changedFile} ${outgoing ? "uses" : "is used by"} ${relatedSymbol ?? relatedFile ?? "an indexed node"} via ${relationship}`,
      } satisfies GraphTrace;
    });

    return { indexedCommit, traces };
  } finally {
    await session.close();
    await driver.close();
  }
}
