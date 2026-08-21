import { z } from "zod";

export const ReviewFindingSchema = z.object({
  filePath: z.string(),
  lineNumber: z.number().int(),

  code: z.string(),

  severity: z.enum([
    "critical",
    "high",
    "medium",
    "low",
  ]),

  category: z.enum([
    "bug",
    "security",
    "performance",
    "correctness",
    "maintainability",
  ]),

  comment: z.string(),

  suggestion: z.string().optional(),
});

export const ReviewResultSchema = z.object({
  summary: z.string(),
  reviews: z.array(ReviewFindingSchema),
});

export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;
export type ReviewResult = z.infer<typeof ReviewResultSchema>;

export interface CloneRepoJob {
  reviewId: string;
  repositoryUrl: string;
  commitSha: string;
  baseCommitSha?: string;
  branch?: string;
}