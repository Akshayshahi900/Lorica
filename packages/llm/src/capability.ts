import Anthropic from "@anthropic-ai/sdk";

import type { ReviewContext } from "../../types/src/types";
import { LlmRequestError, callLLM } from "./client";
import { REVIEW_PROMPT } from "./prompt";
import { PROVIDERS, baseUrlFor, type LlmConfig } from "./providers";
import { minimumContextWindow, recommendedContextWindow } from "./requirements";
import { assertSafeBaseUrl } from "./safety";

export type CheckStatus = "pass" | "warn" | "fail";

export type CapabilityCheck = {
  id: "endpoint" | "model" | "context" | "connection" | "output" | "quality";
  label: string;
  status: CheckStatus;
  detail: string;
};

export type CapabilityReport = {
  /** ready: all checks pass; limited: usable with caveats; unsupported: reviews would fail. */
  verdict: "ready" | "limited" | "unsupported";
  provider: LlmConfig["provider"];
  model: string;
  /** What chunk sizes will be fitted to; null when unknown. */
  contextWindow: number | null;
  contextWindowSource: "provider" | "user" | "unknown";
  minimumContextWindow: number;
  recommendedContextWindow: number;
  latencyMs: number | null;
  checks: CapabilityCheck[];
};

type ModelInfo = {
  /** null: the provider could not tell us. */
  found: boolean | null;
  contextWindow: number | null;
  structuredOutputs: boolean | null;
};

const UNKNOWN: ModelInfo = { found: null, contextWindow: null, structuredOutputs: null };

function positive(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : null;
}

async function getJson(url: string, config: LlmConfig, signal: AbortSignal, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    redirect: "error",
    signal,
    headers: {
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      "Content-Type": "application/json",
    },
  });
  return { status: response.status, body: response.ok ? await response.json() : null };
}

/** Best-effort model metadata. Never throws; the live probe is authoritative. */
async function lookupModelInfo(config: LlmConfig, signal: AbortSignal): Promise<ModelInfo> {
  const base = baseUrlFor(config);
  try {
    switch (config.provider) {
      case "openrouter": {
        const { body } = await getJson(`${base}/models`, config, signal);
        const model = body?.data?.find((entry: any) => entry.id === config.model);
        if (!body) return UNKNOWN;
        if (!model) return { ...UNKNOWN, found: false };
        const parameters: string[] = model.supported_parameters ?? [];
        return {
          found: true,
          contextWindow: positive(model.top_provider?.context_length ?? model.context_length),
          structuredOutputs:
            parameters.includes("structured_outputs") || parameters.includes("response_format"),
        };
      }
      case "anthropic": {
        const client = new Anthropic({ apiKey: config.apiKey, baseURL: config.baseUrl });
        try {
          const model = await client.models.retrieve(config.model, {}, { signal });
          return {
            found: true,
            contextWindow: positive(model.max_input_tokens),
            structuredOutputs:
              (model.capabilities as any)?.structured_outputs?.supported ?? null,
          };
        } catch (error) {
          if (error instanceof Anthropic.NotFoundError) return { ...UNKNOWN, found: false };
          return UNKNOWN;
        }
      }
      case "openai": {
        const { status } = await getJson(
          `${base}/models/${encodeURIComponent(config.model)}`,
          config,
          signal,
        );
        if (status === 404) return { ...UNKNOWN, found: false };
        return { ...UNKNOWN, found: status === 200 ? true : null };
      }
      case "huggingface": {
        const { body } = await getJson(`${base}/models`, config, signal);
        if (!body) return UNKNOWN;
        const model = body.data?.find((entry: any) => entry.id === config.model);
        if (!model) return { ...UNKNOWN, found: false };
        const providers: any[] = (model.providers ?? []).filter(
          (provider: any) => provider.status !== "error",
        );
        const contexts = providers
          .map((provider) => positive(provider.context_length))
          .filter((value): value is number => value !== null);
        return {
          found: true,
          contextWindow: contexts.length > 0 ? Math.max(...contexts) : null,
          structuredOutputs: providers.length
            ? providers.some((provider) => provider.supports_structured_output)
            : null,
        };
      }
      case "ollama": {
        const { status, body } = await getJson(`${base}/api/show`, config, signal, {
          method: "POST",
          body: JSON.stringify({ model: config.model }),
        });
        if (status === 404) return { ...UNKNOWN, found: false };
        if (!body) return UNKNOWN;
        const contextEntry = Object.entries(body.model_info ?? {}).find(([key]) =>
          key.endsWith(".context_length"),
        );
        return {
          found: true,
          contextWindow: positive(contextEntry?.[1]),
          structuredOutputs: true,
        };
      }
      case "openai_compatible": {
        const { body } = await getJson(`${base}/models`, config, signal);
        const models: any[] = body?.data ?? [];
        const model =
          models.find((entry) => entry.id === config.model) ??
          // llama.cpp serves one model whatever name a request uses.
          (models.length === 1 ? models[0] : undefined);
        if (!model) return models.length > 0 ? { ...UNKNOWN, found: false } : UNKNOWN;
        return {
          found: true,
          contextWindow: positive(
            model.max_model_len ?? // vLLM
              model.meta?.n_ctx ??
              model.meta?.n_ctx_train ?? // llama.cpp
              model.context_length ??
              model.context_window,
          ),
          structuredOutputs: null,
        };
      }
    }
  } catch {
    return UNKNOWN;
  }
}

