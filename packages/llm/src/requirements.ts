import { REVIEW_PROMPT } from "./prompt";

/** Same pessimistic ~3 characters/token estimate the review planner uses. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

/** Room left for the model's JSON answer. */
export const REVIEW_OUTPUT_RESERVE_TOKENS = 8_000;
/** PR metadata, the description excerpt and JSON framing around the patches. */
const REVIEW_ENVELOPE_TOKENS = 2_000;
/** Below this much diff per request, findings lose the surrounding hunk. */
const MIN_CHUNK_TOKENS = 4_000;

/**
 * Tokens every review request spends before any patch or trace; `prompt` is
 * the review's prompt, which grows with the team's guidelines.
 */
export function reservedReviewTokens(prompt: string = REVIEW_PROMPT): number {
  return (
    estimateTokens(prompt) +
    REVIEW_ENVELOPE_TOKENS +
    REVIEW_OUTPUT_RESERVE_TOKENS
  );
}

/** Smallest context window that can review anything at all. */
export function minimumContextWindow(): number {
  return reservedReviewTokens() + MIN_CHUNK_TOKENS;
}

/** Context window that fits a full default-sized chunk without shrinking it. */
export function recommendedContextWindow(
  diffTokensPerChunk = 16_000,
  traceTokensPerChunk = 3_000,
): number {
  return reservedReviewTokens() + diffTokensPerChunk + traceTokensPerChunk;
}
