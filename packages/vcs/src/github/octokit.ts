import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import fs from 'fs';
import path from 'path';

const appId = process.env.GITHUB_APP_ID!;
const configuredPrivateKeyPath = process.env.GITHUB_PRIVATE_KEY_PATH;

if (!configuredPrivateKeyPath) {
  throw new Error('GITHUB_PRIVATE_KEY_PATH is not configured');
}

// Root `pnpm dev` loads the repository .env and sets LORICA_ROOT. This keeps
// relative paths stable even when this workspace package is imported by an app.
const privateKeyPath = path.isAbsolute(configuredPrivateKeyPath)
  ? configuredPrivateKeyPath
  : path.resolve(process.env.LORICA_ROOT ?? process.cwd(), configuredPrivateKeyPath);

if (!fs.existsSync(privateKeyPath)) {
  throw new Error(`GitHub App private key file was not found: ${privateKeyPath}`);
}

const privateKey = fs.readFileSync(privateKeyPath, 'utf-8');

export async function getInstallationOctokit(installationId: number): Promise<Octokit> {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId,
      privateKey,
      installationId,
    },
  });
}

/** Returns a short-lived token suitable for an authenticated, non-logged git clone. */
export async function getInstallationAccessToken(installationId: number): Promise<string> {
  const octokit = await getInstallationOctokit(installationId);
  // Octokit's App auth strategy requires an explicit auth type when auth() is
  // invoked directly. Ordinary REST requests work from the constructor's
  // defaults, which is why fetchPrFiles succeeded while this token path did not.
  const authentication = await octokit.auth({
    type: "installation",
    installationId,
  }) as { token?: unknown };
  if (!("token" in authentication) || typeof authentication.token !== "string") {
    throw new Error("GitHub installation authentication did not return a token");
  }
  return authentication.token;
}
