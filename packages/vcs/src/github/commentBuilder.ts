import { ReviewFinding, ReviewResult } from "../../../types/src/types";
import { REVIEW_COMMENT_MARKER } from "./postComment";

type Severity = ReviewFinding["severity"];

const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low"];

const SEVERITY_ICON: Record<Severity, string> = {
  critical: "🔴",
  high: "🟠",
  medium: "🟡",
  low: "🔵",
};

const HEADLINE_LIMIT = 90;

/** A code fence longer than any backtick run in the snippet, so it can't be closed early. */
function fenceFor(code: string): string {
  const longestRun = Math.max(0, ...(code.match(/`+/g) ?? []).map((run) => run.length));
  return "`".repeat(Math.max(3, longestRun + 1));
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Markdown isn't rendered inside `<summary>`, so inline code becomes HTML. */
function inlineHtml(text: string): string {
  return escapeHtml(text).replace(/`([^`]+)`/g, "<code>$1</code>");
}

/** The first sentence of the comment, shortened to fit on one collapsed line. */
function headline(comment: string): string {
  const firstLine = comment.trim().split("\n")[0] ?? "";
  const sentence = firstLine.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? firstLine;
  if (sentence.length <= HEADLINE_LIMIT) return sentence;
  const cut = sentence.slice(0, HEADLINE_LIMIT);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 40 ? lastSpace : HEADLINE_LIMIT).trimEnd()}…`;
}

/** The snippet's language for syntax highlighting, from its file extension. */
function languageFor(filePath: string): string {
  const extension = filePath.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? "";
  return /^[a-z0-9]+$/.test(extension) ? extension : "";
}

function codeBlock(code: string, language = ""): string {
  const fence = fenceFor(code);
  return `${fence}${language}\n${code}\n${fence}`;
}

function bySeverity(reviews: ReviewFinding[]): ReviewFinding[] {
  return [...reviews].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
  );
}

function severityCounts(reviews: ReviewFinding[]): string {
  return SEVERITY_ORDER.map((severity) => {
    const count = reviews.filter((review) => review.severity === severity).length;
    return count ? `${SEVERITY_ICON[severity]} ${count} ${severity}` : null;
  })
    .filter(Boolean)
    .join(" · ");
}

function renderFinding(review: ReviewFinding, index: number): string {
  const location = `${review.filePath}:${review.lineNumber}`;
  const summary =
    `${SEVERITY_ICON[review.severity]} <b>${index + 1}. ${inlineHtml(headline(review.comment))}</b>` +
    `<br><sub>${capitalize(review.severity)} · ${review.category} · <code>${escapeHtml(location)}</code></sub>`;

  const sections = [
    codeBlock(review.code, languageFor(review.filePath)),
    review.comment,
  ];
  if (review.suggestion) {
    sections.push(`**💡 Suggested fix**\n\n${review.suggestion}`);
  }

  // The blank line after </summary> lets GitHub render the body as Markdown.
  return `<details>
<summary>${summary}</summary>

${sections.join("\n\n")}

</details>`;
}

function indent(text: string, prefix: string): string {
  return text
    .trim()
    .split("\n")
    .map((line) => (line ? `${prefix}${line}` : line))
    .join("\n");
}

/** A self-contained prompt a coding assistant can act on to fix every finding. */
export function renderAgentPrompt(reviews: ReviewFinding[]): string {
  const issues = bySeverity(reviews)
    .map((review, index) => {
      const lines = [
        `${index + 1}. [${review.severity} · ${review.category}] ${review.filePath}:${review.lineNumber}`,
        `   Issue:\n${indent(review.comment, "     ")}`,
      ];
      if (review.suggestion) {
        lines.push(`   Suggested fix:\n${indent(review.suggestion, "     ")}`);
      }
      return lines.join("\n");
    })
    .join("\n\n");

  return `You are fixing issues that an automated code review (Lorica) found in this pull request.

For each issue below:
1. Open the file and read the code around the referenced line to understand the context.
2. Confirm the issue is real. If it is not, skip it and say why.
3. Apply the smallest correct fix. Keep the existing style and don't change unrelated code.
4. Add or update tests where the fix changes behavior.

Work from most to least severe. When done, summarize what you changed for each issue.

Issues:

${issues}`;
}

export type RenderOptions = {
  /** Include the copyable prompt for an AI coding assistant. Default true. */
  fixPrompt?: boolean;
  /** The review profile's label, shown in the footer, e.g. "Chill". */
  profile?: string;
  /** Problems with the review settings the PR's team should know about. */
  notices?: string[];
};

function footer(text: string, profile?: string): string {
  return `<sub>${text}${profile ? ` · ${escapeHtml(profile)} profile` : ""}</sub>`;
}

function noticeBlock(notices: string[] = []): string {
  return notices.map((notice) => `> [!WARNING]\n> ${notice.replace(/\n/g, " ")}\n\n`).join("");
}

export function renderReview(
  result: ReviewResult,
  { fixPrompt = true, profile, notices }: RenderOptions = {},
): string {
  if (result.reviews.length === 0) {
    return `${REVIEW_COMMENT_MARKER}

## 🤖 Lorica Review

${noticeBlock(notices)}✅ **No actionable issues found.**

${result.summary}

${footer("Generated by Lorica.", profile)}`;
  }

  const reviews = bySeverity(result.reviews);
  const count = reviews.length;

  return `${REVIEW_COMMENT_MARKER}

## 🤖 Lorica Review

**${count} ${count === 1 ? "issue" : "issues"} found** · ${severityCounts(reviews)}

${noticeBlock(notices)}${result.summary}

${reviews.map(renderFinding).join("\n\n")}

${fixPrompt ? `<details>
<summary>🛠️ <b>Fix with your AI coding assistant</b><br><sub>Copy this prompt into Claude Code, Cursor, Copilot, or any coding agent.</sub></summary>

${codeBlock(renderAgentPrompt(reviews), "text")}

</details>

` : ""}${footer("Generated by Lorica · click an issue to expand it.", profile)}`;
}
