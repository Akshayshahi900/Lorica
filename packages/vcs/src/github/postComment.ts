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

/** A hidden tag that identifies the comment a review job posted. */
export function reviewCommentMarker(reviewJobId: number): string {
  return `<!-- lorica-review-job:${reviewJobId} -->`;
}

/**
 * Whether a comment containing `marker` is already on the PR. A retried job
 * checks this so a crash between posting and recording success cannot
 * produce a second copy of the review.
 */
export async function hasPRCommentWithMarker(
  octokit: Octokit,
  {
    owner,
    repo,
    prNumber,
    marker,
  }: {
    owner: string;
    repo: string;
    prNumber: number;
    marker: string;
  },
): Promise<boolean> {
  const comments = await octokit.paginate(octokit.issues.listComments, {
    owner,
    repo,
    issue_number: prNumber,
    per_page: 100,
  });
  return comments.some((comment) => comment.body?.includes(marker));
}
