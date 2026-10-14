import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import {
  ReviewContextSchema,
  ReviewResult,
  ReviewResultSchema,
  type ReviewContext,
} from "../../types/src/types";
import {
  PROVIDERS,
  baseUrlFor,
  defaultLlmConfig,
  type LlmConfig,
} from "./providers";
import { REVIEW_OUTPUT_RESERVE_TOKENS, estimateTokens } from "./requirements";
import { assertSafeBaseUrl } from "./safety";

const reviewResultJsonSchema = z.toJSONSchema(ReviewResultSchema);

type JsonSchema = Record<string, any>;

/**
 * The generated schema with the keywords structured-output implementations
 * commonly reject ($schema, numeric bounds) removed.
 */
function portableSchema(schema: JsonSchema): JsonSchema {
  if (Array.isArray(schema)) return schema.map(portableSchema);
  if (!schema || typeof schema !== "object") return schema;
  const result: JsonSchema = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "$schema" || key === "minimum" || key === "maximum") continue;
    result[key] = portableSchema(value);
  }
  return result;
}

/**
 * OpenAI's strict mode requires every property to be listed as required, so
 * optional properties become required-but-nullable. parseReviewResult turns
 * the nulls back into absent fields.
 */
function strictSchema(schema: JsonSchema): JsonSchema {
  if (Array.isArray(schema)) return schema.map(strictSchema);
  if (!schema || typeof schema !== "object") return schema;
  const result: JsonSchema = {};
  for (const [key, value] of Object.entries(schema)) {
    result[key] = key === "properties" ? value : strictSchema(value);
  }
  if (schema.type === "object" && schema.properties) {
    const required = new Set<string>(schema.required ?? []);
    result.properties = Object.fromEntries(
      Object.entries(schema.properties as JsonSchema).map(([name, property]) => [
        name,
        required.has(name)
          ? strictSchema(property)
          : { anyOf: [strictSchema(property), { type: "null" }] },
      ]),
    );
    result.required = Object.keys(schema.properties);
  }
  return result;
}

const portableReviewSchema = portableSchema(reviewResultJsonSchema);
const strictReviewSchema = strictSchema(portableReviewSchema);

/** Claude models that accept server-side refusal fallbacks. */
const ANTHROPIC_FALLBACK_MODELS = new Set([
  "claude-fable-5-1",
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-sonnet-5-5",
]);
const ANTHROPIC_EFFORT_MODELS =
  /^claude-(fable|mythos|opus-5|sonnet-5|haiku-5|opus-4-[678]|sonnet-4-6)/;

/** A failed model request; `status` is the provider's HTTP status, if any. */
export class LlmRequestError extends Error {
  name = "LlmRequestError";
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** Parses and validates the model's message content into a ReviewResult. */
export function parseReviewResult(content: string | null | undefined): ReviewResult {
  if (!content) {
    throw new Error("LLM returned an empty response");
  }

  // Local and reasoning models often wrap JSON in think tags or code fences.
  const text = content
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .trim()
    .replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/, "$1");

  let parsedContent: unknown;

