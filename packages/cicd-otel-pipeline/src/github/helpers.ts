import { octokit } from '../octokit.js';
import type { CodeownersRule, CodeownersData, FileDetail } from '../types.js';

export async function getUserTeams(
  org: string,
  username: string
): Promise<string[]> {
  if (!octokit) return [];

  try {
    const { data: teams } = await octokit.rest.teams.listForAuthenticatedUser();
    return teams
      .filter(team => team.organization.login === org)
      .map(team => team.slug);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Error fetching teams for ${username}:`, message);
    return [];
  }
}

export function parseCodeowners(content: string): CodeownersRule[] {
  const lines = content.split('\n');
  const rules: CodeownersRule[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) continue;

    const pattern = parts[0];
    const owners = parts.slice(1).map(owner => {
      return owner.startsWith('@') ? owner.substring(1) : owner;
    });

    rules.push({ pattern, owners });
  }

  return rules;
}

export function matchCodeowners(
  filePath: string,
  rules: CodeownersRule[]
): string[] {
  const owners = new Set<string>();

  for (const rule of rules) {
    let { pattern } = rule;

    pattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');

    const regex = new RegExp(`^${pattern}$`);

    if (regex.test(filePath) || regex.test('/' + filePath)) {
      rule.owners.forEach(owner => owners.add(owner));
    }
  }

  return Array.from(owners);
}

export async function getCodeownersForPR(
  owner: string,
  repo: string,
  prNumber: number
): Promise<CodeownersData> {
  if (!octokit) return {};

  try {
    let codeownersContent: string | undefined;
    const possiblePaths = [
      '.github/CODEOWNERS',
      'CODEOWNERS',
      'docs/CODEOWNERS',
    ];

    for (const path of possiblePaths) {
      try {
        const { data } = await octokit.rest.repos.getContent({
          owner,
          repo,
          path,
        });

        if ('content' in data && data.content) {
          codeownersContent = Buffer.from(data.content, 'base64').toString(
            'utf-8'
          );
          break;
        }
      } catch {
        continue;
      }
    }

    const rules = codeownersContent ? parseCodeowners(codeownersContent) : [];

    const { data: files } = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: prNumber,
    });

    const fileDetails: FileDetail[] = [];
    const allOwners = new Set<string>();

    for (const file of files) {
      const owners = matchCodeowners(file.filename, rules);
      owners.forEach(owner => allOwners.add(owner));

      fileDetails.push({
        filename: file.filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        changes: file.changes,
        patch: file.patch,
        owners: owners,
      });
    }

    return {
      fileDetails,
      allOwners: Array.from(allOwners),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error fetching CODEOWNERS:', message);
    return {};
  }
}

export function extractPRNumber(
  message: string,
  branch: string
): number | null {
  // Try to find PR number in commit message like "Merge pull request #123"
  const commitMatch = message.match(/(?:pull request|PR)\s*#(\d+)/i);
  if (commitMatch) return parseInt(commitMatch[1]);

  // Try to find PR number in branch name like "pr-123" or "123-feature"
  const branchMatch = branch.match(/(?:pr[-_]?|^)(\d+)/i);
  if (branchMatch) return parseInt(branchMatch[1]);

  return null;
}
