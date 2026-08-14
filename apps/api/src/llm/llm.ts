import {z} from "zod";
import { ReviewResult, ReviewResultSchema } from "../../../../types/types";

const reviewResultJsonSchema = z.toJSONSchema(ReviewResultSchema);

console.dir(reviewResultJsonSchema, { depth: null });

export async function callLLM(
  diffText: string,
  promptTemplate: string,
): Promise<ReviewResult> {
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
          content: `Here is the complete Git diff of the pull request.

Review ONLY the changes shown in this diff  

\`\`\`diff
${diffText}
\`\`\``,
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
