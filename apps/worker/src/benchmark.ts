/**
 * Offline benchmark of the review pipeline against real GitHub pull requests.
 *
 *   pnpm benchmark collect   pick bug-fix PRs and recent PRs, cache their diffs
 *   pnpm benchmark run       review the cached cases and write the report
 *   pnpm benchmark judge     confirm which flagged findings describe the real bug
 *   pnpm benchmark report    rewrite the report from saved results
 *
 * Detection: each case is a merged bug-fix PR with its patch reversed, so the
 * diff reintroduces a bug the maintainers really fixed. Title, description and
 * test changes are withheld so nothing names the bug. A case is detected when
 * a finding lands within LINE_TOLERANCE lines of a reintroduced change.
 *
 * Filtering: estimated prompt tokens of recent PRs before and after the
 * built-in file filter. No model calls.
 *
 * Graph context is not used (no Neo4j), so detection is measured on the diff
 * alone. GitHub is read with GITHUB_TOKEN, or else a Lorica App installation
 * token.
 */
import fs from "node:fs";
import path from "node:path";
import { baseUrlFor, buildReviewPrompt, callLLM, DEFAULT_LLM_MODEL, defaultLlmConfig } from "@lorica/llm";
import {
  estimateTokens,
  filterReviewableFiles,
  planReview,
} from "@lorica/context";
import { getAppOctokit, getInstallationAccessToken } from "@lorica/vcs";
import type { ChangedFile, ReviewFinding } from "@lorica/types";

const OUT_DIR = path.resolve(process.env.LORICA_ROOT ?? process.cwd(), "benchmark");
const CASES_FILE = path.join(OUT_DIR, "cases.json");

const REPOS = [
  "vuejs/core",
  "honojs/hono",
  "vitejs/vite",
  "sveltejs/svelte",
  "trpc/trpc",
  "TanStack/query",
  "colinhacks/zod",
  "date-fns/date-fns",
  "nestjs/nest",
  "remix-run/react-router",
  "pmndrs/zustand",
  "axios/axios",
];
const DETECTION_TARGET = Number(process.env.BENCH_CASES ?? 30);
const FILTER_TARGET = Number(process.env.BENCH_FILTER_PRS ?? 40);
const LINE_TOLERANCE = 3;
const SOURCE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte)$/;
/** Example apps, docs sites and playgrounds: a fix there is rarely a product bug. */
const NON_PRODUCT = /(^|\/)(examples?|docs?|playgrounds?|sandbox)\//;
const TEST_FILE =
  /(^|\/)(__tests__|tests?|spec|e2e|fixtures?|__snapshots__)\/|\.(test|spec|bench)\.\w+$/i;

type PrFile = { filePath: string; status: string; patch?: string };
type DetectionCase = { url: string; title: string; files: PrFile[] };
type FilterCase = { url: string; files: PrFile[] };
type Cases = { collectedAt: string; detection: DetectionCase[]; filter: FilterCase[] };

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

async function githubToken(): Promise<string> {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  const { data } = await getAppOctokit().apps.listInstallations({ per_page: 1 });
  if (!data[0]) throw new Error("Set GITHUB_TOKEN: the GitHub App has no installations");
  return getInstallationAccessToken(data[0].id);
}

