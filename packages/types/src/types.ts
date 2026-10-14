import { z } from "zod";

export const ReviewFindingSchema = z.object({
  filePath: z.string(),
  lineNumber: z.number().int(),

  code: z.string(),

  severity: z.enum(["critical", "high", "medium", "low"]),

  category: z.enum([
    "bug",
    "security",
    "performance",
    "correctness",
    "maintainability",
    // A violation of the team's coding guidelines.
    "standards",
  ]),

  comment: z.string(),

  suggestion: z.string().optional(),
});

/** Something to do once the PR is merged, such as running a migration. */
export const PostMergeActionSchema = z.object({
  category: z.enum([
    "deployment",
    "database",
    "configuration",
    "monitoring",
    "documentation",
    "follow_up",
  ]),
  action: z.string(),
  reason: z.string(),
});

export const ReviewResultSchema = z.object({
  summary: z.string(),
  reviews: z.array(ReviewFindingSchema),
  postMergeActions: z.array(PostMergeActionSchema).optional(),
});

export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;
export type PostMergeAction = z.infer<typeof PostMergeActionSchema>;
export type ReviewResult = z.infer<typeof ReviewResultSchema>;

/** The versioned, evidence-only request sent to the review model. */
export const PrMetadataSchema = z.object({
  repository: z.string().min(1),
  number: z.number().int().positive(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  author: z.string().nullable(),
  baseSha: z.string().min(1),
  headSha: z.string().min(1),
  event: z.enum(["fresh", "synchronize"]),
});

export const ChangedFileSchema = z.object({
  filePath: z.string().min(1),
  status: z.enum(["added", "modified", "removed", "renamed", "changed"]),
  patch: z.string().min(1),
});

export const GraphTraceSchema = z.object({
  changedFile: z.string(),
  symbol: z.string().nullable(),
  direction: z.enum(["depends_on", "depended_on_by"]),
  relationship: z.enum(["IMPORTS", "CALLS", "EXTENDS", "IMPLEMENTS", "USES"]),
  relatedFile: z.string().nullable(),
  relatedSymbol: z.string().nullable(),
  evidence: z.string(),
});

export const ReviewContextSchema = z.object({
  schemaVersion: z.literal("1"),
  pullRequest: PrMetadataSchema,
  changedFiles: z.array(ChangedFileSchema),
  graph: z.object({
    indexedCommit: z.string().min(1),
    traces: z.array(GraphTraceSchema),
    unavailableReason: z.string().optional(),
  }),
});

export type PrMetadata = z.infer<typeof PrMetadataSchema>;
export type ChangedFile = z.infer<typeof ChangedFileSchema>;
export type GraphTrace = z.infer<typeof GraphTraceSchema>;
export type ReviewContext = z.infer<typeof ReviewContextSchema>;

export interface CloneRepoJob {
  reviewId: string;
  repositoryUrl: string;
  commit: string;
  commitSha: string;
  baseCommitSha?: string;
  branch: string;
}

export type ReviewJobPayload = {
  reviewJobId: number;
};

export type NodeType =
  | "Repository"
  | "File"
  | "Class"
  | "Interface"
  | "Function"
  | "Method"
  | "Variable"
  | "ExternalModule";

export type RelationshipType =
  | "CONTAINS"
  | "DEFINES"
  | "IMPORTS"
  | "CALLS"
  | "EXTENDS"
  | "IMPLEMENTS"
  | "USES";

export interface GraphNode {
  id: string;
  type: NodeType;

  properties: {
    name?: string;
    path?: string;
    language?: string;
    startLine?: number;
    endLine?: number;
    startColumn?: number;
    endColumn?: number;
  };
}

export interface GraphRelationship {
  from: string;
  type: RelationshipType;
  to: string;
}

export interface CodeGraph {
  nodes: GraphNode[];
  relationships: GraphRelationship[];
}
