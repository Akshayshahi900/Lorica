export async function postPRComment({
  owner,
  repo,
  prNumber,
  body,
  token,
}: {
  owner: string;
  repo: string;
  prNumber: number;
  body: string;
  token: string;
}) {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2026-03-10",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ body }),
    }
  );

  if (!response.ok) {
    const error = await response.text();

    throw new Error(
      `GitHub comment failed: ${response.status} ${error}`
    );
  }

  return response.json();
}