// A small change with one unambiguous defect: `<=` reads past the array, so
// every average is NaN. A model that cannot spot this is not worth trusting.
const PLANTED_FILE = "src/stats/average.ts";
const PLANTED_LINES = { from: 1, to: 8 };
const PROBE_CONTEXT: ReviewContext = {
  schemaVersion: "1",
  pullRequest: {
    repository: "lorica/capability-check",
    number: 1,
    title: "Simplify average()",
    description: "Replace reduce with a plain loop.",
    author: "lorica",
    baseSha: "0000000000000000000000000000000000000000",
    headSha: "1111111111111111111111111111111111111111",
    event: "fresh",
  },
  changedFiles: [
    {
      filePath: PLANTED_FILE,
      status: "modified",
      patch: [
        "@@ -1,4 +1,8 @@",
        " export function average(values: number[]): number {",
        "-  if (values.length === 0) return 0;",
        "-  return values.reduce((sum, value) => sum + value, 0) / values.length;",
        "+  let sum = 0;",
        "+  for (let i = 0; i <= values.length; i++) {",
        "+    sum += values[i];",
        "+  }",
        "+  return sum / values.length;",
        " }",
      ].join("\n"),
    },
  ],
  graph: { indexedCommit: "1111111111111111111111111111111111111111", traces: [] },
};

function describeError(error: unknown, config: LlmConfig): string {
  const label = PROVIDERS[config.provider].label;
  if (error instanceof LlmRequestError) {
    if (error.status === 401 || error.status === 403) {
      return `${label} rejected the API key (${error.status}).`;
    }
    if (error.status === 404) {
      return `${label} does not serve model "${config.model}" at this endpoint (404).`;
    }
    if (error.status === 429) {
      return `${label} rate-limited the request (429). Try again shortly.`;
    }
    return error.message.slice(0, 400);
  }
  if (error instanceof Error && error.name === "TimeoutError") {
    return "The model did not answer within the time limit.";
  }
  if (error instanceof TypeError) {
    return `Could not reach ${baseUrlFor(config)} from the Lorica server.`;
  }
  return (error instanceof Error ? error.message : String(error)).slice(0, 400);
}

export type CheckOptions = {
  /** Upper bound for the whole check, including the probe review. */
  timeoutMs?: number;
};

/**
 * Decides whether a model can produce Lorica reviews: it must be reachable,
 * have room for a review chunk, return schema-valid JSON, and find a planted
 * bug. The probe sends a tiny synthetic diff, never user code.
 */
