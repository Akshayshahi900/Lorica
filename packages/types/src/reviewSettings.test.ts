import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseRepoReviewConfig,
  resolveReviewSettings,
  toRepoConfigYaml,
} from "./reviewSettings";

describe("resolving review settings", () => {
  it("defaults to the Chill profile with every workflow switch on", () => {
    const settings = resolveReviewSettings([]);
    assert.equal(settings.profile, "chill");
    assert.deepEqual(settings.style, {
      minSeverity: "low",
      maxFindings: 20,
      fixPrompt: true,
      postMergeActions: true,
    });
    assert.deepEqual(settings.mergeGate, { enabled: true, blockOn: "high", enforceGuidelines: true });
    assert.equal(settings.workflow.autoReview, true);
    assert.equal(settings.workflow.reviewDrafts, true);
    assert.equal(settings.workflow.reviewOnPush, true);
  });

  it("lets the repository override scalars and add to guidelines and lists", () => {
    const settings = resolveReviewSettings([
      {
        profile: "assertive",
        guidelines: "Org: use the shared logger.",
        tone: "Friendly.",
        excludePaths: ["docs/**"],
        pathInstructions: [{ path: "src/**", instructions: "Org rule." }],
        workflow: { baseBranches: ["main"], ignoreAuthors: ["Renovate[bot]"], reviewDrafts: false },
      },
      {
        profile: "quiet",
        guidelines: "Repo: no default exports.",
        excludePaths: ["docs/**", "e2e/**"],
        pathInstructions: [{ path: "src/db/**", instructions: "Repo rule." }],
        workflow: { baseBranches: ["develop"], ignoreAuthors: ["dependabot[bot]"] },
      },
    ]);
    assert.equal(settings.profile, "quiet");
    assert.equal(settings.tone, "Friendly.");
    assert.deepEqual(settings.guidelines, ["Org: use the shared logger.", "Repo: no default exports."]);
    assert.deepEqual(settings.excludePaths, ["docs/**", "e2e/**"]);
    assert.equal(settings.pathInstructions.length, 2);
    assert.deepEqual(settings.workflow.baseBranches, ["develop"]);
    assert.deepEqual(settings.workflow.ignoreAuthors, ["renovate[bot]", "dependabot[bot]"]);
    assert.equal(settings.workflow.reviewDrafts, false);
    // The final profile's preset fills in limits nobody set.
    assert.equal(settings.style.minSeverity, "high");
    assert.equal(settings.style.maxFindings, 5);
  });
});

describe("the merge gate settings", () => {
  it("lets the repository override the owner's gate", () => {
    const settings = resolveReviewSettings([
      { mergeGate: { blockOn: "medium", enforceGuidelines: false } },
      { mergeGate: { blockOn: "critical" }, style: { postMergeActions: false } },
    ]);
    assert.deepEqual(settings.mergeGate, { enabled: true, blockOn: "critical", enforceGuidelines: false });
    assert.equal(settings.style.postMergeActions, false);
  });

  it("rejects an unknown block level in a config file", () => {
    assert.ok("error" in parseRepoReviewConfig("mergeGate:\n  blockOn: severe\n"));
  });
});

describe("the repository config file", () => {
  it("parses a valid file", () => {
    const parsed = parseRepoReviewConfig(`
profile: assertive
guidelines: |
  Prefer early returns.
workflow:
  reviewDrafts: false
style:
  maxFindings: 10
`);
    assert.ok("settings" in parsed);
    assert.equal(parsed.settings.profile, "assertive");
    assert.equal(parsed.settings.guidelines, "Prefer early returns.");
    assert.equal(parsed.settings.style?.maxFindings, 10);
  });

  it("treats an empty file as no settings", () => {
    assert.deepEqual(parseRepoReviewConfig(""), { settings: {} });
  });

  it("reports unknown keys, bad values and broken YAML instead of throwing", () => {
    const unknown = parseRepoReviewConfig("profil: quiet\n");
    assert.ok("error" in unknown && /profil/.test(unknown.error));
    const badValue = parseRepoReviewConfig("profile: loud\n");
    assert.ok("error" in badValue && /^profile:/.test(badValue.error));
    const broken = parseRepoReviewConfig("profile: [quiet\n");
    assert.ok("error" in broken && /invalid YAML/.test(broken.error));
  });

  it("round-trips the dashboard settings through YAML", () => {
    const settings = {
      profile: "quiet" as const,
      guidelines: "Line one.\nLine two.",
      workflow: { ignoreTitleKeywords: ["WIP"] },
    };
    const yaml = toRepoConfigYaml(settings);
    assert.match(yaml, /^# Lorica review settings/);
    assert.deepEqual(parseRepoReviewConfig(yaml), { settings });
    assert.match(toRepoConfigYaml(null), /profile: chill/);
  });
});