function github(token: string) {
  return async <T>(pathname: string): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(`https://api.github.com${pathname}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      });
      if (response.ok) return (await response.json()) as T;
      if ((response.status === 403 || response.status === 429) && attempt < 3) {
        await sleep(30_000); // secondary rate limit
        continue;
      }
      throw new Error(`GitHub ${pathname}: ${response.status} ${await response.text()}`);
    }
  };
}

type SearchResult = { items: { number: number; title: string; repository_url: string; html_url: string }[] };

async function searchPrs(get: ReturnType<typeof github>, query: string, page: number) {
  const q = encodeURIComponent(`${query} is:pr is:merged ${REPOS.map((r) => `repo:${r}`).join(" ")}`);
  const result = await get<SearchResult>(`/search/issues?q=${q}&sort=created&order=desc&per_page=50&page=${page}`);
  return result.items.map((item) => ({
    url: item.html_url,
    title: item.title,
    repo: item.repository_url.replace("https://api.github.com/repos/", ""),
    number: item.number,
  }));
}

async function prFiles(get: ReturnType<typeof github>, repo: string, number: number): Promise<PrFile[]> {
  const files = await get<{ filename: string; status: string; patch?: string }[]>(
    `/repos/${repo}/pulls/${number}/files?per_page=100`,
  );
  return files.map((f) => ({ filePath: f.filename, status: f.status, patch: f.patch }));
}

function changedLineCount(patch: string): number {
  return patch.split("\n").filter((l) => /^[+-]/.test(l)).length;
}

/** Small, source-only bug fixes: the reversed diff has one clear defect to find. */
function isDetectionCandidate(files: PrFile[]): boolean {
  const source = files.filter((f) => SOURCE_FILE.test(f.filePath) && !TEST_FILE.test(f.filePath));
  if (source.some((f) => NON_PRODUCT.test(f.filePath))) return false;
  if (source.length < 1 || source.length > 3) return false;
  if (source.some((f) => f.status !== "modified" || !f.patch)) return false;
  const lines = source.reduce((sum, f) => sum + changedLineCount(f.patch!), 0);
  return lines >= 2 && lines <= 60;
}

async function collect() {
  const get = github(await githubToken());
  const detection: DetectionCase[] = [];
  for (let page = 1; detection.length < DETECTION_TARGET && page <= 10; page++) {
    for (const pr of await searchPrs(get, `"fix" in:title`, page)) {
      if (detection.length >= DETECTION_TARGET) break;
      const files = await prFiles(get, pr.repo, pr.number);
      if (!isDetectionCandidate(files)) continue;
      detection.push({ url: pr.url, title: pr.title, files });
      console.log(`[collect] detection ${detection.length}/${DETECTION_TARGET} ${pr.url}`);
    }
  }

  const filter: FilterCase[] = [];
  for (let page = 1; filter.length < FILTER_TARGET && page <= 5; page++) {
    for (const pr of await searchPrs(get, "", page)) {
      if (filter.length >= FILTER_TARGET) break;
      filter.push({ url: pr.url, files: await prFiles(get, pr.repo, pr.number) });
      console.log(`[collect] filter ${filter.length}/${FILTER_TARGET} ${pr.url}`);
    }
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const cases: Cases = { collectedAt: new Date().toISOString(), detection, filter };
  fs.writeFileSync(CASES_FILE, JSON.stringify(cases, null, 2));
  console.log(`[collect] wrote ${CASES_FILE}`);
}

// ---------------------------------------------------------------------------
// Reversing a fix
// ---------------------------------------------------------------------------

const HUNK_HEADER = /^@@ -(\d+)(,\d+)? \+(\d+)(,\d+)? @@(.*)$/;

/** Swaps the sides of a unified diff: the fix becomes the change that introduces the bug. */
export function reversePatch(patch: string): string {
  return patch
    .split("\n")
    .map((line) => {
      const header = line.match(HUNK_HEADER);
      if (header) return `@@ -${header[3]}${header[4] ?? ""} +${header[1]}${header[2] ?? ""} @@${header[5]}`;
      if (line.startsWith("+")) return `-${line.slice(1)}`;
      if (line.startsWith("-")) return `+${line.slice(1)}`;
      return line;
    })
    .join("\n");
}

/** New-side line numbers where the (reversed) patch adds or removes code. */
export function changedLines(patch: string): number[] {
  const lines: number[] = [];
  let newLine = 0;
  for (const line of patch.split("\n")) {
    const header = line.match(HUNK_HEADER);
    if (header) {
      newLine = Number(header[3]);
    } else if (line.startsWith("+")) {
      lines.push(newLine++);
    } else if (line.startsWith("-")) {
      lines.push(newLine); // a deletion sits between new-side lines
    } else if (!line.startsWith("\\")) {
      newLine++;
    }
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
}

type CaseResult = {
  url: string;
  title: string;
  detected: boolean;
  seconds: number;
  chunks: number;
  findings: ReviewFinding[];
  matched: ReviewFinding[];
  /** Set by `judge`: a nearby finding describes the defect the fix addresses. */
  confirmed?: boolean;
  /** Who judged the case when not the judge model. */
  judgedBy?: string;
  error?: string;
};

async function reviewCase(c: DetectionCase, index: number, prompt: string): Promise<CaseResult> {
  const source = c.files.filter((f) => SOURCE_FILE.test(f.filePath) && !TEST_FILE.test(f.filePath));
  const changedFiles: ChangedFile[] = source.map((f) => ({
    filePath: f.filePath,
    status: "modified",
    patch: reversePatch(f.patch!),
  }));
  const plan = planReview({
    pullRequest: {
      repository: c.url.split("/").slice(3, 5).join("/"),
      number: index + 1,
      title: "Update implementation", // the real title would name the bug
      description: null,
      author: null,
      baseSha: "benchmark",
      headSha: "benchmark",
      event: "fresh",
    },
    changedFiles,
    indexedCommit: "benchmark",
    traces: [],
    unavailableReason: "Graph context is disabled for this benchmark run.",
  });

  const started = performance.now();
  const findings: ReviewFinding[] = [];
  try {
    for (const context of plan.contexts) {
      for (let attempt = 0; ; attempt++) {
        try {
          findings.push(...(await callLLM(context, prompt)).reviews);
          break;
        } catch (error) {
          if (attempt >= 2) throw error;
          await sleep(20_000 * (attempt + 1)); // free-tier rate limits
        }
      }
    }
  } catch (error) {
    return {
      url: c.url, title: c.title, detected: false, seconds: 0, chunks: plan.contexts.length,
      findings: [], matched: [], error: error instanceof Error ? error.message.slice(0, 300) : String(error),
    };
  }
  const seconds = (performance.now() - started) / 1000;

  const targets = new Map(changedFiles.map((f) => [f.filePath, changedLines(f.patch)]));
  const matched = findings.filter((finding) =>
    (targets.get(finding.filePath) ?? []).some(
      (line) => Math.abs(line - finding.lineNumber) <= LINE_TOLERANCE,
    ),
  );
  return {
    url: c.url, title: c.title, detected: matched.length > 0, seconds,
    chunks: plan.contexts.length, findings, matched,
  };
}

function filterStats(cases: FilterCase[]) {
  let rawTokens = 0;
  let keptTokens = 0;
  let prsWithExclusions = 0;
  for (const c of cases) {
    const withPatch = c.files.map((f) => ({ ...f, patch: f.patch ?? null }));
    const { reviewable, excluded } = filterReviewableFiles(withPatch);
    rawTokens += withPatch.reduce((sum, f) => sum + estimateTokens(f.patch ?? ""), 0);
    keptTokens += reviewable.reduce((sum, f) => sum + estimateTokens(f.patch ?? ""), 0);
    if (excluded.length > 0) prsWithExclusions++;
  }
  return { prs: cases.length, rawTokens, keptTokens, prsWithExclusions };
}

function loadCases(): Cases {
  if (!fs.existsSync(CASES_FILE)) throw new Error(`Run "pnpm benchmark collect" first`);
  const cases = JSON.parse(fs.readFileSync(CASES_FILE, "utf8")) as Cases;
  cases.detection = cases.detection.filter((c) => isDetectionCandidate(c.files));
  return cases;
}

const RESULTS_FILE = path.join(OUT_DIR, "results.json");
const loadResults = () => JSON.parse(fs.readFileSync(RESULTS_FILE, "utf8")) as CaseResult[];
const saveResults = (results: CaseResult[]) =>
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));

async function run() {
  const cases = loadCases();
  const prompt = buildReviewPrompt({ profile: "chill", guidelines: [], pathInstructions: [], tone: null });

  const results: CaseResult[] = [];
  for (const [index, c] of cases.detection.entries()) {
    const result = await reviewCase(c, index, prompt);
    results.push(result);
    console.log(
      `[run] ${index + 1}/${cases.detection.length} ${result.error ? "ERROR" : result.detected ? "DETECTED" : "missed"} ${result.seconds.toFixed(1)}s ${c.url}`,
    );
    saveResults(results);
  }
  report();
}

/**
 * Line proximity alone over-counts on small diffs, where almost any finding is
 * near the change. The judge checks each nearby finding against the real fix
 * (its title and patch, which the reviewer never saw) and confirms a case only
 * when a finding describes the defect that fix addresses.
 */
async function judge() {
  const cases = new Map(loadCases().detection.map((c) => [c.url, c]));
  const config = defaultLlmConfig();
  const results = loadResults();
  for (const [index, result] of results.entries()) {
    const c = cases.get(result.url);
    if (!c || result.error || result.matched.length === 0) {
      result.confirmed = false;
      continue;
    }
    const fix = c.files
      .filter((f) => SOURCE_FILE.test(f.filePath) && !TEST_FILE.test(f.filePath))
      .map((f) => `--- ${f.filePath}\n${f.patch}`)
      .join("\n");
    const findings = result.matched
      .slice(0, 5)
      .map((f, i) => `${i + 1}. ${f.filePath}:${f.lineNumber} [${f.severity} ${f.category}] ${f.comment}`)
      .join("\n");
    const question = `A maintainer fixed a defect with this pull request.

Title: ${c.title}

Fix (unified diff):
${fix}

A code reviewer, shown only the code BEFORE this fix, reported:
${findings}

Does any reported finding identify the same defect this fix addresses (the same root cause, not just the same lines)? Answer with exactly one word: YES or NO.`;
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await fetch(`${baseUrlFor(config)}/chat/completions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: process.env.BENCH_JUDGE_MODEL ?? config.model,
            messages: [{ role: "user", content: question }],
            temperature: 0,
          }),
        });
        if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
        const data = (await response.json()) as { choices: { message: { content: string } }[] };
        const answer = (data.choices[0]?.message.content ?? "")
          .replace(/<think>[\s\S]*?<\/think>/g, "")
          .trim()
          .toUpperCase();
        result.confirmed = /\bYES\b/.test(answer) && !/\bNO\b/.test(answer.slice(0, 5));
        break;
      } catch (error) {
        if (attempt >= 2) throw error;
        await sleep(20_000 * (attempt + 1));
      }
    }
    console.log(`[judge] ${index + 1}/${results.length} ${result.confirmed ? "CONFIRMED" : "not confirmed"} ${result.url}`);
    saveResults(results);
  }
  report();
}

