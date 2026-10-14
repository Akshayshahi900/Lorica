import type { Session } from "next-auth";

/** A GitHub account whose review settings the signed-in user may change. */
export type SettingsAccount = {
  login: string;
  type: "user" | "organization";
  avatarUrl: string | null;
};

type SessionWithGitHub = Session & { login?: string; accessToken?: string };

const GITHUB_LOGIN = /^[a-z\d](?:[a-z\d-]{0,38})$/i;

async function github<T>(accessToken: string, path: string): Promise<T | null> {
  const response = await fetch(`https://api.github.com${path}`, {
    cache: "no-store",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) return null;
  return (await response.json()) as T;
}

type OrgMembership = {
  state: string;
  role: string;
  organization: { login: string; avatar_url?: string };
};

/**
 * The user's own account plus every organisation they administer: org
 * settings apply to all of its repositories, so only admins may change them.
 */
export async function settingsAccounts(session: Session | null): Promise<SettingsAccount[]> {
  const { login, accessToken, user } = (session ?? {}) as SessionWithGitHub;
  if (!login) return [];
  const accounts: SettingsAccount[] = [
    { login, type: "user", avatarUrl: user?.image ?? null },
  ];
  if (!accessToken) return accounts;

  const memberships =
    (await github<OrgMembership[]>(accessToken, "/user/memberships/orgs?state=active&per_page=100")) ?? [];
  for (const membership of memberships) {
    if (membership.role !== "admin") continue;
    accounts.push({
      login: membership.organization.login,
      type: "organization",
      avatarUrl: membership.organization.avatar_url ?? null,
    });
  }
  return accounts;
}

/**
 * The owner whose settings a request may act on: the user's own login, or an
 * organisation GitHub confirms they are an active admin of. Null otherwise.
 */
export async function authorizeSettingsOwner(
  session: Session | null,
  requested: string | null,
): Promise<string | null> {
  const { login, accessToken } = (session ?? {}) as SessionWithGitHub;
  if (!login) return null;
  if (!requested || requested.toLowerCase() === login.toLowerCase()) return login;
  if (!accessToken || !GITHUB_LOGIN.test(requested)) return null;

  const membership = await github<OrgMembership>(
    accessToken,
    `/user/memberships/orgs/${encodeURIComponent(requested)}`,
  );
  return membership?.state === "active" && membership.role === "admin"
    ? membership.organization.login
    : null;
}
