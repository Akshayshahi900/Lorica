import neo4j from "neo4j-driver";
import type { CodeGraph } from "@lorica/types";

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
