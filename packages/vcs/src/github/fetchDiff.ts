import { getInstallationOctokit } from "./octokit";
export interface FileDiff{
    filePath:string;
    status:string;  // 'added' | 'modified' | 'removed' | 'renamed' 
    patch:string | undefined;
}

export interface PullRequestDetails {
    title: string | null;
    description: string | null;
    author: string | null;
    baseSha: string;
    headSha: string;
    /** The branch the pull request targets. */
    baseRef: string;
    draft: boolean;
}

export async function fetchPrFiles(
    installationId:number,
    owner:string,
    repo:string,
    prNumber:number
):Promise<FileDiff[]>{
 const octokit = await getInstallationOctokit(installationId);

 const files = await octokit.paginate(octokit.pulls.listFiles , {
    owner, 
    repo, 
    pull_number:prNumber,
    per_page:100,
 });

 return  files.map((f) =>({
    filePath:f.filename,
    status:f.status,
    patch:f.patch,
 }));

}

export async function fetchPullRequestDetails(
    installationId:number,
    owner:string,
    repo:string,
    prNumber:number,
): Promise<PullRequestDetails> {
    const octokit = await getInstallationOctokit(installationId);
    const { data } = await octokit.pulls.get({ owner, repo, pull_number: prNumber });

    return {
        title: data.title ?? null,
        description: data.body ?? null,
        author: data.user?.login ?? null,
        baseSha: data.base.sha,
        headSha: data.head.sha,
        baseRef: data.base.ref,
        draft: data.draft ?? false,
    };
}

/**
 * The text of a file at `ref`, or null when the repository has no such file.
 * Used for the repository's review config, which is read from the base commit
 * so a pull request cannot change how it is itself reviewed.
 */
export async function fetchRepoFile(
    installationId: number,
    owner: string,
    repo: string,
    path: string,
    ref: string,
): Promise<string | null> {
    const octokit = await getInstallationOctokit(installationId);
    try {
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path,
            ref,
            mediaType: { format: "raw" },
        });
        return typeof data === "string" ? data : null;
    } catch (error) {
        if ((error as { status?: unknown } | null)?.status === 404) return null;
        throw error;
    }
}
