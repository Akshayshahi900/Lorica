/**
 * Offline benchmark of the review pipeline against real GitHub pull requests.
 *
 *   pnpm benchmark collect           add bug-fix PRs and recent PRs, cache their diffs
 *   pnpm benchmark index             clone each buggy commit, build its code graph
 *                                    in Neo4j and cache the graph evidence (no LLM)
 *   pnpm benchmark run [--graph]     review the cases, diff only or with graph context
 *   pnpm benchmark judge [--graph]   confirm which flagged findings describe the real bug
 *   pnpm benchmark report            rewrite the report from saved results
 *
 * `run` and `judge` skip cases they have already done and stop cleanly when
 * OpenRouter's free daily limit is reached, so they can be rerun each day.
 *
 * Detection: each case is a merged bug-fix PR with its patch reversed, so the
 * diff reintroduces a bug the maintainers really fixed. Title, description and
 * test changes are withheld so nothing names the bug. A case is flagged when a
 * finding lands within LINE_TOLERANCE lines of a reintroduced change, and
 * identified when a judge model says the finding describes the fixed defect.
 *
 * Graph context: the reversed diff's head is the fix PR's base commit (the code
 * with the bug). `index` builds that commit's graph with the production indexer
 * and stores the one-hop traces the review would have received.
 *
 * Filtering: estimated prompt tokens of recent PRs before and after the
 * built-in file filter. No model calls.
 *
 * GitHub is read with GITHUB_TOKEN, or else a Lorica App installation token.
 * Neo4j defaults to the docker-compose instance.
 */
import fs from "node:fs";
import path from "node:path";
import {
  baseUrlFor,
  buildReviewPrompt,
  callLLM,
  DEFAULT_LLM_MODEL,
  defaultLlmConfig,
} from "@lorica/llm";
import { estimateTokens, filterReviewableFiles, planReview } from "@lorica/context";
import { getAppOctokit, getInstallationAccessToken } from "@lorica/vcs";
import type { ChangedFile, GraphTrace, ReviewFinding } from "@lorica/types";
import { refreshCodeGraph } from "./indexer/refreshCodeGraph";
import { getReviewGraphContext } from "./neo4j";

process.env.NEO4J_URI ??= "bolt://localhost:7687";
process.env.NEO4J_USER ??= "neo4j";
process.env.NEO4J_PASSWORD ??= "password123";

const OUT_DIR = path.resolve(process.env.LORICA_ROOT ?? process.cwd(), "benchmark");
const CASES_FILE = path.join(OUT_DIR, "cases.json");
const GRAPHS_FILE = path.join(OUT_DIR, "graphs.json");

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
/** Keeps one busy repository from dominating the cases. */
const MAX_CASES_PER_REPO = Number(process.env.BENCH_MAX_PER_REPO ?? 15);
const LINE_TOLERANCE = 3;
const SOURCE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte)$/;
/** Example apps, docs sites and playgrounds: a fix there is rarely a product bug. */
const NON_PRODUCT = /(^|\/)(examples?|docs?|playgrounds?|sandbox)\//;
const TEST_FILE =
  /(^|\/)(__tests__|tests?|spec|e2e|fixtures?|__snapshots__)\/|\.(test|spec|bench)\.\w+$/i;

type PrFile = { filePath: string; status: string; patch?: string };
type DetectionCase = { url: string; title: string; baseSha?: string; files: PrFile[] };
type FilterCase = { url: string; files: PrFile[] };
type Cases = { collectedAt: string; detection: DetectionCase[]; filter: FilterCase[] };
type GraphEntry = {
  indexedCommit: string;
  traces: GraphTrace[];
  indexSeconds: number;
  error?: string;
};

type Mode = "diff" | "graph";
const mode: Mode = process.argv.includes("--graph") ? "graph" : "diff";
const resultsFile = (m: Mode) =>
  path.join(OUT_DIR, m === "graph" ? "results-graph.json" : "results.json");

