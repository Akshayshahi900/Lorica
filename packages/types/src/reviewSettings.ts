import { z } from "zod";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export const REVIEW_PROFILES = ["quiet", "chill", "assertive"] as const;
export type ReviewProfile = (typeof REVIEW_PROFILES)[number];

export const REVIEW_SEVERITIES = ["critical", "high", "medium", "low"] as const;
export type ReviewSeverity = (typeof REVIEW_SEVERITIES)[number];

/** The merge gate's severity threshold; "none" blocks on no severity. */
export const MERGE_BLOCK_LEVELS = [...REVIEW_SEVERITIES, "none"] as const;
export type MergeBlockLevel = (typeof MERGE_BLOCK_LEVELS)[number];

/** What each profile means when nothing more specific is configured. */
export const PROFILE_PRESETS: Record<
  ReviewProfile,
  { label: string; description: string; minSeverity: ReviewSeverity; maxFindings: number }
> = {
  quiet: {
    label: "Quiet",
    description: "Only high-confidence, high-impact bugs and security issues. Silence over noise.",
    minSeverity: "high",
    maxFindings: 5,
  },
  chill: {
    label: "Chill",
    description: "Concrete defects of any severity, no style or preference comments.",
    minSeverity: "low",
    maxFindings: 20,
  },
  assertive: {
    label: "Assertive",
    description: "Defects plus maintainability, readability, naming and missing tests.",
    minSeverity: "low",
    maxFindings: 40,
  },
};

const text = (max: number) => z.string().trim().max(max);
const list = (maxItems: number, maxLength = 200) =>
  z.array(z.string().trim().min(1).max(maxLength)).max(maxItems);

export const PathInstructionSchema = z
  .object({
    path: text(200).min(1),
    instructions: text(2_000).min(1),
  })
  .strict();

/**
 * One layer of review settings: the owner's dashboard settings or a
 * repository's `.lorica.yaml`. Every field is optional; a layer sets only what
 * it changes. Unknown keys are rejected so a typo in a config file is reported
 * instead of silently ignored.
 */
