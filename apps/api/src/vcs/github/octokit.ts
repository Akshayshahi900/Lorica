import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import fs from 'fs';

const appId = process.env.GITHUB_APP_ID!;
const privateKey = fs.readFileSync(process.env.GITHUB_PRIVATE_KEY_PATH!, 'utf-8');

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