import {
  ReviewContextSchema,
  type ChangedFile,
  type GraphTrace,
  type PrMetadata,
  type ReviewContext,
} from "../../types/src/types";

/**
 * Produces the single review input contract. Keeping this pure means graph and
 * GitHub adapters cannot accidentally leak unvalidated data into the prompt.
 */
export function assembleReviewContext(input: {
  pullRequest: PrMetadata;
  changedFiles: ChangedFile[];
  indexedCommit: string;
  traces: GraphTrace[];
  unavailableReason?: string;
}): ReviewContext {
  return ReviewContextSchema.parse({
    schemaVersion: "1",
    pullRequest: input.pullRequest,
    changedFiles: input.changedFiles,
    graph: {
      indexedCommit: input.indexedCommit,
      traces: input.traces,
      ...(input.unavailableReason
        ? { unavailableReason: input.unavailableReason }
        : {}),
    },
  });
}
