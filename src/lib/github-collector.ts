import { Octokit } from '@octokit/rest';
import {
  TimelineEvent,
  ReviewTiming,
  LinkedIssue,
  IssueLifecycleEvent,
} from './types';
import { logger } from './logger';

export class GitHubCollector {
  public octokit: Octokit;

  constructor(token?: string) {
    this.octokit = new Octokit({
      auth: token || process.env.GITHUB_TOKEN,
      userAgent: 'pr-stats-app/1.0.0',
    });
  }

  private isWildcardPattern(pattern: string): boolean {
    return (
      pattern.includes('*') || pattern.includes('?') || pattern.includes('[')
    );
  }

  private matchesPattern(file: string, pathPattern: string): boolean {
    if (this.isWildcardPattern(pathPattern)) {
      const regex = new RegExp(
        pathPattern.replace(/\*/g, '.*').replace(/\?/g, '.')
      );
      return regex.test(file);
    }
    return file === pathPattern || file.startsWith(pathPattern + '/');
  }

  async buildPRTimeline(
    owner: string,
    repo: string,
    prNumber: number,
    prData: any,
    reviewTimings: ReviewTiming[],
    linkedIssues?: LinkedIssue[]
  ): Promise<TimelineEvent[]> {
    const timeline: TimelineEvent[] = [];

    try {
      // Check if PR was opened as draft
      timeline.push({
        type: prData.draft ? 'opened_draft' : 'opened',
        date: prData.createdAt,
      });

      // Fetch PR timeline events for draft/ready transitions
      const { data: prTimelineEvents } =
        await this.octokit.rest.issues.listEvents({
          owner,
          repo,
          issue_number: prNumber,
          per_page: 100,
        });

      // Add ready for review event
      for (const event of prTimelineEvents) {
        if (event.event === 'ready_for_review' && event.created_at) {
          timeline.push({
            type: 'ready_for_review',
            date: event.created_at,
          });
        }
      }

      // Fetch commits
      const { data: commits } = await this.octokit.rest.pulls.listCommits({
        owner,
        repo,
        pull_number: prNumber,
        per_page: 100,
      });

      // Group commits by date (within 1 hour)
      const commitGroups: Array<{
        date: string;
        commits: Array<{
          sha: string;
          message: string;
          author: string;
          date: string;
        }>;
      }> = [];

      for (const commit of commits) {
        const commitDate = new Date(commit.commit.author?.date || '');
        const commitInfo = {
          sha: commit.sha.substring(0, 8),
          message: commit.commit.message.split('\n')[0],
          author: commit.commit.author?.name || 'Unknown',
          date: commit.commit.author?.date || '',
        };

        // Find existing group within 1 hour
        const existingGroup = commitGroups.find(group => {
          const groupDate = new Date(group.date);
          const timeDiff = Math.abs(commitDate.getTime() - groupDate.getTime());
          return timeDiff <= 60 * 60 * 1000; // 1 hour
        });

        if (existingGroup) {
          existingGroup.commits.push(commitInfo);
          // Update group date to latest commit
          if (commitDate > new Date(existingGroup.date)) {
            existingGroup.date = commitDate.toISOString();
          }
        } else {
          commitGroups.push({
            date: commitDate.toISOString(),
            commits: [commitInfo],
          });
        }
      }

      // Add commit events
      for (const group of commitGroups) {
        timeline.push({
          type: 'commits_added',
          date: group.date,
          commit_count: group.commits.length,
          commits: group.commits,
        });
      }

      // Add comments
      const { data: comments } = await this.octokit.rest.issues.listComments({
        owner,
        repo,
        issue_number: prNumber,
        per_page: 100,
      });

      for (const comment of comments) {
        timeline.push({
          type: 'comment_added',
          date: comment.created_at,
          comment_author: comment.user?.login || 'unknown',
          comment_content: comment.body || '',
          comment_url: comment.html_url,
          comment_id: comment.id,
        });
      }

      // Add review comments
      const { data: reviewComments } =
        await this.octokit.rest.pulls.listReviewComments({
          owner,
          repo,
          pull_number: prNumber,
          per_page: 100,
        });

      for (const comment of reviewComments) {
        timeline.push({
          type: 'review_comment_added',
          date: comment.created_at,
          comment_author: comment.user?.login || 'unknown',
          comment_content: comment.body || '',
          comment_url: comment.html_url,
          comment_id: comment.id,
        });
      }

      // Fetch check runs
      logger.info(`Fetching CI runs for ${commits.length} commits`);

      try {
        const { data: checkRuns } = await this.octokit.rest.checks.listForRef({
          owner,
          repo,
          ref: prData.headSha,
          per_page: 100,
        });

        for (const checkRun of checkRuns.check_runs) {
          if (checkRun.started_at) {
            timeline.push({
              type: 'ci_started',
              date: checkRun.started_at,
              workflow_name: checkRun.name,
              ci_status: 'started',
            });

            if (checkRun.completed_at && checkRun.conclusion) {
              timeline.push({
                type: 'ci_completed',
                date: checkRun.completed_at,
                workflow_name: checkRun.name,
                ci_conclusion: checkRun.conclusion,
                ci_status: 'completed',
              });
            }
          }
        }

        // Also fetch legacy commit statuses
        const { data: statuses } =
          await this.octokit.rest.repos.listCommitStatusesForRef({
            owner,
            repo,
            ref: prData.headSha,
            per_page: 100,
          });

        for (const status of statuses) {
          if (status.created_at) {
            timeline.push({
              type:
                status.state === 'success' || status.state === 'failure'
                  ? 'ci_completed'
                  : 'ci_started',
              date: status.created_at,
              workflow_name: status.context || 'CI Check',
              ci_conclusion: status.state,
              ci_status: status.state === 'pending' ? 'started' : 'completed',
            });
          }
        }
      } catch (error) {
        logger.warn('Could not fetch PR-level check runs', {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // Add linked issue lifecycle events to the timeline
      if (linkedIssues && linkedIssues.length > 0) {
        for (const issue of linkedIssues) {
          for (const event of issue.lifecycle_events) {
            timeline.push({
              type: `issue_${event.event_type}`,
              date: event.date,
              issue_number: issue.number,
              issue_title: issue.title,
              assignee: event.assignee,
            });
          }
        }
      }

      // Add review timeline events from reviewTimings
      for (const reviewTiming of reviewTimings) {
        timeline.push({
          type: 'review',
          date: reviewTiming.submitted_at,
          reviewer: reviewTiming.reviewer,
          state: reviewTiming.state,
          time_to_review_hours: reviewTiming.time_to_review_hours,
          reviewer_teams: reviewTiming.reviewer_teams,
          author_reviewer_relationship:
            reviewTiming.author_reviewer_relationship,
          comment_url: reviewTiming.review_url,
          submitted_at: reviewTiming.submitted_at,
        });
      }

      logger.info(`Built timeline with ${timeline.length} events`);
      return timeline;
    } catch (error) {
      logger.error('Error building timeline for PR', {
        prNumber,
        error: error instanceof Error ? error.message : String(error),
      });
      return timeline;
    }
  }

  async getReviewTimings(
    owner: string,
    repo: string,
    prNumber: number,
    prCreatedAt: string,
    authorTeams: string[],
    prCommits: any[],
    prComments: any[],
    prAuthor: string
  ): Promise<ReviewTiming[]> {
    try {
      const { data: reviews } = await this.octokit.rest.pulls.listReviews({
        owner,
        repo,
        pull_number: prNumber,
        per_page: 100,
      });

      // Detailed review logging (debug mode only)
      if (logger.level === 'debug') {
        logger.debug('Found reviews for PR', {
          prNumber,
          reviewCount: reviews.length,
          reviews: reviews.map((review, index) => ({
            index: index + 1,
            user: review.user?.login || 'unknown',
            state: review.state,
            submitted_at: review.submitted_at || 'not submitted',
            id: review.id,
            bodyPreview: review.body
              ? review.body.substring(0, 100) +
                (review.body.length > 100 ? '...' : '')
              : 'no body',
          })),
        });

        // Cross-reference with GraphQL for more accurate review states
        try {
          const graphqlQuery = `
            query GetPRReviews($owner: String!, $repo: String!, $prNumber: Int!) {
              repository(owner: $owner, name: $repo) {
                pullRequest(number: $prNumber) {
                  reviews(first: 100) {
                    nodes {
                      author {
                        login
                      }
                      state
                      submittedAt
                    }
                  }
                }
              }
            }
          `;

          const graphqlResult: any = await this.octokit.graphql(graphqlQuery, {
            owner,
            repo,
            prNumber,
          });

          const graphqlReviews =
            graphqlResult.repository.pullRequest.reviews.nodes;
          logger.debug('GraphQL review states for verification', {
            graphqlReviews: graphqlReviews.map((review: any) => ({
              author: review.author?.login,
              state: review.state,
              submitted_at: review.submittedAt,
            })),
          });
        } catch (graphqlError) {
          logger.debug(
            'Could not fetch GraphQL review data for cross-reference',
            {
              error:
                graphqlError instanceof Error
                  ? graphqlError.message
                  : String(graphqlError),
            }
          );
        }
      }

      const reviewTimings: ReviewTiming[] = [];
      const prCreatedDate = new Date(prCreatedAt);

      for (const review of reviews) {
        if (!review.submitted_at || !review.user?.login) {
          if (logger.level === 'debug') {
            logger.debug('Skipping review due to missing data', {
              reviewer: review.user?.login || 'unknown',
              submitted_at: review.submitted_at,
              reason: 'missing submitted_at or login',
            });
          }
          continue;
        }

        const submittedDate = new Date(review.submitted_at);
        const timeToReviewHours =
          (submittedDate.getTime() - prCreatedDate.getTime()) /
          (1000 * 60 * 60);

        const reviewerTeams = await this.getUserTeams(review.user.login, owner);

        if (logger.level === 'debug') {
          logger.debug('Processing review', {
            reviewer: review.user.login,
            state: review.state,
            submitted_at: review.submitted_at,
          });
        }

        // Construct GitHub review URL
        const reviewUrl = `https://github.com/${owner}/${repo}/pull/${prNumber}#pullrequestreview-${review.id}`;

        reviewTimings.push({
          state: review.state,
          reviewer: review.user.login,
          submitted_at: review.submitted_at,
          time_to_review_hours: Math.round(timeToReviewHours * 100) / 100,
          author_teams: authorTeams,
          reviewer_teams: reviewerTeams,
          author_reviewer_relationship: 'cross-department',
          review_url: reviewUrl,
          review_id: review.id,
        });

        await new Promise(resolve => setTimeout(resolve, 50));
      }

      // Log note about potential missing approvals
      logger.info(
        'Note: Some approvals may appear missing due to GitHub API limitations where approvals with comments are returned as COMMENTED instead of APPROVED'
      );

      return reviewTimings;
    } catch (error) {
      logger.error('Error fetching review timings', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  async getUserTeams(username: string, org: string): Promise<string[]> {
    try {
      const { data: teams } = await this.octokit.rest.orgs.listTeamsForUser({
        org,
        username,
        per_page: 100,
      });
      return teams.map(team => team.slug);
    } catch (error) {
      // User might not be public member or teams might not be accessible
      return [];
    }
  }

  async parseCodeowners(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<{ teams: string[]; individuals: string[] }> {
    try {
      const { data: file } = await this.octokit.rest.repos.getContent({
        owner,
        repo,
        path: '.github/CODEOWNERS',
        ref: 'main',
      });

      if ('content' in file) {
        const content = Buffer.from(file.content, 'base64').toString('utf-8');
        const lines = content.split('\n');

        const teams = new Set<string>();
        const individuals = new Set<string>();

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#')) {
            const parts = trimmed.split(/\s+/);
            if (parts.length >= 2) {
              for (let i = 1; i < parts.length; i++) {
                const owner = parts[i];
                if (owner.startsWith('@')) {
                  const name = owner.substring(1);
                  if (name.includes('/')) {
                    // Team (format: @org/team-name)
                    const teamName = name.split('/')[1];
                    teams.add(teamName);
                  } else {
                    // Individual (format: @username)
                    individuals.add(name);
                  }
                }
              }
            }
          }
        }

        return {
          teams: Array.from(teams),
          individuals: Array.from(individuals),
        };
      }
    } catch (error) {
      logger.debug('Could not parse CODEOWNERS file', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return { teams: [], individuals: [] };
  }

  /**
   * Extract issue numbers from PR body/description and fetch issue details
   */
  async getLinkedIssues(
    owner: string,
    repo: string,
    prBody: string | null
  ): Promise<LinkedIssue[]> {
    if (!prBody) {
      return [];
    }

    try {
      // Extract issue references from PR body
      const issuePatterns = [
        /(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|address(?:e[sd])?)\s+#(\d+)/gi,
        /(?:related\s+to|see|ref(?:erence)?)\s+#(\d+)/gi,
        /#(\d+)/g, // Generic issue references
      ];

      const issueNumbers = new Set<number>();

      for (const pattern of issuePatterns) {
        let match;
        while ((match = pattern.exec(prBody)) !== null) {
          const issueNumber = parseInt(match[1]);
          if (issueNumber) {
            issueNumbers.add(issueNumber);
          }
        }
      }

      if (issueNumbers.size === 0) {
        logger.debug('No issue references found in PR body');
        return [];
      }

      logger.debug(
        `Found ${issueNumbers.size} issue references: ${Array.from(issueNumbers).join(', ')}`
      );

      // Fetch issue details for all referenced issues
      const issues: LinkedIssue[] = [];

      for (const issueNumber of issueNumbers) {
        try {
          const { data: issue } = await this.octokit.rest.issues.get({
            owner,
            repo,
            issue_number: issueNumber,
          });

          // Skip if it's actually a PR
          if (issue.pull_request) {
            continue;
          }

          // Fetch issue lifecycle events
          const lifecycleEvents = await this.getIssueLifecycleEvents(
            owner,
            repo,
            issueNumber,
            issue.created_at
          );

          issues.push({
            number: issue.number,
            title: issue.title,
            url: issue.html_url,
            state: issue.state,
            labels: issue.labels
              .map(label =>
                typeof label === 'string' ? label : label.name || ''
              )
              .filter(Boolean),
            assignees:
              issue.assignees?.map(assignee => assignee.login || '') || [],
            created_at: issue.created_at,
            closed_at: issue.closed_at,
            lifecycle_events: lifecycleEvents,
          });

          logger.debug(
            `Fetched issue #${issueNumber}: ${issue.title} with ${lifecycleEvents.length} lifecycle events`
          );

          // Add small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (issueError) {
          logger.warn(`Could not fetch issue #${issueNumber}`, {
            error:
              issueError instanceof Error
                ? issueError.message
                : String(issueError),
          });
          // Continue with other issues if one fails
          continue;
        }
      }

      logger.info(`Found ${issues.length} linked issues for PR`);
      return issues;
    } catch (error) {
      logger.error('Error fetching linked issues', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Fetch issue lifecycle events (assignment, status changes)
   */
  async getIssueLifecycleEvents(
    owner: string,
    repo: string,
    issueNumber: number,
    issueCreatedAt: string
  ): Promise<IssueLifecycleEvent[]> {
    try {
      const events: IssueLifecycleEvent[] = [];

      // Always add creation event
      events.push({
        event_type: 'created',
        date: issueCreatedAt,
      });

      // Fetch issue events from GitHub API
      const { data: issueEvents } = await this.octokit.rest.issues.listEvents({
        owner,
        repo,
        issue_number: issueNumber,
        per_page: 100,
      });

      logger.debug(
        `Fetched ${issueEvents.length} events for issue #${issueNumber}`
      );

      for (const event of issueEvents) {
        switch (event.event) {
          case 'assigned':
            if ((event as any).assignee && event.created_at) {
              events.push({
                event_type: 'assigned',
                date: event.created_at,
                actor: event.actor?.login,
                assignee: (event as any).assignee.login,
              });
            }
            break;

          case 'unassigned':
            if ((event as any).assignee && event.created_at) {
              events.push({
                event_type: 'unassigned',
                date: event.created_at,
                actor: event.actor?.login,
                assignee: (event as any).assignee.login,
              });
            }
            break;

          case 'closed':
            if (event.created_at) {
              events.push({
                event_type: 'closed',
                date: event.created_at,
                actor: event.actor?.login,
              });
            }
            break;

          case 'labeled':
            // Look for "in progress" type labels
            if ((event as any).label && event.created_at) {
              const labelName = (event as any).label.name?.toLowerCase() || '';
              if (
                labelName.includes('in progress') ||
                labelName.includes('in-progress') ||
                labelName.includes('doing') ||
                labelName.includes('started') ||
                labelName.includes('wip')
              ) {
                events.push({
                  event_type: 'in_progress',
                  date: event.created_at,
                  actor: event.actor?.login,
                });
              }
            }
            break;
        }
      }

      // Sort events chronologically
      events.sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
      );

      logger.debug(
        `Processed ${events.length} lifecycle events for issue #${issueNumber}`
      );
      return events;
    } catch (error) {
      logger.warn(`Could not fetch events for issue #${issueNumber}`, {
        error: error instanceof Error ? error.message : String(error),
      });

      // Return at least the creation event
      return [
        {
          event_type: 'created',
          date: issueCreatedAt,
        },
      ];
    }
  }
}

