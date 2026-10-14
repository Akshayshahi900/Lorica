# Context assembler and synchronized PR graph review

## Outcome

The reviewer no longer sends an unstructured diff directly to Ollama. It now
builds one validated `ReviewContext` that contains PR metadata, reviewable
patches, and a deliberately bounded set of Neo4j relationship traces. This
lets the model explain bugs whose effect crosses file or symbol boundaries,
while still requiring every finding to identify a changed line.

## Lifecycle

```text
pull_request webhook
  -> queued review job
  -> GitHub reads current PR metadata + changed-file patches
  -> clone exact head SHA with GitHub installation token
  -> re-index PR-specific graph in Neo4j
  -> retrieve one-hop traces for changed files/symbols
  -> assemble and validate ReviewContext
  -> Ollama structured review request
  -> validate ReviewResult and post GitHub comment
```

The graph is stored under `https://github.com/<owner>/<repo>.git#pull/<number>`.
That makes a PR graph independent from the default branch and from other PRs.
The installation token is used only in the clone URL and is never persisted,
logged, or used as the Neo4j repository key.

## Fresh vs synchronized pull requests

GitHub `opened` and `reopened` events are represented as `event: "fresh"`.
They create the first PR-specific graph at the current head SHA before review.

GitHub `synchronize` events are represented as `event: "synchronize"`. Before
the context is assembled, the worker clones the new head SHA, replaces the
existing PR graph, and only then queries relationships. Consequently a queued
review never mixes an old graph snapshot with a new PR diff. The worker uses
the SHA returned by `pulls.get`, rather than trusting a possibly stale queued
payload.

## Locked input contract

`packages/types/src/types.ts` defines the Zod schemas and inferred types:

- `PrMetadataSchema`
- `ChangedFileSchema`
- `GraphTraceSchema`
- `ReviewContextSchema`
- `ReviewResultSchema`

`packages/context/src/reviewContext.ts` is the pure assembly boundary. Its
`assembleReviewContext` function parses its output with `ReviewContextSchema`;
invalid adapter data cannot reach the model.

The model input has this shape:

```json
{
  "schemaVersion": "1",
  "pullRequest": {
    "repository": "owner/repo",
    "number": 42,
    "title": "...",
    "description": "...",
    "author": "...",
    "baseSha": "...",
    "headSha": "...",
    "event": "fresh"
  },
  "changedFiles": [{ "filePath": "src/x.ts", "status": "modified", "patch": "@@ ..." }],
  "graph": {
    "indexedCommit": "...",
    "traces": [{
      "changedFile": "src/x.ts",
      "symbol": "handler",
      "direction": "depends_on",
      "relationship": "CALLS",
      "relatedFile": "src/y.ts",
      "relatedSymbol": "validate",
      "evidence": "src/x.ts uses validate via CALLS"
    }]
  }
}
```

Only patched files are included. GitHub statuses outside the four stable
statuses are normalized to `changed`. The graph query is capped at 250 rows
and considers only `IMPORTS`, `CALLS`, `EXTENDS`, `IMPLEMENTS`, and `USES`;
the entire code graph is never pasted into the prompt.

## Ollama output contract and prompt policy

Ollama receives `z.toJSONSchema(ReviewResultSchema)` through its `format`
parameter. The response content is parsed with `ReviewResultSchema` before it
can be rendered as a GitHub comment. The revised system prompt instructs the
model that graph traces can prove impact beyond an isolated diff, but a review
finding must still target an added or modified line and must not invent
behavior or report unrelated pre-existing defects.

## Files changed

| File | Responsibility |
| --- | --- |
| `apps/worker/src/diff.worker.ts` | Fetches PR metadata/diff, refreshes the exact-SHA graph, assembles context, and calls Ollama. |
| `apps/worker/src/codeIndex.worker.ts` | Exposes exact-SHA clone/index refresh for review jobs and index jobs. |
| `apps/worker/src/neo4j.ts` | Reads bounded, typed graph traces for changed paths. |
| `packages/context/src/reviewContext.ts` | Pure, validated context assembly. |
| `packages/types/src/types.ts` | Zod input and graph-trace schemas. |
| `packages/vcs/src/github/fetchDiff.ts` | Retrieves authoritative PR metadata. |
| `packages/vcs/src/github/octokit.ts` | Retrieves a short-lived installation clone token. |
| `packages/llm/src/client.ts`, `prompt.ts` | Sends the structured context and uses the stricter evidence policy. |

## Verification

`tsc -p apps/worker/tsconfig.json --noEmit` and
`tsc -p apps/api/tsconfig.json --noEmit` pass. End-to-end graph refresh still
requires configured GitHub App credentials, Neo4j, Redis, and Ollama.