const repoOf = (url: string) => url.split("/").slice(3, 5).join("/");
const numberOf = (url: string) => Number(url.split("/")[6]);
const sourceFiles = (files: PrFile[]) =>
  files.filter((f) => SOURCE_FILE.test(f.filePath) && !TEST_FILE.test(f.filePath));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const readJson = <T>(file: string, fallback: T): T =>
  fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as T) : fallback;
const writeJson = (file: string, value: unknown) => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
};

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

async function githubToken(): Promise<string> {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  const { data } = await getAppOctokit().apps.listInstallations({ per_page: 1 });
  if (!data[0]) throw new Error("Set GITHUB_TOKEN: the GitHub App has no installations");
  return getInstallationAccessToken(data[0].id);
}

type GitHub = <T>(pathname: string) => Promise<T>;

function github(token: string): GitHub {
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

type SearchResult = { items: { title: string; html_url: string }[] };

async function searchPrs(get: GitHub, query: string, page: number) {
  const q = encodeURIComponent(
    `${query} is:pr is:merged ${REPOS.map((r) => `repo:${r}`).join(" ")}`,
  );
  const result = await get<SearchResult>(
    `/search/issues?q=${q}&sort=created&order=desc&per_page=50&page=${page}`,
  );
  return result.items.map((item) => ({ url: item.html_url, title: item.title }));
}

async function prFiles(get: GitHub, url: string): Promise<PrFile[]> {
  const files = await get<{ filename: string; status: string; patch?: string }[]>(
    `/repos/${repoOf(url)}/pulls/${numberOf(url)}/files?per_page=100`,
  );
  return files.map((f) => ({ filePath: f.filename, status: f.status, patch: f.patch }));
}

async function baseSha(get: GitHub, url: string): Promise<string> {
  const pr = await get<{ base: { sha: string } }>(
    `/repos/${repoOf(url)}/pulls/${numberOf(url)}`,
  );
  return pr.base.sha;
}

function changedLineCount(patch: string): number {
  return patch.split("\n").filter((l) => /^[+-]/.test(l)).length;
}

/** Small, source-only bug fixes: the reversed diff has one clear defect to find. */
function isDetectionCandidate(files: PrFile[]): boolean {
  const source = sourceFiles(files);
  if (source.some((f) => NON_PRODUCT.test(f.filePath))) return false;
  if (source.length < 1 || source.length > 3) return false;
  if (source.some((f) => f.status !== "modified" || !f.patch)) return false;
  const lines = source.reduce((sum, f) => sum + changedLineCount(f.patch!), 0);
  return lines >= 2 && lines <= 60;
}

/** Adds cases up to the targets; cases already collected (and their results) are kept. */
async function collect() {
  const get = github(await githubToken());
  const cases = readJson<Cases>(CASES_FILE, { collectedAt: "", detection: [], filter: [] });
  const known = new Set(cases.detection.map((c) => c.url));
  const perRepo = new Map<string, number>();
  for (const c of cases.detection) perRepo.set(repoOf(c.url), (perRepo.get(repoOf(c.url)) ?? 0) + 1);

  // GitHub search returns at most 1,000 results.
  for (let page = 1; cases.detection.length < DETECTION_TARGET && page <= 20; page++) {
    const prs = await searchPrs(get, `"fix" in:title`, page);
    if (prs.length === 0) break;
    for (const pr of prs) {
      if (cases.detection.length >= DETECTION_TARGET) break;
      const repo = repoOf(pr.url);
      if (known.has(pr.url) || (perRepo.get(repo) ?? 0) >= MAX_CASES_PER_REPO) continue;
      known.add(pr.url);
      const files = await prFiles(get, pr.url);
      if (!isDetectionCandidate(files)) continue;
      cases.detection.push({ url: pr.url, title: pr.title, baseSha: await baseSha(get, pr.url), files });
      perRepo.set(repo, (perRepo.get(repo) ?? 0) + 1);
      console.log(`[collect] detection ${cases.detection.length}/${DETECTION_TARGET} ${pr.url}`);
      writeJson(CASES_FILE, cases);
    }
  }

  const knownFilter = new Set(cases.filter.map((c) => c.url));
  for (let page = 1; cases.filter.length < FILTER_TARGET && page <= 5; page++) {
    for (const pr of await searchPrs(get, "", page)) {
      if (cases.filter.length >= FILTER_TARGET) break;
      if (knownFilter.has(pr.url)) continue;
      cases.filter.push({ url: pr.url, files: await prFiles(get, pr.url) });
      console.log(`[collect] filter ${cases.filter.length}/${FILTER_TARGET} ${pr.url}`);
    }
  }

  cases.collectedAt = new Date().toISOString();
  writeJson(CASES_FILE, cases);
  console.log(`[collect] ${cases.detection.length} detection cases in ${CASES_FILE}`);
}

function loadCases(): Cases {
  if (!fs.existsSync(CASES_FILE)) throw new Error(`Run "pnpm benchmark collect" first`);
  const cases = readJson<Cases>(CASES_FILE, { collectedAt: "", detection: [], filter: [] });
  cases.detection = cases.detection.filter((c) => isDetectionCandidate(c.files));
  return cases;
}

// ---------------------------------------------------------------------------
// Graph context
// ---------------------------------------------------------------------------

/**
 * Builds each case's code graph at the fix PR's base commit with the
 * production indexer, then keeps the traces the review would have received.
 * One Neo4j graph per repository is reused and replaced case by case.
 */
async function index() {
  const cases = readJson<Cases>(CASES_FILE, { collectedAt: "", detection: [], filter: [] });
  const graphs = readJson<Record<string, GraphEntry>>(GRAPHS_FILE, {});
  const eligible = cases.detection.filter((c) => isDetectionCandidate(c.files));
  let get: GitHub | undefined;

  for (const [i, c] of eligible.entries()) {
    if (graphs[c.url] && !graphs[c.url]!.error) continue;
    if (!c.baseSha) {
      get ??= github(await githubToken());
      c.baseSha = await baseSha(get, c.url);
      writeJson(CASES_FILE, cases);
    }
    const repositoryUrl = `https://github.com/${repoOf(c.url)}.git`;
    const started = performance.now();
    try {
      await refreshCodeGraph({ repositoryUrl, branch: "benchmark", commit: c.baseSha });
      const graph = await getReviewGraphContext({
        repositoryUrl,
        branch: "benchmark",
        changedFiles: sourceFiles(c.files).map((f) => f.filePath),
      });
      graphs[c.url] = { ...graph, indexSeconds: (performance.now() - started) / 1000 };
    } catch (error) {
      graphs[c.url] = {
        indexedCommit: c.baseSha,
        traces: [],
        indexSeconds: (performance.now() - started) / 1000,
        error: error instanceof Error ? error.message.slice(0, 300) : String(error),
      };
    }
    const entry = graphs[c.url]!;
    console.log(
      `[index] ${i + 1}/${eligible.length} ${entry.error ? "ERROR" : `traces=${entry.traces.length}`} ${entry.indexSeconds.toFixed(1)}s ${c.url}`,
    );
    writeJson(GRAPHS_FILE, graphs);
  }
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
// Reviewing
// ---------------------------------------------------------------------------

/** OpenRouter's free tier allows a fixed number of requests per day. */
class DailyLimitError extends Error {}

function isDailyLimit(error: unknown): boolean {
  return error instanceof Error && /free-models-per-day|per-day/i.test(error.message);
}

/** Retries rate-limit bursts; gives up at once on the daily limit. */
async function withRetries<T>(call: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      if (isDailyLimit(error)) throw new DailyLimitError((error as Error).message);
      if (attempt >= 2) throw error;
      await sleep(20_000 * (attempt + 1));
    }
  }
}

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
  traces?: number;
  findings: ReviewFinding[];
  matched: ReviewFinding[];
  /** Set by `judge`: a nearby finding describes the defect the fix addresses. */
  confirmed?: boolean;
  /** Who judged the case when not the judge model. */
  judgedBy?: string;
  error?: string;
};