export const ReviewSettingsSchema = z
  .object({
    profile: z.enum(REVIEW_PROFILES).optional(),
    /** Coding guidelines the reviewer enforces, in the team's own words. */
    guidelines: text(8_000).optional(),
    /** Extra guidance for files matching a glob, e.g. `src/api/**`. */
    pathInstructions: z.array(PathInstructionSchema).max(25).optional(),
    /** Globs of files never sent for review, on top of the built-in filters. */
    excludePaths: list(50).optional(),
    /** How review comments should read, e.g. "Be brief and friendly". */
    tone: text(500).optional(),
    workflow: z
      .object({
        /** Off: new pull requests are not reviewed at all. */
        autoReview: z.boolean().optional(),
        reviewDrafts: z.boolean().optional(),
        /** Off: only opened, reopened and ready-for-review events are reviewed. */
        reviewOnPush: z.boolean().optional(),
        /** Globs of base branches to review; empty reviews every branch. */
        baseBranches: list(20).optional(),
        /** Case-insensitive title substrings that skip a review, e.g. "WIP". */
        ignoreTitleKeywords: list(20, 100).optional(),
        /** PR authors whose pull requests are not reviewed, e.g. bots. */
        ignoreAuthors: list(50, 100).optional(),
      })
      .strict()
      .optional(),
    style: z
      .object({
        /** Findings below this severity are dropped. Defaults to the profile's. */
        minSeverity: z.enum(REVIEW_SEVERITIES).optional(),
        /** Most findings a review shows. Defaults to the profile's. */
        maxFindings: z.number().int().min(1).max(100).optional(),
        /** Include the copyable "fix with your AI assistant" prompt. */
        fixPrompt: z.boolean().optional(),
        /** Suggest what to do once the PR is merged (migrations, config, ...). */
        postMergeActions: z.boolean().optional(),
      })
      .strict()
      .optional(),
    /**
     * The "Lorica" commit status, which branch protection can require before
     * merging. It fails while the review shows a blocking finding.
     */
    mergeGate: z
      .object({
        enabled: z.boolean().optional(),
        /** Findings at or above this severity block the merge. */
        blockOn: z.enum(MERGE_BLOCK_LEVELS).optional(),
        /** Any coding-guideline violation blocks the merge, whatever its severity. */
        enforceGuidelines: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type ReviewSettings = z.infer<typeof ReviewSettingsSchema>;
export type PathInstruction = z.infer<typeof PathInstructionSchema>;

/** The settings a review actually runs with, after every layer is applied. */
export type EffectiveReviewSettings = {
  profile: ReviewProfile;
  guidelines: string[];
  pathInstructions: PathInstruction[];
  excludePaths: string[];
  tone: string | null;
  workflow: {
    autoReview: boolean;
    reviewDrafts: boolean;
    reviewOnPush: boolean;
    baseBranches: string[];
    ignoreTitleKeywords: string[];
    ignoreAuthors: string[];
  };
  style: {
    minSeverity: ReviewSeverity;
    maxFindings: number;
    fixPrompt: boolean;
    postMergeActions: boolean;
  };
  mergeGate: {
    enabled: boolean;
    blockOn: MergeBlockLevel;
    enforceGuidelines: boolean;
  };
};

export const DEFAULT_REVIEW_PROFILE: ReviewProfile = "chill";

/**
 * Applies layers in order (owner settings, then the repository's file).
 * Guidelines and lists accumulate, so a repository adds to its organisation's
 * standards rather than replacing them; everything else is overridden by the
 * last layer that sets it. Severity and finding limits not set anywhere come
 * from the final profile.
 */
export function resolveReviewSettings(
  layers: (ReviewSettings | null | undefined)[],
): EffectiveReviewSettings {
  let profile = DEFAULT_REVIEW_PROFILE;
  let tone: string | null = null;
  let baseBranches: string[] = [];
  let minSeverity: ReviewSeverity | undefined;
  let maxFindings: number | undefined;
  let blockOn: MergeBlockLevel = "high";
  const guidelines: string[] = [];
  const pathInstructions: PathInstruction[] = [];
  const excludePaths: string[] = [];
  const ignoreTitleKeywords: string[] = [];
  const ignoreAuthors: string[] = [];
  const flags = {
    autoReview: true,
    reviewDrafts: true,
    reviewOnPush: true,
    fixPrompt: true,
    postMergeActions: true,
    mergeGate: true,
    enforceGuidelines: true,
  };

  for (const layer of layers) {
    if (!layer) continue;
    const { workflow = {}, style = {}, mergeGate = {} } = layer;
    if (layer.profile) profile = layer.profile;
    if (layer.guidelines) guidelines.push(layer.guidelines);
    if (layer.tone) tone = layer.tone;
    pathInstructions.push(...(layer.pathInstructions ?? []));
    excludePaths.push(...(layer.excludePaths ?? []));
    if (workflow.baseBranches) baseBranches = workflow.baseBranches;
    ignoreTitleKeywords.push(...(workflow.ignoreTitleKeywords ?? []));
    ignoreAuthors.push(...(workflow.ignoreAuthors ?? []));
    if (workflow.autoReview !== undefined) flags.autoReview = workflow.autoReview;
    if (workflow.reviewDrafts !== undefined) flags.reviewDrafts = workflow.reviewDrafts;
    if (workflow.reviewOnPush !== undefined) flags.reviewOnPush = workflow.reviewOnPush;
    if (style.fixPrompt !== undefined) flags.fixPrompt = style.fixPrompt;
    if (style.postMergeActions !== undefined) flags.postMergeActions = style.postMergeActions;
    if (mergeGate.enabled !== undefined) flags.mergeGate = mergeGate.enabled;
    if (mergeGate.enforceGuidelines !== undefined) flags.enforceGuidelines = mergeGate.enforceGuidelines;
    if (mergeGate.blockOn) blockOn = mergeGate.blockOn;
    if (style.minSeverity) minSeverity = style.minSeverity;
    if (style.maxFindings) maxFindings = style.maxFindings;
  }

  const preset = PROFILE_PRESETS[profile];
  return {
    profile,
    guidelines,
    pathInstructions,
    excludePaths: [...new Set(excludePaths)],
    tone,
    workflow: {
      autoReview: flags.autoReview,
      reviewDrafts: flags.reviewDrafts,
      reviewOnPush: flags.reviewOnPush,
      baseBranches,
      ignoreTitleKeywords: [...new Set(ignoreTitleKeywords)],
      ignoreAuthors: [...new Set(ignoreAuthors.map((author) => author.toLowerCase()))],
    },
    style: {
      minSeverity: minSeverity ?? preset.minSeverity,
      maxFindings: maxFindings ?? preset.maxFindings,
      fixPrompt: flags.fixPrompt,
      postMergeActions: flags.postMergeActions,
    },
    mergeGate: {
      enabled: flags.mergeGate,
      blockOn,
      enforceGuidelines: flags.enforceGuidelines,
    },
  };
}

/** Repository config files, in the order they are looked up. */
export const REPO_CONFIG_FILES = [".lorica.yaml", ".lorica.yml"] as const;

const MAX_REPO_CONFIG_BYTES = 64 * 1024;

/** Parses a repository's `.lorica.yaml`; problems are returned, not thrown. */
export function parseRepoReviewConfig(
  source: string,
): { settings: ReviewSettings } | { error: string } {
  if (source.length > MAX_REPO_CONFIG_BYTES) {
    return { error: `the file is larger than ${MAX_REPO_CONFIG_BYTES / 1024} KB` };
  }
  let document: unknown;
  try {
    document = parseYaml(source, { maxAliasCount: 50 }) ?? {};
  } catch (error) {
    return { error: `invalid YAML: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}` };
  }
  const parsed = ReviewSettingsSchema.safeParse(document);
  if (!parsed.success) {
    return {
      error: parsed.error.issues
        .slice(0, 5)
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; "),
    };
  }
  return { settings: parsed.data };
}

/** Settings as a `.lorica.yaml` a team can commit to a repository. */
export function toRepoConfigYaml(settings: ReviewSettings | null): string {
  const body = settings && Object.keys(settings).length > 0
    ? stringifyYaml(settings, { lineWidth: 0 })
    : `profile: ${DEFAULT_REVIEW_PROFILE}\n`;
  return `# Lorica review settings. Read from the branch a pull request targets.\n# Guidelines and lists add to the owner's dashboard settings; other values override them.\n${body}`;
}