export async function checkModelCapability(
  config: LlmConfig,
  { timeoutMs = 180_000 }: CheckOptions = {},
): Promise<CapabilityReport> {
  const signal = AbortSignal.timeout(timeoutMs);
  const checks: CapabilityCheck[] = [];
  const report = (
    contextWindow: number | null,
    contextWindowSource: CapabilityReport["contextWindowSource"],
    latencyMs: number | null,
  ): CapabilityReport => ({
    verdict: checks.some((check) => check.status === "fail")
      ? "unsupported"
      : checks.some((check) => check.status === "warn")
        ? "limited"
        : "ready",
    provider: config.provider,
    model: config.model,
    contextWindow,
    contextWindowSource,
    minimumContextWindow: minimumContextWindow(),
    recommendedContextWindow: recommendedContextWindow(),
    latencyMs,
    checks,
  });

  try {
    await assertSafeBaseUrl(baseUrlFor(config));
    checks.push({
      id: "endpoint",
      label: "Endpoint",
      status: "pass",
      detail: baseUrlFor(config),
    });
  } catch (error) {
    checks.push({
      id: "endpoint",
      label: "Endpoint",
      status: "fail",
      detail: error instanceof Error ? error.message : String(error),
    });
    return report(null, "unknown", null);
  }

  const info = await lookupModelInfo(config, signal);
  if (info.found === false) {
    checks.push({
      id: "model",
      label: "Model",
      status: "fail",
      detail: `"${config.model}" is not available from ${PROVIDERS[config.provider].label}.`,
    });
    return report(null, "unknown", null);
  }
  checks.push({
    id: "model",
    label: "Model",
    status: info.found ? "pass" : "warn",
    detail: info.found
      ? `"${config.model}" is available.`
      : "The provider does not list its models; availability is confirmed by the test review below.",
  });

  // A user-entered window wins when smaller: they may know the server's
  // runtime limit (e.g. llama.cpp -c) is below the model's maximum.
  const contextWindow =
    info.contextWindow && config.contextWindow
      ? Math.min(info.contextWindow, config.contextWindow)
      : (config.contextWindow ?? info.contextWindow);
  const contextWindowSource: CapabilityReport["contextWindowSource"] = config.contextWindow
    ? "user"
    : info.contextWindow
      ? "provider"
      : "unknown";
  const minimum = minimumContextWindow();
  const recommended = recommendedContextWindow();
  const tokens = (value: number) => `${Math.round(value / 1000)}K tokens`;
  checks.push(
    contextWindow === null
      ? {
          id: "context",
          label: "Context window",
          status: "warn",
          detail: `Unknown. Reviews need at least ${tokens(minimum)}; enter the model's context window so chunks can be sized to fit.`,
        }
      : contextWindow < minimum
        ? {
            id: "context",
            label: "Context window",
            status: "fail",
            detail: `${tokens(contextWindow)} is below the ${tokens(minimum)} a review request needs.`,
          }
        : contextWindow < recommended
          ? {
              id: "context",
              label: "Context window",
              status: "warn",
              detail: `${tokens(contextWindow)}. Diffs will be split into smaller chunks (recommended: ${tokens(recommended)}); very large PRs may be partly unreviewed.`,
            }
          : {
              id: "context",
              label: "Context window",
              status: "pass",
              detail: `${tokens(contextWindow)}.`,
            },
  );

  const started = Date.now();
  let latencyMs: number | null = null;
  try {
    const result = await callLLM(PROBE_CONTEXT, REVIEW_PROMPT, config, { signal });
    latencyMs = Date.now() - started;
    checks.push({
      id: "connection",
      label: "Connection",
      status: "pass",
      detail: `Answered in ${(latencyMs / 1000).toFixed(1)}s.`,
    });
    checks.push({
      id: "output",
      label: "Structured output",
      status: "pass",
      detail:
        info.structuredOutputs === false
          ? "Valid review JSON, although the provider does not advertise structured outputs; larger reviews may occasionally fail to parse."
          : "Returned valid review JSON.",
    });
    const caught = result.reviews.some(
      (finding) =>
        finding.filePath.endsWith(PLANTED_FILE) &&
        finding.lineNumber >= PLANTED_LINES.from &&
        finding.lineNumber <= PLANTED_LINES.to,
    );
    checks.push(
      caught
        ? {
            id: "quality",
            label: "Review quality",
            status: "pass",
            detail: "Found the bug planted in the test diff.",
          }
        : {
            id: "quality",
            label: "Review quality",
            status: "warn",
            detail:
              "Missed an obvious bug planted in the test diff. This model may be too weak for reliable reviews.",
          },
    );
  } catch (error) {
    latencyMs = Date.now() - started;
    const invalidOutput =
      !(error instanceof LlmRequestError) &&
      error instanceof Error &&
      (error.name === "ZodError" || /invalid JSON|empty response/.test(error.message));
    if (invalidOutput) {
      checks.push({
        id: "connection",
        label: "Connection",
        status: "pass",
        detail: `Answered in ${(latencyMs / 1000).toFixed(1)}s.`,
      });
      checks.push({
        id: "output",
        label: "Structured output",
        status: "fail",
        detail: "The model's answer was not valid review JSON. Choose a model that supports structured (JSON schema) output.",
      });
    } else {
      checks.push({
        id: "connection",
        label: "Connection",
        status: "fail",
        detail: describeError(error, config),
      });
    }
  }

  return report(contextWindow, contextWindowSource, latencyMs);
}
