# Review settings

How to tune what Lorica reports and when it reviews. Back to the [README](../README.md).

Each account (a user, or an organization its admins manage) configures reviews under **Settings → Review settings** in the dashboard. A repository can add to them with a `.lorica.yaml` (or `.lorica.yml`) at its root.

## Profiles

Profiles set the reviewer's posture:

| Profile | Reports | Default floor / cap |
| --- | --- | --- |
| `quiet` | Only high-confidence critical and high severity bugs and security issues. | `high` / 5 |
| `chill` | Concrete defects of any severity; no style or preference comments. The default. | `low` / 20 |
| `assertive` | Defects plus maintainability: naming, readability, duplication, missing tests, dead code. | `low` / 40 |

The severity floor and finding cap are enforced after the model answers, so they hold whatever the model returns; the review summary says how many findings were hidden.

## `.lorica.yaml` reference

```yaml
# .lorica.yaml
profile: assertive
guidelines: |
  - Use the shared logger, never console.log, in services.
  - Every database query goes through the repository layer.
pathInstructions:
  - path: "src/api/**"
    instructions: Every handler validates its input with zod and checks permissions.
excludePaths: ["**/*.test.ts", "migrations/**"]   # on top of lockfiles, generated, vendored, binaries
tone: Brief and friendly.
workflow:
  autoReview: true            # false: this repository is not reviewed
  reviewDrafts: false         # drafts are reviewed when marked ready for review
  reviewOnPush: true          # false: only opened, reopened and ready-for-review
  baseBranches: ["main", "release/*"]   # empty: any base branch
  ignoreTitleKeywords: ["WIP", "[skip review]"]
  ignoreAuthors: ["dependabot[bot]"]
style:
  minSeverity: medium         # defaults to the profile's
  maxFindings: 10             # defaults to the profile's
  fixPrompt: true             # the copyable "fix with your AI assistant" prompt
  postMergeActions: true      # the "After merging" checklist
mergeGate:
  enabled: true               # set the "Lorica" commit status
  blockOn: high               # critical | high | medium | low | none
  enforceGuidelines: true     # any guideline violation blocks merging
```

## Behavior

- **Layering:** the repository file is applied over the account's dashboard settings. `guidelines`, `pathInstructions`, `excludePaths`, `ignoreTitleKeywords` and `ignoreAuthors` add up, so a repository extends its organization's standards; every other value is overridden. The dashboard shows the saved settings as a `.lorica.yaml` to commit.
- **Read from the base commit:** the file is read at the pull request's base SHA, so a change to `.lorica.yaml` applies after it merges, and a pull request cannot loosen or switch off its own review.
- **Errors don't block reviews:** an invalid file (bad YAML, unknown key, wrong value) is ignored and the review comment says why.
- **Skipped pull requests** complete without a comment; the dashboard shows them as `skipped` with the reason. A draft skipped by `reviewDrafts: false` is reviewed when it is marked ready for review.
- **Organizations:** only active admins of an organization (checked with GitHub when the dashboard reads or saves) can change its settings. The GitHub OAuth app needs access to the organization for it to be listed.

## Merge gate

Each reviewed head commit gets a `Lorica` commit status:

- `pending` while the review runs
- `failure` when the review shows a finding at or above `blockOn`, or (with `enforceGuidelines`) a coding-guideline violation
- `success` otherwise

Add `Lorica` as a required status check in the branch protection rules to block merging until it passes; pushing a fix triggers a new review. Pull requests the workflow settings skip get `success`, and a review that fails for good gets `error`, so a required check never stays pending. Enforced guideline violations (category `standards`) are always shown, whatever the profile's severity floor or finding cap.

## Post-merge actions

The model lists what the change makes necessary once merged (migrations to run, environment variables to set, services to redeploy, metrics to watch, docs to update, temporary code to remove), shown as an "After merging" checklist in the comment.

## The review comment

Lorica keeps one structured summary comment on each PR. The first review posts it; every later commit's review edits that same comment in place, so the PR always shows the review of its latest commit without piling up a comment per push. Earlier reviews remain in the comment's GitHub edit history.
