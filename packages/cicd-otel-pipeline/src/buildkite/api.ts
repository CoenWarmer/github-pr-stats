import { config } from '../config';
import type { BuildkiteApiBuild } from '../types';

/**
 * Fetch Buildkite builds for a specific branch
 * This is used to find builds related to a PR
 */
export async function fetchBuildsForBranch(
  pipelineSlug: string,
  branch: string
): Promise<BuildkiteApiBuild[]> {
  if (!config.buildkiteApiToken) {
    console.warn('[Buildkite] API token not configured, skipping build fetch');
    return [];
  }

  if (!config.buildkiteOrganization) {
    console.warn('[Buildkite] Organization not configured');
    return [];
  }

  try {
    const url = `https://api.buildkite.com/v2/organizations/${config.buildkiteOrganization}/pipelines/${pipelineSlug}/builds?branch=${encodeURIComponent(branch)}&per_page=10`;

    console.log(
      `[Buildkite] Trying pipeline: ${config.buildkiteOrganization}/${pipelineSlug} for branch: ${branch}`
    );

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${config.buildkiteApiToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        console.log(`[Buildkite] Pipeline not found: ${pipelineSlug}`);
      } else {
        console.warn(
          `[Buildkite] API error: ${response.status} ${response.statusText} for ${pipelineSlug}`
        );
      }
      return [];
    }

    const builds = (await response.json()) as BuildkiteApiBuild[];
    return builds;
  } catch (error: any) {
    console.error('[Buildkite] Error fetching builds:', error.message);
    return [];
  }
}

/**
 * Fetch Buildkite builds for a specific commit SHA
 * This is more reliable than querying by branch as it searches across all pipelines
 */
export async function fetchBuildsForCommit(
  commitSha: string
): Promise<BuildkiteApiBuild[]> {
  if (!config.buildkiteApiToken) {
    console.warn('[Buildkite] API token not configured');
    return [];
  }

  if (!config.buildkiteOrganization) {
    console.warn('[Buildkite] Organization not configured');
    return [];
  }

  try {
    // Fetch all builds for the organization, filtered by commit
    const url = `https://api.buildkite.com/v2/organizations/${config.buildkiteOrganization}/builds?commit=${commitSha}&per_page=100`;

    console.log(
      `[Buildkite] Fetching builds for commit: ${commitSha.substring(0, 8)}`
    );

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${config.buildkiteApiToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.warn(
        `[Buildkite] API error: ${response.status} ${response.statusText} for commit ${commitSha.substring(0, 8)}`
      );
      return [];
    }

    const builds = (await response.json()) as BuildkiteApiBuild[];
    console.log(
      `[Buildkite] Found ${builds.length} builds for commit ${commitSha.substring(0, 8)}`
    );
    return builds;
  } catch (error: any) {
    console.error(
      '[Buildkite] Error fetching builds for commit:',
      error.message
    );
    return [];
  }
}

/**
 * Fetch Buildkite builds for a PR by checking multiple pipeline patterns
 * Falls back to commit SHA search if available
 */
export async function fetchBuildsForPR(
  repository: string,
  prBranch: string,
  prNumber: number,
  headCommitSha?: string
): Promise<BuildkiteApiBuild[]> {
  // Prefer commit SHA lookup if available (more reliable)
  if (headCommitSha) {
    return fetchBuildsForCommit(headCommitSha);
  }

  // Fallback to branch-based search
  const [owner, repo] = repository.split('/');

  const pipelinePatterns = [
    `${repo}-pull-request`, // e.g., "kibana-pull-request"
    `${owner}-${repo}-pull-request`,
    `${repo}`,
    repo.toLowerCase(),
  ];

  const allBuilds: BuildkiteApiBuild[] = [];

  for (const pattern of pipelinePatterns) {
    const builds = await fetchBuildsForBranch(pattern, prBranch);

    // Filter to only builds that are actually for this PR
    const relevantBuilds = builds.filter(build => {
      // Check if build is for this PR via branch name match
      if (build.branch === prBranch) return true;

      return false;
    });

    allBuilds.push(...relevantBuilds);
  }

  // Deduplicate by build ID
  const uniqueBuilds = Array.from(
    new Map(allBuilds.map(build => [build.id, build])).values()
  );

  return uniqueBuilds;
}