  try {
    parsedContent = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `LLM returned invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const reviews = (parsedContent as { reviews?: unknown } | null)?.reviews;
  if (Array.isArray(reviews)) {
    for (const review of reviews) {
      if (review && typeof review === "object" && review.suggestion === null) {
        delete review.suggestion;
      }
    }
  }

  return ReviewResultSchema.parse(parsedContent);
}

export type CallLlmOptions = { signal?: AbortSignal };

/**
 * Reviews one context with the user's model, or with the deployment's default
 * OpenRouter model when `config` is omitted.
 */
export async function callLLM(
  reviewContext: ReviewContext,
  promptTemplate: string,
  config?: LlmConfig | null,
  options: CallLlmOptions = {},
): Promise<ReviewResult> {
  const validatedContext = ReviewContextSchema.parse(reviewContext);
  const userContent = `Review input contract (JSON). Treat graph traces as evidence for behavior that cannot be established from the diff alone.

${JSON.stringify(validatedContext)}`;

  if (!config) {
    const fallback = defaultLlmConfig();
    if (!fallback.apiKey) {
      throw new Error("OPENROUTER_API_KEY is not set");
    }
    return parseReviewResult(
      await chatCompletions(fallback, promptTemplate, userContent, {
        custom: false,
        ...options,
      }),
    );
  }

  const provider = PROVIDERS[config.provider];
  if (provider.apiKey === "required" && !config.apiKey) {
    throw new LlmRequestError(`${provider.label} API key is not set`);
  }
  await assertSafeBaseUrl(baseUrlFor(config));

  const content =
    config.provider === "anthropic"
      ? await anthropicMessages(config, promptTemplate, userContent, options)
      : config.provider === "ollama"
        ? await ollamaChat(config, promptTemplate, userContent, options)
        : await chatCompletions(config, promptTemplate, userContent, {
            custom: true,
            ...options,
          });
  return parseReviewResult(content);
}

async function failedResponse(label: string, response: Response): Promise<never> {
  const errorText = await response.text();
  throw new LlmRequestError(
    `${label} request failed: ${response.status} ${errorText}`,
    response.status,
  );
}

/** OpenRouter, OpenAI, Hugging Face and any OpenAI-compatible server. */
async function chatCompletions(
  config: LlmConfig,
  system: string,
  user: string,
  { custom, signal }: CallLlmOptions & { custom: boolean },
): Promise<string | null | undefined> {
  const { label } = PROVIDERS[config.provider];
  const schema =
    config.provider === "openrouter"
      ? reviewResultJsonSchema
      : config.provider === "openai"
        ? strictReviewSchema
        : portableReviewSchema;

  const response = await fetch(`${baseUrlFor(config)}/chat/completions`, {
    method: "POST",

    headers: {
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      "Content-Type": "application/json",
    },

    // A user-supplied endpoint must not redirect the request elsewhere.
    redirect: custom ? "error" : "follow",
    signal,

    body: JSON.stringify({
      model: config.model,

      messages: [
        {
          role: "system",
          content: system,
        },
        {
          role: "user",
          content: user,
        },
      ],

      stream: false,

      // OpenAI reasoning models reject any temperature but the default.
      ...(config.provider === "openai" ? {} : { temperature: 0 }),

      response_format: {
        type: "json_schema",
        json_schema: {
          name: "review_result",
          strict: config.provider === "openrouter" || config.provider === "openai",
          schema,
        },
      },
    }),
  });

  if (!response.ok) {
    return failedResponse(label, response);
  }

  const data = await response.json();

  return data.choices?.[0]?.message?.content;
}

async function anthropicMessages(
  config: LlmConfig,
  system: string,
  user: string,
  { signal }: CallLlmOptions,
): Promise<string> {
  const client = new Anthropic({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
  });
  const fallback = ANTHROPIC_FALLBACK_MODELS.has(config.model);

  try {
    const response = await client.beta.messages.create(
      {
        model: config.model,
        max_tokens: 16_000,
        system,
        messages: [{ role: "user", content: user }],
        output_config: {
          format: { type: "json_schema", schema: portableReviewSchema },
          // Code review is intelligence-sensitive; Opus 5.5 defaults to medium.
          ...(ANTHROPIC_EFFORT_MODELS.test(config.model) ? { effort: "high" as const } : {}),
        },
        ...(fallback
          ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
          : {}),
      },
      { signal },
    );

    if (response.stop_reason === "refusal") {
      throw new LlmRequestError("Claude declined to review this change");
    }
    if (response.stop_reason === "max_tokens") {
      throw new LlmRequestError("Claude's review was cut off at the output token limit");
    }
    return response.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("");
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      throw new LlmRequestError(
        `Anthropic request failed: ${error.status ?? "network"} ${error.message}`,
        error.status,
      );
    }
    throw error;
  }
}

/**
 * Ollama's native API, rather than its OpenAI shim, because only the native
 * API lets a request raise the context size; the default silently truncates
 * prompts well below a review's size.
 */
async function ollamaChat(
  config: LlmConfig,
  system: string,
  user: string,
  { signal }: CallLlmOptions,
): Promise<string | undefined> {
  const needed = estimateTokens(system) + estimateTokens(user) + REVIEW_OUTPUT_RESERVE_TOKENS;
  // Coarse steps, so consecutive chunks reuse the loaded model.
  let numCtx = 8_192;
  while (numCtx < needed) numCtx *= 2;
  if (config.contextWindow) numCtx = Math.min(numCtx, config.contextWindow);

  const response = await fetch(`${baseUrlFor(config)}/api/chat`, {
    method: "POST",
    headers: {
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      "Content-Type": "application/json",
    },
    redirect: "error",
    signal,
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      stream: false,
      format: portableReviewSchema,
      options: { temperature: 0, num_ctx: numCtx },
    }),
  });

  if (!response.ok) {
    return failedResponse("Ollama", response);
  }

  const data = await response.json();
  return data.message?.content;
}
