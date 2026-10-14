import { z } from "zod";

export const DEFAULT_LLM_MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free";

export const LLM_PROVIDERS = [
  "openrouter",
  "openai",
  "anthropic",
  "huggingface",
  "ollama",
  "openai_compatible",
] as const;

export type LlmProvider = (typeof LLM_PROVIDERS)[number];

export type ProviderInfo = {
  id: LlmProvider;
  label: string;
  /** Used when the user leaves the base URL empty. */
  defaultBaseUrl: string | null;
  apiKey: "required" | "optional";
  /** Prefilled in the model field; never applied without the user saving it. */
  exampleModel: string;
  hint: string;
};

export const PROVIDERS: Record<LlmProvider, ProviderInfo> = {
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    apiKey: "required",
    exampleModel: DEFAULT_LLM_MODEL,
    hint: "Any OpenRouter model that supports structured outputs.",
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    defaultBaseUrl: "https://api.openai.com/v1",
    apiKey: "required",
    exampleModel: "gpt-5",
    hint: "OpenAI chat models with structured outputs.",
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic (Claude)",
    defaultBaseUrl: "https://api.anthropic.com",
    apiKey: "required",
    exampleModel: "claude-opus-5-5",
    hint: "Claude models via the Anthropic API.",
  },
  huggingface: {
    id: "huggingface",
    label: "Hugging Face",
    defaultBaseUrl: "https://router.huggingface.co/v1",
    apiKey: "required",
    exampleModel: "Qwen/Qwen3-Coder-480B-A35B-Instruct",
    hint: "Hugging Face Inference Providers (access token with inference permission).",
  },
  ollama: {
    id: "ollama",
    label: "Ollama (local)",
    defaultBaseUrl: "http://localhost:11434",
    apiKey: "optional",
    exampleModel: "qwen2.5-coder:32b",
    hint: "A local or self-hosted Ollama server. The worker must be able to reach it.",
  },
  openai_compatible: {
    id: "openai_compatible",
    label: "OpenAI-compatible (llama.cpp, LM Studio, vLLM)",
    defaultBaseUrl: null,
    apiKey: "optional",
    exampleModel: "local-model",
    hint: "Any server exposing /v1/chat/completions, e.g. http://localhost:8080/v1 for llama.cpp.",
  },
};

export const LlmConfigSchema = z.object({
  provider: z.enum(LLM_PROVIDERS),
  model: z.string().trim().min(1).max(200),
  apiKey: z.string().trim().min(1).max(500).optional(),
  baseUrl: z.string().trim().url().max(500).optional(),
  /** Effective context window in tokens, when known. Shapes chunk sizes. */
  contextWindow: z.number().int().min(1_024).max(10_000_000).optional(),
});

export type LlmConfig = z.infer<typeof LlmConfigSchema>;

/** The configuration used when a user has not chosen their own model. */
export function defaultLlmConfig(
  env: Record<string, string | undefined> = process.env,
): LlmConfig {
  return {
    provider: "openrouter",
    model: env.LLM_MODEL || DEFAULT_LLM_MODEL,
    apiKey: env.OPENROUTER_API_KEY || undefined,
  };
}

export function baseUrlFor(config: LlmConfig): string {
  const baseUrl = config.baseUrl ?? PROVIDERS[config.provider].defaultBaseUrl;
  if (!baseUrl) {
    throw new Error(`${PROVIDERS[config.provider].label} requires a base URL`);
  }
  return baseUrl.replace(/\/+$/, "");
}
