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
    };
}
