export async function callLLM(
  diffText: string,
  promptTemplate: string,
): Promise<string> {
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
      format: "json",
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

  return data.message?.content ?? "";
}
