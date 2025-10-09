/* eslint-disable @typescript-eslint/no-explicit-any */
import { Octokit } from '@octokit/rest';
import { logger } from '../logger';

/**
 * Service for detecting releases containing specific commits
 */
export class ReleaseService {
  private octokit: Octokit;

  constructor(octokit: Octokit) {
    this.octokit = octokit;
  }

  /**
   * Find the first 3 releases published after PR merge that contain the commit
   */
  async getFirstReleasesForCommit(
    owner: string,
    repo: string,
    commitSha: string,
    prMergedAt: string
  ): Promise<
    Array<{
      tag_name: string;
      published_at: string;
      html_url: string;
    }>
  > {
    try {
      const mergedDate = new Date(prMergedAt);

      const { data: releases } = await this.octokit.rest.repos.listReleases({
        owner,
        repo,
        per_page: 100, // Increased to get more releases
      });

      logger.debug(
        `Searching for first release after ${mergedDate.toISOString()} containing commit ${commitSha.substring(0, 8)}`
      );

      // Filter releases published after PR merge and sort chronologically
      const releasesAfterMerge = releases
        .filter(release => {
          if (!release.published_at) return false;
          const releaseDate = new Date(release.published_at);
          return releaseDate >= mergedDate;
        })
        .sort((a, b) => {
          const dateA = new Date(a.published_at!).getTime();
          const dateB = new Date(b.published_at!).getTime();
          return dateA - dateB; // Earliest first
        });

      if (releasesAfterMerge.length === 0) {
        logger.debug('No releases found after PR merge date');
        return [];
      }

      logger.debug(
        `Found ${releasesAfterMerge.length} releases after merge, checking in chronological order`
      );

      // Check releases in chronological order and collect the first 3 that contain the commit
      const releasesContainingCommit: Array<{
        tag_name: string;
        published_at: string;
        html_url: string;
      }> = [];

      for (const release of releasesAfterMerge) {
        try {
          logger.debug(
            `Checking if release ${release.tag_name} (${release.published_at}) contains commit`
          );

          const { data: comparison } =
            await this.octokit.rest.repos.compareCommitsWithBasehead({
              owner,
              repo,
              basehead: `${commitSha}...${release.tag_name}`,
            });

          logger.debug(
            `Comparison ${commitSha.substring(0, 8)}...${release.tag_name}: status=${comparison.status}, ahead=${comparison.ahead_by}, behind=${comparison.behind_by}`
          );

          // If commit is behind or identical to the release tag, the release contains the commit
          // For "diverged" status with behind_by > 0, the release has commits after our commit
          if (
            comparison.status === 'behind' ||
            comparison.status === 'identical' ||
            (comparison.status === 'diverged' && comparison.behind_by > 0)
          ) {
            releasesContainingCommit.push({
              tag_name: release.tag_name,
              published_at: release.published_at!,
              html_url: release.html_url,
            });

            // Stop after finding 3 releases
            if (releasesContainingCommit.length >= 3) {
              break;
            }
          }
        } catch (compareError) {
          logger.debug(
            `Could not compare commit with release ${release.tag_name}`,
            {
              error:
                compareError instanceof Error
                  ? compareError.message
                  : String(compareError),
            }
          );
          continue;
        }
      }

      if (releasesContainingCommit.length === 0) {
        logger.debug(
          `No releases found containing commit ${commitSha.substring(0, 8)}`
        );
        return [];
      }

      // Log all releases containing the commit
      logger.info(
        `Found ${releasesContainingCommit.length} release(s) containing commit ${commitSha.substring(0, 8)}:`,
        releasesContainingCommit.map(
          (r, i) => `${i + 1}. ${r.tag_name} (published ${r.published_at})`
        )
      );

      // Return all found releases (up to 3)
      return releasesContainingCommit;
    } catch (error) {
      logger.warn('Error fetching releases for commit', {
        error: error instanceof Error ? error.message : String(error),
        commitSha: commitSha.substring(0, 8),
      });
      return [];
    }
  }

  /**
   * Get releases for a PR with a timeout to prevent hanging on large repos
   */
  async getReleasesForPR(
    owner: string,
    repo: string,
    commitSha: string | undefined,
    mergedAt: string | null
  ): Promise<Array<any>> {
    if (!mergedAt || !commitSha) {
      return [];
    }

    try {
      logger.debug(`Checking releases for ${commitSha.substring(0, 8)}`);

      return await Promise.race([
        this.getFirstReleasesForCommit(owner, repo, commitSha, mergedAt),
        new Promise<Array<any>>(resolve =>
          setTimeout(() => resolve([]), 10000)
        ), // 10 second timeout
      ]);
    } catch (releaseError) {
      logger.warn('Error fetching release information', {
        error:
          releaseError instanceof Error
            ? releaseError.message
            : String(releaseError),
      });
      return [];
    }
  }
}
