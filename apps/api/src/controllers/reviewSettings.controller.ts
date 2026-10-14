import { Request, Response } from "express";
import { Prisma, prisma } from "@lorica/db";
import {
  DEFAULT_REVIEW_PROFILE,
  PROFILE_PRESETS,
  REPO_CONFIG_FILES,
  resolveReviewSettings,
  ReviewSettingsSchema,
  toRepoConfigYaml,
  type ReviewSettings,
} from "@lorica/types";

function ownerOf(req: Request): string | null {
  const owner = req.query.owner;
  return typeof owner === "string" && owner.trim()
    ? owner.trim().toLowerCase()
    : null;
}

function actorOf(req: Request): string | null {
  const actor = req.query.actor;
  return typeof actor === "string" && actor.trim() ? actor.trim() : null;
}

function present(row: { config: unknown; updatedBy: string | null; updatedAt: Date } | null) {
  // A row saved under an older schema reads as no settings rather than failing.
  const parsed = row ? ReviewSettingsSchema.safeParse(row.config) : null;
  const settings: ReviewSettings | null = parsed?.success ? parsed.data : null;
  return {
    settings,
    effective: resolveReviewSettings([settings]),
    yaml: toRepoConfigYaml(settings),
    updatedBy: row?.updatedBy ?? null,
    updatedAt: row?.updatedAt ?? null,
  };
}

function fail(res: Response, stage: string, error: unknown) {
  const errorType = error instanceof Error ? error.name : "unknown";
  console.error(`[api] stage=review_settings.${stage}.failed error_type=${errorType}`);
  return res.status(500).json({ error: "Failed to process review settings" });
}

export const getReviewSettings = async (req: Request, res: Response) => {
  const owner = ownerOf(req);
  if (!owner) return res.status(400).json({ error: "An owner is required" });

  try {
    const stored = await prisma.reviewSettings.findUnique({ where: { owner } });
    return res.json({
      ...present(stored),
      profiles: PROFILE_PRESETS,
      defaultProfile: DEFAULT_REVIEW_PROFILE,
      repoConfigFiles: REPO_CONFIG_FILES,
    });
  } catch (error) {
    return fail(res, "read", error);
  }
};

export const saveReviewSettings = async (req: Request, res: Response) => {
  const owner = ownerOf(req);
  if (!owner) return res.status(400).json({ error: "An owner is required" });

  const parsed = ReviewSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
        .join("; "),
    });
  }

  try {
    const data = {
      config: parsed.data as Prisma.InputJsonObject,
      updatedBy: actorOf(req),
    };
    const saved = await prisma.reviewSettings.upsert({
      where: { owner },
      create: { owner, ...data },
      update: data,
    });
    console.info(
      `[api] stage=review_settings.saved profile=${parsed.data.profile ?? "default"}`,
    );
    return res.json(present(saved));
  } catch (error) {
    return fail(res, "save", error);
  }
};

export const resetReviewSettings = async (req: Request, res: Response) => {
  const owner = ownerOf(req);
  if (!owner) return res.status(400).json({ error: "An owner is required" });

  try {
    await prisma.reviewSettings.deleteMany({ where: { owner } });
    console.info("[api] stage=review_settings.reset");
    return res.json(present(null));
  } catch (error) {
    return fail(res, "reset", error);
  }
};
