import { Octokit } from '@octokit/rest';
import { config } from './config.js';

// Initialize Octokit for GitHub API calls
export const octokit = config.githubToken
  ? new Octokit({ auth: config.githubToken })
  : null;

if (!octokit) {
  console.warn(
    'No GITHUB_TOKEN configured - team and CODEOWNERS enrichment will be disabled'
  );
} else {
  console.log('✓ GitHub client initialized with token');
}
