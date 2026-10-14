import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { callLLM, parseReviewResult } from "./client";
import { checkModelCapability } from "./capability";
import { DEFAULT_LLM_MODEL } from "./providers";
import { assertSafeBaseUrl } from "./safety";
import { decryptSecret, encryptSecret } from "./secrets";
import { configFromStoredSettings } from "./settings";
import type { ReviewContext } from "../../types/src/types";

const context: ReviewContext = {
  schemaVersion: "1",
  pullRequest: {
    repository: "acme/widget",
    number: 7,
    title: null,
    description: null,
    author: null,
    baseSha: "base",
    headSha: "head",
    event: "fresh",
  },
  changedFiles: [{ filePath: "src/a.ts", status: "modified", patch: "@@ -1 +1 @@\n-a\n+b" }],
  graph: { indexedCommit: "head", traces: [] },
};

const finding = {
  filePath: "src/stats/average.ts",
  lineNumber: 3,
  code: "for (let i = 0; i <= values.length; i++) {",
  severity: "high",
  category: "bug",
  comment: "Reads past the end of the array.",
};

type Call = { url: string; init: RequestInit & { body?: string } };
let calls: Call[] = [];
let respond: (call: Call) => Response;
const realFetch = globalThis.fetch;
const env = { ...process.env };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  calls = [];
  globalThis.fetch = (async (url: string, init: RequestInit & { body?: string }) => {
    const call = { url: String(url), init };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  process.env = { ...env };
});

