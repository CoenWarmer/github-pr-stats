import { Octokit } from '@octokit/rest';
import { ReviewTiming, TimelineEvent } from '../types';
import { logger } from '../logger';

/**
 * Service for handling PR review timings and team memberships
 */
export class ReviewService {
  private octokit: Octokit;

  constructor(octokit: Octokit) {
    this.octokit = octokit;
  }

  /**
   * Get review timings for a PR
   */
  async getReviewTimings(
    owner: string,
    repo: string,
    prNumber: number,
    prCreatedAt: string,
    authorTeams: string[],
    requestedTeams: string[] = [],
    timelineEvents: TimelineEvent[] = []
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

        // Extract all teams that were ever requested from timeline events
        const allRequestedTeams = [
          ...new Set([
            ...requestedTeams,
            ...timelineEvents
              .filter(e => e.type === 'team_review_requested')
              .map(e => e.requested_team)
              .filter((team): team is string => Boolean(team)),
          ]),
        ];

        // Get reviewer teams
        const reviewerTeams = await this.getReviewerTeams(
          review.user.login,
          owner,
          allRequestedTeams
        );

        const reviewUrl = `https://github.com/${owner}/${repo}/pull/${prNumber}#pullrequestreview-${review.id}`;

        reviewTimings.push({
          state: review.state,
          reviewer: review.user.login,
          submitted_at: review.submitted_at,
          time_to_review_hours: Math.round(timeToReviewHours * 100) / 100,
          author_teams: authorTeams,
          reviewer_teams: reviewerTeams,
          author_reviewer_relationship: 'cross-department',
          url: reviewUrl,
          review_id: review.id,
          body: review.body || undefined,
        });

        await new Promise(resolve => setTimeout(resolve, 50));
      }

      return reviewTimings;
    } catch (error) {
      logger.error('Error fetching review timings', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Get teams for a user
   */
  async getUserTeams(
    username: string,
    org: string,
    repo: string
  ): Promise<string[]> {
    try {
      const repoTeams = await this.octokit.paginate(
        'GET /repos/{owner}/{repo}/teams',
        { owner: org, repo }
      );

      const userTeams: string[] = [];
      for (const team of repoTeams) {
        try {
          await this.octokit.rest.teams.getMembershipForUserInOrg({
            org,
            team_slug: team.slug,
            username,
          });
          userTeams.push(team.slug);
        } catch {
          // User not in this team
        }
      }

      return userTeams;
    } catch (error) {
      logger.warn('Could not fetch user teams', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Get reviewer teams based on requested teams
   */
  async getReviewerTeams(
    reviewer: string,
    owner: string,
    requestedTeams: string[]
  ): Promise<string[]> {
    const reviewerTeams: string[] = [];

    for (const teamSlug of requestedTeams) {
      try {
        await this.octokit.rest.teams.getMembershipForUserInOrg({
          org: owner,
          team_slug: teamSlug,
          username: reviewer,
        });
        reviewerTeams.push(teamSlug);
      } catch {
        // User not in this team
      }
    }

    return reviewerTeams;
  }
}
