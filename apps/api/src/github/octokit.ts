import {App} from '@octokit/app';
import { Octokit } from '@octokit/rest';

import fs from 'fs';

const appId = process.env.GITHUB_APP_ID!;
const privateKey = fs.readFileSync(process.env.GITHUB_APP_PRIVATE_KEY_PATH! , 'utf-8');

const githubApp = new App({appId , privateKey});

export async function getInstallationOctokit(installationId:number):Promise<Octokit>{
    const octokit = await githubApp.getInstallationOctokit(installationId);
    return octokit as unknown as Octokit; 
}