describe("default model", () => {
  it("sends the same OpenRouter request as before when no settings are saved", async () => {
    process.env.OPENROUTER_API_KEY = "or-key";
    delete process.env.LLM_MODEL;
    respond = () =>
      json({ choices: [{ message: { content: JSON.stringify({ summary: "ok", reviews: [] }) } }] });

    await callLLM(context, "PROMPT");

    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal((calls[0]!.init.headers as Record<string, string>).Authorization, "Bearer or-key");
    const body = JSON.parse(calls[0]!.init.body!);
    assert.equal(body.model, DEFAULT_LLM_MODEL);
    assert.equal(body.temperature, 0);
    assert.equal(body.response_format.json_schema.strict, true);
    assert.equal(body.response_format.json_schema.schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  });

  it("still requires OPENROUTER_API_KEY", async () => {
    delete process.env.OPENROUTER_API_KEY;
    await assert.rejects(callLLM(context, "PROMPT"), /OPENROUTER_API_KEY is not set/);
  });
});

describe("custom models", () => {
  it("sends OpenAI a strict schema without temperature", async () => {
    respond = () =>
      json({
        choices: [{ message: { content: JSON.stringify({ summary: "ok", reviews: [{ ...finding, suggestion: null }] }) } }],
      });

    const result = await callLLM(context, "PROMPT", { provider: "openai", model: "gpt-5", apiKey: "sk" });

    assert.equal(calls[0]!.url, "https://api.openai.com/v1/chat/completions");
    const body = JSON.parse(calls[0]!.init.body!);
    assert.equal(body.temperature, undefined);
    const item = body.response_format.json_schema.schema.properties.reviews.items;
    assert.ok(item.required.includes("suggestion"));
    assert.equal(result.reviews[0]!.suggestion, undefined);
  });

  it("calls Ollama's native API with a context size that fits the request", async () => {
    respond = () => json({ message: { content: JSON.stringify({ summary: "ok", reviews: [] }) } });

    await callLLM(context, "PROMPT", {
      provider: "ollama",
      model: "qwen2.5-coder:7b",
      baseUrl: "http://localhost:11434",
    });

    assert.equal(calls[0]!.url, "http://localhost:11434/api/chat");
    const body = JSON.parse(calls[0]!.init.body!);
    assert.equal(body.options.num_ctx, 8_192);
    assert.equal(body.format.type, "object");
    assert.equal(calls[0]!.init.headers && "Authorization" in calls[0]!.init.headers, false);
  });

  it("requires a key for hosted providers", async () => {
    await assert.rejects(
      callLLM(context, "PROMPT", { provider: "huggingface", model: "x/y" }),
      /API key is not set/,
    );
  });
});

describe("parsing model output", () => {
  it("accepts fenced JSON and drops think blocks", () => {
    const text = `<think>hmm</think>\n\`\`\`json\n${JSON.stringify({ summary: "x", reviews: [] })}\n\`\`\``;
    assert.equal(parseReviewResult(text).summary, "x");
  });
});

describe("stored settings", () => {
  it("round-trips an encrypted API key", () => {
    const keyEnv = { LLM_SETTINGS_ENCRYPTION_KEY: "test-secret" };
    const stored = encryptSecret("sk-live", keyEnv);
    assert.ok(!stored.includes("sk-live"));
    assert.equal(decryptSecret(stored, keyEnv), "sk-live");
    assert.throws(() => decryptSecret(stored, { LLM_SETTINGS_ENCRYPTION_KEY: "other" }));
    assert.equal(
      configFromStoredSettings(
        { provider: "openai", model: "gpt-5", baseUrl: null, apiKeyCiphertext: stored, contextWindow: 128_000 },
        keyEnv,
      ).apiKey,
      "sk-live",
    );
  });

  it("refuses to store keys without an encryption key", () => {
    assert.throws(() => encryptSecret("sk", {}), /LLM_SETTINGS_ENCRYPTION_KEY/);
  });
});

describe("base URL safety", () => {
  it("blocks private addresses in production unless allowed", async () => {
    await assert.rejects(
      assertSafeBaseUrl("http://169.254.169.254/v1", { NODE_ENV: "production" }),
      /private network/,
    );
    await assert.rejects(assertSafeBaseUrl("http://127.0.0.1:11434", { NODE_ENV: "production" }), /private/);
    await assertSafeBaseUrl("http://127.0.0.1:11434", {
      NODE_ENV: "production",
      LLM_ALLOW_PRIVATE_BASE_URLS: "true",
    });
    await assertSafeBaseUrl("http://localhost:11434", { NODE_ENV: "development" });
    await assert.rejects(assertSafeBaseUrl("file:///etc/passwd", {}), /http or https/);
  });
});

describe("capability check", () => {
  const config = {
    provider: "openai_compatible" as const,
    model: "local",
    baseUrl: "http://localhost:8080/v1",
  };

  it("is ready when the model fits, answers in JSON and finds the planted bug", async () => {
    respond = ({ url }) =>
      url.endsWith("/models")
        ? json({ data: [{ id: "local", meta: { n_ctx_train: 131_072 } }] })
        : json({ choices: [{ message: { content: JSON.stringify({ summary: "bug", reviews: [finding] }) } }] });

    const report = await checkModelCapability(config);
    assert.equal(report.verdict, "ready");
    assert.equal(report.contextWindow, 131_072);
  });

  it("warns when the planted bug is missed and fails on a tiny context window", async () => {
    respond = ({ url }) =>
      url.endsWith("/models")
        ? json({ data: [{ id: "local", meta: { n_ctx_train: 4_096 } }] })
        : json({ choices: [{ message: { content: JSON.stringify({ summary: "fine", reviews: [] }) } }] });

    const report = await checkModelCapability(config);
    assert.equal(report.verdict, "unsupported");
    assert.equal(report.checks.find((c) => c.id === "context")!.status, "fail");
    assert.equal(report.checks.find((c) => c.id === "quality")!.status, "warn");
  });

  it("fails when the model does not return review JSON", async () => {
    respond = ({ url }) =>
      url.endsWith("/models")
        ? json({ data: [] })
        : json({ choices: [{ message: { content: "Looks good to me!" } }] });

    const report = await checkModelCapability(config);
    assert.equal(report.verdict, "unsupported");
    assert.equal(report.checks.find((c) => c.id === "output")!.status, "fail");
  });

  it("explains a rejected API key", async () => {
    respond = ({ url }) => (url.endsWith("/models") ? json({}, 401) : json({ error: "bad key" }, 401));

    const report = await checkModelCapability({ ...config, apiKey: "wrong" });
    assert.match(report.checks.find((c) => c.id === "connection")!.detail, /rejected the API key/);
  });
});
