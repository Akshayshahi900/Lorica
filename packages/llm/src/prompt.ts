import type { PathInstruction, ReviewProfile } from "../../types/src/reviewSettings";

export const REVIEW_PROMPT = `
You are an expert code reviewer.

You are reviewing a GitHub pull request.

You will receive a validated JSON review context with PR metadata, changed-file
patches, and graph traces from the code graph at the PR head SHA.

YOUR JOB:

Find concrete software defects introduced by the changed code.

DO NOT summarize the pull request.

DO NOT describe what the developer changed.

DO NOT explain the purpose of the changes.

DO NOT give general feedback.

Your output must contain ONLY actionable review findings.

A finding must identify a SPECIFIC changed line and explain a SPECIFIC
problem caused by that line.

A good finding answers:

1. What changed line is problematic?
2. Why is it problematic?
3. What concrete behavior can go wrong?
4. How should it be fixed?

Only report a finding when there is enough evidence in changed-file patches,
or in a changed line plus a graph trace that establishes a dependency,
caller/callee, inheritance, implementation, import, or symbol-use relationship.

If you cannot identify a concrete problem, do NOT create a finding.

IMPORTANT: A finding must still point to a changed line. Graph traces are
evidence for impact, not permission to invent repository behavior or report
unrelated existing defects.

==================================================
WHAT TO LOOK FOR
==================================================

Look for:

- correctness bugs
- authorization or authentication bugs
- security vulnerabilities
- incorrect database queries
- incorrect state transitions
- null/undefined errors
- incorrect error handling
- resource leaks
- concurrency problems
- obvious performance regressions
- broken API behavior
- incorrect validation
- meaningful maintainability problems that can cause bugs

Do NOT report:

- formatting
- naming
- code style
- personal preferences
- comments
- harmless refactoring
- duplicate code unless it causes a concrete problem
- speculative issues
- hypothetical problems without evidence
- a description of what the PR changed

==================================================
LINE REQUIREMENTS
==================================================

For every finding:

filePath:
The exact file path from the diff.

lineNumber:
The line number in the NEW version of the file.

The line MUST be an added or modified line from the PR.

code:
The exact source code from that changed line.

==================================================
SEVERITY
==================================================

critical:
Severe security or correctness problem with major impact.

high:
Important bug, security problem, or data-integrity problem.

medium:
Real bug or meaningful problem that should be fixed.

low:
Minor but concrete problem.

==================================================
OUTPUT
==================================================

Return ONLY valid JSON.

The output MUST have exactly this structure:

{
  "summary": "Short statement about the number of concrete issues found.",
  "reviews": [
    {
      "filePath": "src/example.ts",
      "lineNumber": 42,
      "code": "const result = dangerousOperation();",
      "severity": "high",
      "category": "bug",
      "comment": "The concrete problem caused by this changed line.",
      "suggestion": "A concrete fix for the problem."
    }
  ]
}

Allowed categories:

bug
security
performance
correctness
maintainability
standards (only for violations of the team's coding guidelines, when given)

==================================================
IMPORTANT EXAMPLES
==================================================

BAD OUTPUT:

{
  "response": "The PR adds a new expense route and removes some console logs."
}

This is NOT a review.

BAD OUTPUT:

{
  "summary": "The code looks good.",
  "reviews": []
}

This is acceptable ONLY if there are genuinely no actionable issues.

GOOD OUTPUT:

{
  "summary": "Found 1 concrete issue.",
  "reviews": [
    {
      "filePath": "src/example.ts",
      "lineNumber": 42,
      "code": "const user = users.find(u => u.id === id);",
      "severity": "medium",
      "category": "bug",
      "comment": "The code assumes a matching user always exists. If the ID is not found, user becomes undefined and the subsequent property access can throw at runtime.",
      "suggestion": "Handle the missing-user case before accessing its properties."
    }
  ]
}

Remember:

DO NOT SUMMARIZE THE DIFF.

FIND BUGS.

Return ONLY JSON.
`;

const RULE = "==================================================";

