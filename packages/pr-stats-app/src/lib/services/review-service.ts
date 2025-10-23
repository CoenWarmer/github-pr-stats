import { Octokit } from '@octokit/rest';
import { AuthorReviewerRelationship, ReviewTiming } from '../types';
import { logger } from '../logger';

/**
 * Cache structure for user team memberships
 */
export interface UserTeamCache {
  userTeams: Map<string, string[]>; // username -> teams
  org: string;
  lastFetchTime: number;
}

/**
 * Service for handling PR review timings and team memberships
 */
export class ReviewService {
  private octokit: Octokit;

  constructor(octokit: Octokit) {
    this.octokit = octokit;
  }

  /**
   * Build a cache of user team memberships for efficient lookup
   * This should be called once at the start of a batch job
   */
  async buildUserTeamCache(
    usernames: string[],
    org: string
  ): Promise<UserTeamCache> {
    try {
      logger.info(
        `Building user team cache for ${usernames.length} users in ${org}`
      );

      const cache = new Map<string, string[]>();

      // Fetch teams for all users
      for (const username of usernames) {
        try {
          const teams = await this.getUserTeams(username, org);
          cache.set(username, teams);
          logger.debug(`Cached teams for ${username}: ${teams.join(', ')}`);
        } catch (error) {
          logger.warn(`Failed to get teams for ${username}`, {
            error: error instanceof Error ? error.message : String(error),
          });
          cache.set(username, []); // Cache empty array on error
        }
      }

      logger.info(
        `User team cache built successfully with ${cache.size} users`
      );

      return {
        userTeams: cache,
        org,
        lastFetchTime: Date.now(),
      };
    } catch (error) {
      logger.error('Error building user team cache', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        userTeams: new Map(),
        org,
        lastFetchTime: Date.now(),
      };
    }
  }

  /**
   * Get user teams from cache if available, otherwise fetch from API
   */
  async getUserTeamsWithCache(
    username: string,
    org: string,
    cache?: UserTeamCache
  ): Promise<string[]> {
    if (cache && cache.org === org && cache.userTeams.has(username)) {
      logger.debug(`User teams cache hit for ${username}`);
      return cache.userTeams.get(username)!;
    }

    // Cache miss - fetch from API
    logger.debug(`User teams cache miss for ${username}, fetching from API`);
    return this.getUserTeams(username, org);
  }

  /**
   * Get review timings for a PR
   * @param userTeamCache Optional pre-built cache for batch processing
   */
  async getReviewTimings(
    owner: string,
    repo: string,
    prNumber: number,
    prCreatedAt: string,
    authorTeams: string[],
    codeOwnerTeams: string[] = [],
    userTeamCache?: UserTeamCache
  ): Promise<ReviewTiming[]> {
    try {
      const { data: reviews } = await this.octokit.rest.pulls.listReviews({
        owner,
        repo,
        pull_number: prNumber,
        per_page: 100,
      });

      const reviewTimings: ReviewTiming[] = [];
      const prCreatedDate = new Date(prCreatedAt);

      for (const review of reviews) {
        if (!review.submitted_at || !review.user?.login) {
          continue;
        }

        const submittedDate = new Date(review.submitted_at);
        const timeToReviewHours =
          (submittedDate.getTime() - prCreatedDate.getTime()) /
          (1000 * 60 * 60);

        const allReviewerTeams = await this.getUserTeamsWithCache(
          review.user.login,
          owner,
          userTeamCache
        );

        // Filter to only include teams that are code owners for this PR
        const reviewerTeams = allReviewerTeams.filter(team =>
          codeOwnerTeams.includes(team)
        );

        const reviewUrl = `https://github.com/${owner}/${repo}/pull/${prNumber}#pullrequestreview-${review.id}`;

        // If reviewer is in multiple code owner teams, create a separate entry for each team
        if (reviewerTeams.length > 0) {
          for (const team of reviewerTeams) {
            reviewTimings.push({
              state: review.state,
              reviewer: review.user.login,
              submitted_at: review.submitted_at,
              time_to_review_hours: Math.round(timeToReviewHours * 100) / 100,
              reviewer_teams: [team],
              author_reviewer_relationship: this.getAuthorReviewerRelationship(
                authorTeams,
                team
              ),
              url: reviewUrl,
              review_id: review.id,
              body: review.body || undefined,
            });
          }
        } else {
          // If reviewer is not in any teams, create a single entry with empty teams
          reviewTimings.push({
            state: review.state,
            reviewer: review.user.login,
            submitted_at: review.submitted_at,
            time_to_review_hours: Math.round(timeToReviewHours * 100) / 100,
            reviewer_teams: ['additional_reviewers'],
            author_reviewer_relationship: this.getAuthorReviewerRelationship(
              authorTeams,
              'additional_reviewers'
            ),
            url: reviewUrl,
            review_id: review.id,
            body: review.body || undefined,
          });
        }
      }

      return reviewTimings;
    } catch (error) {
      logger.error('Error fetching review timings', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  getAuthorReviewerRelationship(
    authorTeams: string[],
    reviewerTeam: string
  ): AuthorReviewerRelationship {
    if (authorTeams.includes(reviewerTeam)) {
      return 'same_team';
    }

    if (reviewerTeam === 'additional_reviewers') {
      return 'additional_reviewer';
    }

    // Check for intra-department: teams share a common prefix (e.g., "obs-", "security-")
    // Extract department prefix from reviewer team (everything before the second hyphen)
    const reviewerDeptMatch = reviewerTeam.match(
      /^([a-z0-9]+(?:-[a-z0-9]+)?)-/
    );
    if (reviewerDeptMatch) {
      const reviewerDept = reviewerDeptMatch[1];

      // Check if any author team starts with the same department prefix
      const hasCommonDepartment = authorTeams.some(authorTeam => {
        const authorDeptMatch = authorTeam.match(
          /^([a-z0-9]+(?:-[a-z0-9]+)?)-/
        );
        return authorDeptMatch && authorDeptMatch[1] === reviewerDept;
      });

      if (hasCommonDepartment) {
        return 'intra_department';
      }
    }

    return 'cross_department';
  }

  /**
   * Get teams for a user
   */
  async getUserTeams(username: string, org: string): Promise<string[]> {
    const query = `
    query($org: String!, $username: String!, $cursor: String) {
      organization(login: $org) {
        teams(first: 100, after: $cursor, userLogins: [$username]) {
          nodes {
            name
            slug
            description
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  `;

    const allTeams = [];
    let hasNextPage = true;
    let cursor = null;

    while (hasNextPage) {
      const result = (await this.octokit.graphql(query, {
        org,
        username,
        cursor: cursor,
      })) as {
        organization: {
          teams: {
            nodes: { name: string; slug: string; description: string }[];
            pageInfo: { hasNextPage: boolean; endCursor: string };
          };
        };
      };

      allTeams.push(...result.organization.teams.nodes);
      hasNextPage = result.organization.teams.pageInfo.hasNextPage;
      cursor = result.organization.teams.pageInfo.endCursor;
    }

    return allTeams.map(team => team.slug);
  }
}
