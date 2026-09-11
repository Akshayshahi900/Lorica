import {z} from "zod";
import {
  ReviewContextSchema,
  ReviewResult,
  ReviewResultSchema,
  type ReviewContext,
} from "../../types/src/types";

const reviewResultJsonSchema = z.toJSONSchema(ReviewResultSchema);

// console.dir(reviewResultJsonSchema, { depth: null });

export async function callLLM(
  reviewContext: ReviewContext,
  promptTemplate: string,
): Promise<ReviewResult> {
  const validatedContext = ReviewContextSchema.parse(reviewContext);
  const response = await fetch("http://localhost:11434/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "qwen2.5-coder:7b",

      messages: [
        {
          role: "system",
          content: promptTemplate,
        },
        {
          role: "user",
          content: `Review input contract (JSON). Treat graph traces as evidence for behavior that cannot be established from the diff alone.\n\n${JSON.stringify(validatedContext)}`,
        },
      ],

      stream: false,
      format: reviewResultJsonSchema,
      options: {
        temperature: 0,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Ollama request failed: ${response.status} ${await response.text()}`,
    );
  }

  const data = await response.json();

  console.log("========== RAW LLM RESPONSE ==========");
  console.log(data.message?.content);
  console.log("======================================");

  if (!data.message?.content) {
    throw new Error("LLM returned an empty response");
  }

  const parsedContent = JSON.parse(data.message.content);
  return ReviewResultSchema.parse(parsedContent);
}
