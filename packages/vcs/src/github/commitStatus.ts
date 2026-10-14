import { Octokit } from "@octokit/rest";

/** The commit status branch protection requires to enforce Lorica's merge gate. */
export const MERGE_GATE_CONTEXT = "Lorica";

export type MergeGateState = "pending" | "success" | "failure" | "error";

/** GitHub truncates nothing for us: a description over 140 characters is rejected. */
const MAX_DESCRIPTION = 140;

export async function setCommitStatus(
  octokit: Octokit,
  {
    owner,
    repo,
    sha,
    state,
    description,
    targetUrl,
  }: {
    owner: string;
    repo: string;
    sha: string;
    state: MergeGateState;
    description: string;
    targetUrl?: string;
  },
) {
  const text =
    description.length > MAX_DESCRIPTION
      ? `${description.slice(0, MAX_DESCRIPTION - 1)}…`
      : description;
  await octokit.repos.createCommitStatus({
    owner,
    repo,
    sha,
    state,
    context: MERGE_GATE_CONTEXT,
    description: text,
    ...(targetUrl && { target_url: targetUrl }),
  });
}
