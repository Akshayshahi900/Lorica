import { z } from "zod";

import {
  ReviewContextSchema,
  ReviewResult,
  ReviewResultSchema,
  type ReviewContext,
} from "../../types/src/types";

const reviewResultJsonSchema = z.toJSONSchema(ReviewResultSchema);

export async function callLLM(
  reviewContext: ReviewContext,
  promptTemplate: string,
): Promise<ReviewResult> {
  const validatedContext = ReviewContextSchema.parse(reviewContext);

  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",

      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },

      body: JSON.stringify({
        model: "nvidia/nemotron-3-ultra-550b-a55b:free",

        messages: [
          {
            role: "system",
            content: promptTemplate,
          },
          {
            role: "user",
            content: `Review input contract (JSON). Treat graph traces as evidence for behavior that cannot be established from the diff alone.

${JSON.stringify(validatedContext)}`,
          },
        ],

        stream: false,

        temperature: 0,

        response_format: {
          type: "json_schema",
          json_schema: {
            name: "review_result",
            strict: true,
            schema: reviewResultJsonSchema,
          },
        },
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();

    throw new Error(
      `OpenRouter request failed: ${response.status} ${errorText}`,
    );
  }

  const data = await response.json();

  console.log("========== RAW LLM RESPONSE ==========");
  console.log(data.choices?.[0]?.message?.content);
  console.log("======================================");

  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("LLM returned an empty response");
  }

  let parsedContent: unknown;

  try {
    parsedContent = JSON.parse(content);
  } catch (error) {
    throw new Error(
      `LLM returned invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return ReviewResultSchema.parse(parsedContent);
}