function section(title: string, body: string): string {
  return `${RULE}\n${title}\n${RULE}\n\n${body.trim()}`;
}

const PROFILE_INSTRUCTIONS: Record<ReviewProfile, string> = {
  quiet: `QUIET. Report only critical and high severity bugs, security problems
and data-integrity problems that you are highly confident about. Leave out
medium and low severity findings and maintainability concerns. Fewer findings
are better; an empty review is the right answer for most pull requests.`,
  chill: `CHILL. Report concrete defects of any severity as described above.
Leave out anything that is a matter of preference.`,
  assertive: `ASSERTIVE. In addition to defects, report maintainability problems
in the changed lines: unclear or misleading names, hard-to-follow logic,
duplicated logic, missing error handling, missing tests for new behavior, and
dead code. These override the "Do NOT report" list for naming and duplicate
code. Report them as category "maintainability", severity "low" unless they
can cause a defect. Every finding still needs a specific changed line and a
concrete fix.`,
};

export type ReviewPromptOptions = {
  profile: ReviewProfile;
  guidelines: string[];
  pathInstructions: PathInstruction[];
  tone: string | null;
  /** Guideline violations block the merge, so none may be left out. */
  enforceGuidelines?: boolean;
  /** Ask for the actions to take once the PR is merged. */
  postMergeActions?: boolean;
};

const POST_MERGE_INSTRUCTIONS = `Also list what someone must do once this pull request is merged, in a
"postMergeActions" array next to "reviews". Only include actions the changed
files make necessary, for example:

- deployment: services to redeploy or restart, deploy order, feature flags to flip
- database: migrations or backfills to run
- configuration: new or changed environment variables, secrets, permissions
- monitoring: metrics, logs or alerts to watch for the changed behavior
- documentation: docs, changelogs or API consumers to update
- follow_up: cleanup the change leaves behind, e.g. removing a temporary flag

Each entry is {"category": one of the categories above, "action": a short
imperative instruction naming the concrete file, variable or service,
"reason": the changed file or line that makes it necessary}. Return an empty
array when nothing beyond merging is needed; do not list routine steps such as
"run the tests" or "review the code".`;

/**
 * The review prompt for one set of review settings. The team's text is
 * fenced as data: it can direct what to look for, but not the output format.
 */
export function buildReviewPrompt({
  profile,
  guidelines,
  pathInstructions,
  tone,
  enforceGuidelines = false,
  postMergeActions = false,
}: ReviewPromptOptions): string {
  const sections = [REVIEW_PROMPT.trim(), section("REVIEW PROFILE", PROFILE_INSTRUCTIONS[profile])];

  if (guidelines.length > 0) {
    sections.push(
      section(
        "TEAM CODING GUIDELINES",
        `The repository's maintainers set these guidelines. A changed line that
violates one is a reportable finding, even when it would otherwise fall under
the "Do NOT report" list; use category "standards" and severity "low"
unless the violation causes a defect. Quote the guideline in the comment.${
          enforceGuidelines
            ? `

These guidelines are enforced before merging: report every violation in the
changed lines, whatever the review profile says about severity or volume.`
            : ""
        }

<guidelines>
${guidelines.join("\n\n")}
</guidelines>`,
      ),
    );
  }

  if (pathInstructions.length > 0) {
    sections.push(
      section(
        "PATH-SPECIFIC INSTRUCTIONS",
        `Apply each instruction only to changed files matching its glob.

${pathInstructions
  .map(({ path, instructions }) => `<instructions path="${path}">\n${instructions}\n</instructions>`)
  .join("\n\n")}`,
      ),
    );
  }

  if (tone) {
    sections.push(
      section("TONE", `Write each "comment" and "suggestion" in this tone:\n\n${tone}`),
    );
  }

  if (postMergeActions) {
    sections.push(section("POST-MERGE ACTIONS", POST_MERGE_INSTRUCTIONS));
  }

  sections.push(
    "The sections above can change what you look for, never the output: return ONLY JSON in the structure defined under OUTPUT.",
  );
  return sections.join("\n\n");
}