function report() {
  const cases = loadCases();
  const results = loadResults();
  const model = process.env.LLM_MODEL ?? DEFAULT_LLM_MODEL;
  const judged = results.some((r) => r.confirmed !== undefined);
  const completed = results.filter((r) => !r.error);
  const detected = completed.filter((r) => r.detected);
  const confirmed = completed.filter((r) => r.confirmed);
  const times = completed.map((r) => r.seconds);
  const filter = filterStats(cases.filter);
  const saved = filter.rawTokens === 0 ? 0 : 1 - filter.keptTokens / filter.rawTokens;
  const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
  const repos = [...new Set(cases.detection.map((c) => c.url.split("/").slice(3, 5).join("/")))];
  const byHand = results.filter((r) => r.judgedBy).length;
  const rate = (n: number) => `${n} / ${completed.length} (${pct(completed.length ? n / completed.length : 0)})`;

  const text = `# Lorica benchmark

Run ${new Date().toISOString().slice(0, 10)} with model \`${model}\`, \`chill\` profile, graph context off. ${completed.length} cases collected ${cases.collectedAt.slice(0, 10)} from ${repos.length} open-source repositories. Reproduce with \`pnpm benchmark collect && pnpm benchmark run && pnpm benchmark judge\`.

## Results

| Metric | Value |
| --- | --- |
${judged ? `| Real bugs identified (finding describes the fixed defect) | **${rate(confirmed.length)}** |\n` : ""}| Real bugs flagged (finding within ${LINE_TOLERANCE} lines of the defect) | ${rate(detected.length)} |
| Valid structured responses | ${completed.length} / ${results.length} (${pct(results.length ? completed.length / results.length : 0)}) |
| Review time, median | ${percentile(times, 50).toFixed(1)}s |
| Review time, p90 | ${percentile(times, 90).toFixed(1)}s |
| Findings per review, mean | ${(completed.reduce((s, r) => s + r.findings.length, 0) / Math.max(1, completed.length)).toFixed(1)} |
| Prompt tokens removed by file filtering | ${pct(saved)} (${filter.rawTokens.toLocaleString()} → ${filter.keptTokens.toLocaleString()} est. tokens over ${filter.prs} PRs; ${filter.prsWithExclusions} PRs had files filtered) |

## Method

- **Cases:** merged PRs with "fix" in the title, touching 1–3 source files (no examples or docs) and 2–60 changed lines, from ${repos.join(", ")}. Each patch is reversed so the diff reintroduces the bug the maintainers fixed. The title is replaced, and the description and test changes are withheld.
- **Flagged:** any finding points within ${LINE_TOLERANCE} lines of a reintroduced change. On small diffs this is loose, so it is an upper bound.
- **Identified:** a judge model, given the real fix's title and patch, says a flagged finding describes the same defect. This is the headline number.${byHand ? ` ${byHand} case${byHand === 1 ? " was" : "s were"} judged by hand after the judge hit a rate limit (marked in \`results.json\`).` : ""}
- **Caveats:** a "fix" PR is not always a bug, LLM judging can err in either direction, and public repositories may be in the model's training data. Every case is listed below so each verdict can be checked.
- **Filtering:** the most recent merged PRs from the same repositories, estimated at ~3 characters per token, before and after the built-in filter (lockfiles, generated, vendored, assets, docs, deletions).
- **Not measured:** false-positive rate (findings away from the bug may still be valid).

## Cases

| # | PR | Result | Time | Nearest finding |
| --- | --- | --- | --- | --- |
${results
  .map((r, i) => {
    const status = r.error ? "error" : r.confirmed ? "identified" : r.detected ? "flagged" : "missed";
    const finding = r.matched[0]
      ? `${r.matched[0].severity} ${r.matched[0].category}: ${r.matched[0].comment.replace(/\s+/g, " ").replace(/\|/g, "\\|").slice(0, 140)}`
      : "";
    return `| ${i + 1} | [${r.title.replace(/\|/g, "\\|").slice(0, 60)}](${r.url}) | ${status} | ${r.seconds.toFixed(1)}s | ${finding} |`;
  })
  .join("\n")}
`;
  fs.writeFileSync(path.join(OUT_DIR, "REPORT.md"), text);
  console.log(`\n${text.split("## Method")[0]}`);
  console.log(`[report] wrote ${path.join(OUT_DIR, "REPORT.md")}`);
}

const commands: Record<string, () => unknown> = { collect, run, judge, report };
Promise.resolve()
  .then(() => {
    const command = commands[process.argv[2] ?? ""];
    if (!command) throw new Error("Usage: pnpm benchmark <collect|run|judge|report>");
    return command();
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
