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

/** Starts every Lorica review comment; identifies the PR's one review comment. */
export const REVIEW_COMMENT_MARKER = "<!-- lorica-review -->";

/** A hidden tag that identifies the review job whose result a comment shows. */
export function reviewCommentMarker(reviewJobId: number): string {
  return `<!-- lorica-review-job:${reviewJobId} -->`;
}

export type PRComment = { id: number; body: string };

/**
 * The PR's Lorica review comment, if one exists: the latest bot comment that
 * starts with `REVIEW_COMMENT_MARKER`. Each new commit's review replaces its
 * body rather than adding another comment.
 */
export async function findReviewComment(
  octokit: Octokit,
  {
    owner,
    repo,
    prNumber,
  }: {
    owner: string;
    repo: string;
    prNumber: number;
  },
): Promise<PRComment | null> {
  const comments = await octokit.paginate(octokit.issues.listComments, {
    owner,
    repo,
    issue_number: prNumber,
    per_page: 100,
  });
  const ours = comments.filter(
    (comment) =>
      comment.user?.type === "Bot" &&
      comment.body?.startsWith(REVIEW_COMMENT_MARKER),
  );
  const latest = ours[ours.length - 1];
  return latest ? { id: latest.id, body: latest.body ?? "" } : null;
}

export async function updatePRComment(
  octokit: Octokit,
  {
    owner,
    repo,
    commentId,
    body,
  }: {
    owner: string;
    repo: string;
    commentId: number;
    body: string;
  },
) {
  const response = await octokit.issues.updateComment({
    owner,
    repo,
    comment_id: commentId,
    body,
  });
  return response.data;
}
