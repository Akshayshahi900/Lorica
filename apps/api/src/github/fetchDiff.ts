import { getInstallationOctokit } from "./octokit";
export interface FileDiff{
    filePath:string;
    status:string;  // 'added' | 'modified' | 'removed' | 'renamed' 
    patch:string | undefined;
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