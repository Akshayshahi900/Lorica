export async function callLLM(){
const response = await fetch("http://localhost:11434/api/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "qwen2.5-coder:7b",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: diffText }
    ],
    stream: false,
    format: "json" // Ollama supports forcing JSON output directly
  })
});

const data = await response.json();
const comments = JSON.parse(data.message.content);}