async function reviewCase(
  c: DetectionCase,
  index: number,
  prompt: string,
  graph: GraphEntry | undefined,
): Promise<CaseResult> {
  const changedFiles: ChangedFile[] = sourceFiles(c.files).map((f) => ({
    filePath: f.filePath,
    status: "modified",
    patch: reversePatch(f.patch!),
  }));
  const plan = planReview({
    pullRequest: {
      repository: repoOf(c.url),
      number: index + 1,
      title: "Update implementation", // the real title would name the bug
      description: null,
      author: null,
      baseSha: "benchmark",
      headSha: c.baseSha ?? "benchmark",
      event: "fresh",
    },
    changedFiles,
    indexedCommit: graph?.indexedCommit ?? "benchmark",
    traces: graph?.traces ?? [],
    ...(graph ? {} : { unavailableReason: "Graph context is disabled for this benchmark run." }),
  });

  const started = performance.now();
  const findings: ReviewFinding[] = [];
  try {
    for (const context of plan.contexts) {
      findings.push(...(await withRetries(() => callLLM(context, prompt))).reviews);
    }
  } catch (error) {
    if (error instanceof DailyLimitError) throw error;
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
    chunks: plan.contexts.length,
    traces: plan.contexts.reduce((sum, ctx) => sum + ctx.graph.traces.length, 0),
    findings, matched,
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

const loadResults = (m: Mode) => readJson<CaseResult[]>(resultsFile(m), []);

function stopForToday(step: string, done: number, total: number) {
  console.log(
    `\n[${step}] OpenRouter's free daily limit is reached after ${done}/${total} cases. ` +
      `Run the same command again after the daily reset (00:00 UTC) to continue.`,
  );
}

async function run() {
  const cases = loadCases();
  const graphs = mode === "graph" ? readJson<Record<string, GraphEntry>>(GRAPHS_FILE, {}) : {};
  const prompt = buildReviewPrompt({ profile: "chill", guidelines: [], pathInstructions: [], tone: null });

  // Keep finished cases; retry the ones that errored.
  const results = loadResults(mode).filter((r) => !r.error);
  const done = new Set(results.map((r) => r.url));
  for (const [index, c] of cases.detection.entries()) {
    if (done.has(c.url)) continue;
    const graph = graphs[c.url];
    if (mode === "graph" && (!graph || graph.error)) {
      console.log(`[run] ${index + 1}/${cases.detection.length} skipped: not indexed ${c.url}`);
      continue;
    }
    let result: CaseResult;
    try {
      result = await reviewCase(c, index, prompt, mode === "graph" ? graph : undefined);
    } catch (error) {
      if (!(error instanceof DailyLimitError)) throw error;
      return stopForToday("run", results.length, cases.detection.length);
    }
    results.push(result);
    console.log(
      `[run:${mode}] ${index + 1}/${cases.detection.length} ${result.error ? "ERROR" : result.detected ? "DETECTED" : "missed"} ${result.seconds.toFixed(1)}s ${c.url}`,
    );
    writeJson(resultsFile(mode), results);
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
  const results = loadResults(mode);
  for (const [index, result] of results.entries()) {
    if (result.confirmed !== undefined) continue;
    const c = cases.get(result.url);
    if (!c || result.error || result.matched.length === 0) {
      result.confirmed = false;
      continue;
    }
    const fix = sourceFiles(c.files)
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
    try {
      const answer = await withRetries(async () => {
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
        return (data.choices[0]?.message.content ?? "")
          .replace(/<think>[\s\S]*?<\/think>/g, "")
          .trim()
          .toUpperCase();
      });
      result.confirmed = /\bYES\b/.test(answer) && !/\bNO\b/.test(answer.slice(0, 5));
    } catch (error) {
      writeJson(resultsFile(mode), results);
      if (!(error instanceof DailyLimitError)) throw error;
      return stopForToday("judge", results.filter((r) => r.confirmed !== undefined).length, results.length);
    }
    console.log(`[judge:${mode}] ${index + 1}/${results.length} ${result.confirmed ? "CONFIRMED" : "not confirmed"} ${result.url}`);
    writeJson(resultsFile(mode), results);
  }
  writeJson(resultsFile(mode), results);
  report();
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

function summarize(results: CaseResult[]) {
  const completed = results.filter((r) => !r.error);
  const rate = (n: number) =>
    `${n} / ${completed.length} (${pct(completed.length ? n / completed.length : 0)})`;
  const times = completed.map((r) => r.seconds);
  return {
    completed,
    judged: completed.every((r) => r.confirmed !== undefined),
    identified: rate(completed.filter((r) => r.confirmed).length),
    flagged: rate(completed.filter((r) => r.detected).length),
    valid: `${completed.length} / ${results.length} (${pct(results.length ? completed.length / results.length : 0)})`,
    median: `${percentile(times, 50).toFixed(1)}s`,
    p90: `${percentile(times, 90).toFixed(1)}s`,
    findings: (completed.reduce((s, r) => s + r.findings.length, 0) / Math.max(1, completed.length)).toFixed(1),
  };
}

function graphSection(diffResults: CaseResult[], graphResults: CaseResult[]): string {
  const graphs = readJson<Record<string, GraphEntry>>(GRAPHS_FILE, {});
  const paired = new Set(
    graphResults.filter((r) => !r.error).map((r) => r.url),
  );
  const diff = diffResults.filter((r) => !r.error && paired.has(r.url));
  const graph = graphResults.filter((r) => !r.error && paired.has(r.url));
  if (graph.length === 0) return "";
  const byUrl = new Map(diff.map((r) => [r.url, r]));
  const won = graph.filter((r) => r.confirmed && !byUrl.get(r.url)?.confirmed);
  const lost = graph.filter((r) => !r.confirmed && byUrl.get(r.url)?.confirmed);
  const d = summarize(diff);
  const g = summarize(graph);
  const indexed = Object.values(graphs).filter((e) => !e.error);
  const traces = graph.map((r) => r.traces ?? 0);
  return `
## Diff only vs graph context

The same ${graph.length} cases, reviewed once with the diff alone and once with one-hop code-graph evidence from the buggy commit.

| Metric | Diff only | With graph |
| --- | --- | --- |
| Real bugs identified | ${d.judged ? `**${d.identified}**` : "not judged yet"} | ${g.judged ? `**${g.identified}**` : "not judged yet"} |
| Real bugs flagged | ${d.flagged} | ${g.flagged} |
| Review time, median | ${d.median} | ${g.median} |
| Findings per review, mean | ${d.findings} | ${g.findings} |

- Graph traces per review: median ${percentile(traces, 50)}, max ${Math.max(0, ...traces)}.
- Indexing the buggy commit (clone, parse, persist to Neo4j): median ${percentile(indexed.map((e) => e.indexSeconds), 50).toFixed(1)}s over ${indexed.length} commits.
${g.judged && d.judged ? `- Identified only with the graph: ${won.length}. Identified only without it: ${lost.length}.\n` : ""}`;
}

function report() {
  const cases = loadCases();
  const results = loadResults("diff");
  const graphResults = loadResults("graph");
  const model = process.env.LLM_MODEL ?? DEFAULT_LLM_MODEL;
  const s = summarize(results);
  const filter = filterStats(cases.filter);
  const saved = filter.rawTokens === 0 ? 0 : 1 - filter.keptTokens / filter.rawTokens;
  const repos = [...new Set(s.completed.map((r) => repoOf(r.url)))];
  const byHand = [...results, ...graphResults].filter((r) => r.judgedBy).length;

  const text = `# Lorica benchmark

Run ${new Date().toISOString().slice(0, 10)} with model \`${model}\` and the \`chill\` profile. ${s.completed.length} real bugs from ${repos.length} open-source repositories. Reproduce with \`pnpm benchmark collect && pnpm benchmark run && pnpm benchmark judge\`; add \`pnpm benchmark index\` and \`--graph\` for the graph comparison.

## Results (diff only)

| Metric | Value |
| --- | --- |
${s.judged ? `| Real bugs identified (finding describes the fixed defect) | **${s.identified}** |\n` : ""}| Real bugs flagged (finding within ${LINE_TOLERANCE} lines of the defect) | ${s.flagged} |
| Valid structured responses | ${s.valid} |
| Review time, median | ${s.median} |
| Review time, p90 | ${s.p90} |
| Findings per review, mean | ${s.findings} |
| Prompt tokens removed by file filtering | ${pct(saved)} (${filter.rawTokens.toLocaleString()} → ${filter.keptTokens.toLocaleString()} est. tokens over ${filter.prs} PRs; ${filter.prsWithExclusions} PRs had files filtered) |
${graphSection(results, graphResults)}
## Method

- **Cases:** merged PRs with "fix" in the title, touching 1–3 source files (no examples or docs) and 2–60 changed lines, at most ${MAX_CASES_PER_REPO} per repository, from ${repos.join(", ")}. Each patch is reversed so the diff reintroduces the bug the maintainers fixed. The title is replaced, and the description and test changes are withheld.
- **Flagged:** any finding points within ${LINE_TOLERANCE} lines of a reintroduced change. On small diffs this is loose, so it is an upper bound.
- **Identified:** a judge model, given the real fix's title and patch, says a flagged finding describes the same defect. This is the headline number.${byHand ? ` ${byHand} verdict${byHand === 1 ? " was" : "s were"} made by hand after the judge hit a rate limit (marked in the results files).` : ""}
- **Graph context:** the production indexer builds the code graph of the fix PR's base commit (the code with the bug) in Neo4j, and the review receives the same one-hop traces it would in production.
- **Caveats:** a "fix" PR is not always a bug, LLM judging can err in either direction, and public repositories may be in the model's training data. Every case is listed below so each verdict can be checked.
- **Filtering:** the most recent merged PRs from the same repositories, estimated at ~3 characters per token, before and after the built-in filter (lockfiles, generated, vendored, assets, docs, deletions).
- **Not measured:** false-positive rate (findings away from the bug may still be valid).

## Cases

| # | PR | Diff only | With graph | Time | Nearest finding (diff only) |
| --- | --- | --- | --- | --- | --- |
${results
  .map((r, i) => {
    const status = (x?: CaseResult) =>
      !x ? "–" : x.error ? "error" : x.confirmed ? "identified" : x.detected ? "flagged" : "missed";
    const g = graphResults.find((x) => x.url === r.url);
    const finding = r.matched[0]
      ? `${r.matched[0].severity} ${r.matched[0].category}: ${r.matched[0].comment.replace(/\s+/g, " ").replace(/\|/g, "\\|").slice(0, 140)}`
      : "";
    return `| ${i + 1} | [${r.title.replace(/\|/g, "\\|").slice(0, 60)}](${r.url}) | ${status(r)} | ${status(g)} | ${r.seconds.toFixed(1)}s | ${finding} |`;
  })
  .join("\n")}
`;
  fs.writeFileSync(path.join(OUT_DIR, "REPORT.md"), text);
  console.log(`\n${text.split("## Method")[0]}`);
  console.log(`[report] wrote ${path.join(OUT_DIR, "REPORT.md")}`);
}

const commands: Record<string, () => unknown> = { collect, index, run, judge, report };
Promise.resolve()
  .then(() => {
    const command = commands[process.argv[2] ?? ""];
    if (!command) throw new Error("Usage: pnpm benchmark <collect|index|run|judge|report> [--graph]");
    return command();
  })
  .then(() => process.exit(0)) // the Neo4j driver and timers would keep the process alive
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
