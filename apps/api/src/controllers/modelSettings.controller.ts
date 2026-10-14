import { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "@lorica/db";
import {
  checkModelCapability,
  configFromStoredSettings,
  defaultLlmConfig,
  encryptSecret,
  LLM_PROVIDERS,
  LlmConfigSchema,
  minimumContextWindow,
  PROVIDERS,
  recommendedContextWindow,
  type LlmConfig,
} from "@lorica/llm";

type StoredRow = NonNullable<
  Awaited<ReturnType<typeof prisma.modelSettings.findUnique>>
>;

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const SettingsInputSchema = z.object({
  provider: z.enum(LLM_PROVIDERS),
  model: z.string().trim().min(1).max(200),
  baseUrl: z.preprocess(emptyToUndefined, z.string().trim().url().max(500).optional()),
  // Omitted or empty: keep the stored key (same provider only).
  apiKey: z.preprocess(emptyToUndefined, z.string().trim().max(500).optional()),
  clearApiKey: z.boolean().optional(),
  contextWindow: z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.coerce.number().int().min(1_024).max(10_000_000).optional(),
  ),
});

class InputError extends Error {}

function ownerOf(req: Request): string | null {
  const owner = req.query.owner;
  return typeof owner === "string" && owner.trim()
    ? owner.trim().toLowerCase()
    : null;
}

function present(row: StoredRow | null) {
  if (!row) return null;
  return {
    provider: row.provider,
    model: row.model,
    baseUrl: row.baseUrl,
    contextWindow: row.contextWindow,
    hasApiKey: Boolean(row.apiKeyCiphertext),
    verifiedAt: row.verifiedAt,
    updatedAt: row.updatedAt,
  };
}

/** Builds the configuration to test or save from the form and the stored row. */
function resolveConfig(body: unknown, stored: StoredRow | null): LlmConfig {
  const parsed = SettingsInputSchema.safeParse(body);
  if (!parsed.success) {
    throw new InputError(
      parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
        .join("; "),
    );
  }
  const input = parsed.data;

  let apiKey = input.apiKey;
  if (!apiKey && !input.clearApiKey && stored?.apiKeyCiphertext && stored.provider === input.provider) {
    apiKey = configFromStoredSettings(stored).apiKey;
  }
  if (PROVIDERS[input.provider].apiKey === "required" && !apiKey) {
    throw new InputError(`${PROVIDERS[input.provider].label} needs an API key`);
  }
  if (!input.baseUrl && !PROVIDERS[input.provider].defaultBaseUrl) {
    throw new InputError(`${PROVIDERS[input.provider].label} needs a base URL`);
  }

  return LlmConfigSchema.parse({
    provider: input.provider,
    model: input.model,
    baseUrl: input.baseUrl,
    apiKey,
    contextWindow: input.contextWindow,
  });
}

function fail(res: Response, stage: string, error: unknown) {
  if (error instanceof InputError) {
    return res.status(400).json({ error: error.message });
  }
  const errorType = error instanceof Error ? error.name : "unknown";
  console.error(`[api] stage=model_settings.${stage}.failed error_type=${errorType}`);
  return res.status(500).json({ error: "Failed to process model settings" });
}

export const getModelSettings = async (req: Request, res: Response) => {
  const owner = ownerOf(req);
  if (!owner) return res.status(400).json({ error: "An owner is required" });

  try {
    const stored = await prisma.modelSettings.findUnique({ where: { owner } });
    const fallback = defaultLlmConfig();
    return res.json({
      settings: present(stored),
      defaultModel: { provider: fallback.provider, model: fallback.model },
      providers: Object.values(PROVIDERS),
      requirements: {
        minimumContextWindow: minimumContextWindow(),
        recommendedContextWindow: recommendedContextWindow(),
      },
    });
  } catch (error) {
    return fail(res, "read", error);
  }
};

export const checkModelSettings = async (req: Request, res: Response) => {
  const owner = ownerOf(req);
  if (!owner) return res.status(400).json({ error: "An owner is required" });

  try {
    const stored = await prisma.modelSettings.findUnique({ where: { owner } });
    const config = resolveConfig(req.body, stored);
    const report = await checkModelCapability(config);
    console.info(
      `[api] stage=model_settings.checked provider=${config.provider} verdict=${report.verdict}`,
    );
    return res.json({ report });
  } catch (error) {
    return fail(res, "check", error);
  }
};

export const saveModelSettings = async (req: Request, res: Response) => {
  const owner = ownerOf(req);
  if (!owner) return res.status(400).json({ error: "An owner is required" });

  try {
    const stored = await prisma.modelSettings.findUnique({ where: { owner } });
    const config = resolveConfig(req.body, stored);

    // Fail before spending a test review on a key that cannot be stored.
    const apiKeyCiphertext = config.apiKey ? encryptSecret(config.apiKey) : null;

    // Every review for this owner will use this model, so only a model that
    // can produce reviews is saved.
    const report = await checkModelCapability(config);
    if (report.verdict === "unsupported") {
      return res.status(422).json({
        error: "This model cannot produce Lorica reviews; settings were not saved.",
        report,
      });
    }

    const data = {
      provider: config.provider,
      model: config.model,
      baseUrl: config.baseUrl ?? null,
      apiKeyCiphertext,
      contextWindow: report.contextWindow,
      verifiedAt: new Date(),
    };
    const saved = await prisma.modelSettings.upsert({
      where: { owner },
      create: { owner, ...data },
      update: data,
    });
    console.info(
      `[api] stage=model_settings.saved provider=${config.provider} verdict=${report.verdict}`,
    );
    return res.json({ settings: present(saved), report });
  } catch (error) {
    if (error instanceof Error && /LLM_SETTINGS_ENCRYPTION_KEY/.test(error.message)) {
      return res.status(503).json({
        error: "The server cannot store API keys: LLM_SETTINGS_ENCRYPTION_KEY is not configured.",
      });
    }
    return fail(res, "save", error);
  }
};

export const resetModelSettings = async (req: Request, res: Response) => {
  const owner = ownerOf(req);
  if (!owner) return res.status(400).json({ error: "An owner is required" });

  try {
    await prisma.modelSettings.deleteMany({ where: { owner } });
    console.info("[api] stage=model_settings.reset");
    return res.json({ settings: null });
  } catch (error) {
    return fail(res, "reset", error);
  }
};
