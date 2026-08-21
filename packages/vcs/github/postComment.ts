import { Octokit } from "@octokit/rest";



export async function postPRComment(
  octokit:Octokit,{
    owner , 
    repo, 
    prNumber,
    body,
  }:{
    owner :string;
    repo:string;
    prNumber:number;
    body:string;
  }
){
  const response = await octokit.issues.createComment({
    owner,
    repo, 
    issue_number:prNumber,
    body,
  });

  return response.data; 
}