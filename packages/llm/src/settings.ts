import { LlmConfigSchema, type LlmConfig } from "./providers";
import { decryptSecret } from "./secrets";

/** The columns of a ModelSettings row that make up a model configuration. */
export type StoredModelSettings = {
  provider: string;
  model: string;
  baseUrl: string | null;
  apiKeyCiphertext: string | null;
  contextWindow: number | null;
};

/** Decrypts and validates a stored row into the configuration callLLM takes. */
export function configFromStoredSettings(
  stored: StoredModelSettings,
  env: Record<string, string | undefined> = process.env,
): LlmConfig {
  return LlmConfigSchema.parse({
    provider: stored.provider,
    model: stored.model,
    baseUrl: stored.baseUrl ?? undefined,
    apiKey: stored.apiKeyCiphertext
      ? decryptSecret(stored.apiKeyCiphertext, env)
      : undefined,
    contextWindow: stored.contextWindow ?? undefined,
  });
}
