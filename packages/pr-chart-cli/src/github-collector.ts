import { Octokit } from '@octokit/rest';
import { WebClient } from '@slack/web-api';
import {
  TimelineEvent,
  ReviewTiming,
  LinkedIssue,
  IssueLifecycleEvent,
  Release,
  SlackMessage,
} from '../types';
import { logger } from '../../shared/logger';

export class GitHubCollector {
  readonly octokit: Octokit;
  private slack?: WebClient;

  constructor(githubToken: string, slackToken?: string) {
    this.octokit = new Octokit({
      auth: githubToken,
    });

    if (slackToken) {
      this.slack = new WebClient(slackToken);
    }
  }

  async getUserTeams(username: string, org: string): Promise<string[]> {
    const query = `
    query($org: String!, $login: String!, $after: String) {
      organization(login: $org) {
        teams(first: 100, userLogins: [$login], after: $after) {
          nodes {
            name
            slug
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  `;

    let teams: { name: string; slug: string }[] = [];
    let after: string | null = null;

    try {
      do {
        const response: any = await this.octokit.graphql(query, {
          org,
          login: username,
          after,
        });

        const teamNodes = response.organization.teams.nodes;
        teams.push(...teamNodes);

        const pageInfo = response.organization.teams.pageInfo;
        after = pageInfo.hasNextPage ? pageInfo.endCursor : null;
      } while (after);

      return teams.map((team: { name: string; slug: string }) => team.name);
    } catch (error) {
      logger.warn('Could not fetch user teams', {
        username,
        error: String(error),
      });
      return [];
    }
  }

  async parseCodeowners(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<{ teams: string[]; individuals: string[] }> {
    try {
      const possiblePaths = [
        '.github/CODEOWNERS',
        'CODEOWNERS',
        'docs/CODEOWNERS',
      ];
      let codeownersContent = '';

      for (const path of possiblePaths) {
        try {
          const { data } = await this.octokit.rest.repos.getContent({
            owner,
            repo,
            path,
          });

          if ('content' in data) {
            codeownersContent = Buffer.from(data.content, 'base64').toString(
              'utf-8'
            );
            break;
          }
        } catch {
          continue;
        }
      }

      if (!codeownersContent) {
        return { teams: [], individuals: [] };
      }

      const { data: files } = await this.octokit.rest.pulls.listFiles({
        owner,
        repo,
        pull_number: prNumber,
      });

      const changedFiles = files.map(file => file.filename);
      const teams = new Set<string>();
      const individuals = new Set<string>();

      const lines = codeownersContent.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const parts = trimmed.split(/\s+/);
        if (parts.length < 2) continue;

        const pathPattern = parts[0];
        const owners = parts.slice(1);

        const isMatching = changedFiles.some(file =>
          this.isFileMatchingPattern(file, pathPattern)
        );

        if (isMatching) {
          for (const owner of owners) {
            const cleanOwner = owner.replace('@', '');
            if (cleanOwner.includes('/')) {
              const [, teamName] = cleanOwner.split('/');
              teams.add(teamName);
            } else {
              individuals.add(cleanOwner);
            }
          }
        }
      }

      return {
        teams: Array.from(teams),
        individuals: Array.from(individuals),
      };
    } catch (error) {
      logger.error('Error parsing CODEOWNERS', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { teams: [], individuals: [] };
    }
  }

  private isFileMatchingPattern(file: string, pathPattern: string): boolean {
    if (pathPattern === '*') return true;
    if (pathPattern.endsWith('/*')) {
      const dir = pathPattern.slice(0, -2);
      return file.startsWith(dir + '/');
    }
    if (pathPattern.includes('*')) {
      const regex = new RegExp(pathPattern.replace(/\*/g, '.*'));
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
        });

      // Look for ready_for_review and convert_to_draft events
      prTimelineEvents.forEach(event => {
        if (event.event === 'ready_for_review') {
          timeline.push({
            type: 'ready_for_review',
            date: event.created_at,
          });
        } else if (event.event === 'convert_to_draft') {
          timeline.push({
            type: 'convert_to_draft',
            date: event.created_at,
          });
        }
      });

      const { data: commits } = await this.octokit.rest.pulls.listCommits({
        owner,
        repo,
        pull_number: prNumber,
      });

      // Group commits by date and collect all SHAs
      const commitsByDate = new Map<
        string,
        {
          count: number;
          shas: string[];
          firstDate: string;
          commits: Array<{
            sha: string;
            message: string;
            author: string;
            date: string;
          }>;
        }
      >();
      const allCommitShas: string[] = [];

      commits.forEach(commit => {
        const date =
          commit.commit.author?.date || commit.commit.committer?.date;
        if (date) {
          const dateKey = date.split('T')[0];
          const existing = commitsByDate.get(dateKey) || {
            count: 0,
            shas: [],
            firstDate: date,
            commits: [],
          };

          existing.count++;
          existing.shas.push(commit.sha);
          existing.commits.push({
            sha: commit.sha,
            message: commit.commit.message,
            author:
              commit.commit.author?.name || commit.author?.login || 'unknown',
            date: date,
          });

          if (date < existing.firstDate) {
            existing.firstDate = date;
          }

          commitsByDate.set(dateKey, existing);
          allCommitShas.push(commit.sha);
        }
      });

      // Add commit events with detailed commit information
      commitsByDate.forEach(({ count, firstDate, commits }, dateKey) => {
        timeline.push({
          type: 'commits_added',
          date: firstDate,
          commit_count: count,
          commits: commits,
        });
      });

      // Fetch CI runs for commits in smaller batches
      logger.info(`Fetching CI runs for ${allCommitShas.length} commits`);
      const batchSize = 5;

      for (let i = 0; i < allCommitShas.length; i += batchSize) {
        const batch = allCommitShas.slice(i, i + batchSize);

        await Promise.all(
          batch.map(async sha => {
            try {
              const { data: checkRuns } =
                await this.octokit.rest.checks.listForRef({
                  owner,
                  repo,
                  ref: sha,
                  per_page: 100,
                });

              // Also get commit statuses (for older CI systems that don't use Check Runs)
              const { data: commitStatuses } =
                await this.octokit.rest.repos.listCommitStatusesForRef({
                  owner,
                  repo,
                  ref: sha,
                  per_page: 100,
                });

              checkRuns.check_runs.forEach(checkRun => {
                if (checkRun.started_at) {
                  timeline.push({
                    type: 'ci_started',
                    date: checkRun.started_at,
                    ci_status: checkRun.status,
                    workflow_name: checkRun.name,
                  });
                }

                if (checkRun.completed_at) {
                  const eventType =
                    checkRun.conclusion === 'success'
                      ? 'ci_completed'
                      : 'ci_failed';
                  timeline.push({
                    type: eventType,
                    date: checkRun.completed_at,
                    ci_status: checkRun.status,
                    ci_conclusion: checkRun.conclusion || 'unknown',
                    workflow_name: checkRun.name,
                  });
                }
              });

              // Process commit statuses (legacy CI systems)
              commitStatuses.forEach(status => {
                if (status.created_at) {
                  const statusType =
                    status.state === 'success'
                      ? 'ci_completed'
                      : status.state === 'failure'
                        ? 'ci_failed'
                        : status.state === 'pending'
                          ? 'ci_started'
                          : 'ci_status_other';

                  timeline.push({
                    type: statusType,
                    date: status.created_at,
                    ci_status: status.state,
                    ci_conclusion:
                      status.state === 'success'
                        ? 'success'
                        : status.state === 'failure'
                          ? 'failure'
                          : status.state,
                    workflow_name: status.context || 'Status Check',
                  });
                }
              });
            } catch (error) {
              logger.warn('Could not fetch check runs for commit', {
                sha,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          })
        );

        // Rate limiting delay between batches
        if (i + batchSize < allCommitShas.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      // Add review events
      reviewTimings.forEach(review => {
        timeline.push({
          type: 'review',
          date: review.submitted_at,
          state: review.state,
          reviewer: review.reviewer,
          submitted_at: review.submitted_at,
          time_to_review_hours: review.time_to_review_hours,
          reviewer_teams: review.reviewer_teams,
          author_reviewer_relationship: review.author_reviewer_relationship,
        });
      });

      // Add comment events
      const { data: issueComments } =
        await this.octokit.rest.issues.listComments({
          owner,
          repo,
          issue_number: prNumber,
        });

      issueComments.forEach(comment => {
        timeline.push({
          type: 'comment_added',
          date: comment.created_at,
          comment_author: comment.user?.login,
          comment_content: comment.body || '',
          comment_url: comment.html_url,
          comment_id: comment.id,
        });
      });

      const { data: reviewComments } =
        await this.octokit.rest.pulls.listReviewComments({
          owner,
          repo,
          pull_number: prNumber,
        });

      reviewComments.forEach(comment => {
        timeline.push({
          type: 'review_comment_added',
          date: comment.created_at,
          comment_author: comment.user?.login,
          comment_content: comment.body || '',
          comment_url: comment.html_url,
          comment_id: comment.id,
        });
      });

      // Add close/merge events
      if (prData.closedAt) {
        timeline.push({
          type: 'closed',
          date: prData.closedAt,
        });
      }

      if (prData.mergedAt) {
        timeline.push({
          type: 'merged',
          date: prData.mergedAt,
        });
      }

      // Sort chronologically
      timeline.sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
      );

      // Also get PR-level check runs (sometimes different from commit-level)
      try {
        const { data: prCheckRuns } = await this.octokit.rest.checks.listForRef(
          {
            owner,
            repo,
            ref: prData.headSha, // Use the PR head commit SHA
            per_page: 100,
          }
        );

        if (logger.level === 'debug') {
          logger.debug('Found PR-level check runs', {
            count: prCheckRuns.check_runs.length,
          });
        }

        // Add any additional check runs not already captured
        prCheckRuns.check_runs.forEach(checkRun => {
          // Check if we already have this check run (by name and timing)
          const existingCheck = timeline.find(
            event =>
              event.workflow_name === checkRun.name &&
              event.date === (checkRun.started_at || checkRun.completed_at)
          );

          if (!existingCheck) {
            if (checkRun.started_at) {
              timeline.push({
                type: 'ci_started',
                date: checkRun.started_at,
                ci_status: checkRun.status,
                workflow_name: checkRun.name,
              });
            }

            if (checkRun.completed_at) {
              const eventType =
                checkRun.conclusion === 'success'
                  ? 'ci_completed'
                  : 'ci_failed';
              timeline.push({
                type: eventType,
                date: checkRun.completed_at,
                ci_status: checkRun.status,
                ci_conclusion: checkRun.conclusion || 'unknown',
                workflow_name: checkRun.name,
              });
            }
          }
        });
      } catch (error) {
        logger.warn('Could not fetch PR-level check runs', {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      // Add linked issue lifecycle events to the timeline
      if (linkedIssues && linkedIssues.length > 0) {
        for (const issue of linkedIssues) {
          for (const event of issue.lifecycle_events) {
            let eventType = '';
            let eventContent = '';

            switch (event.event_type) {
              case 'created':
                eventType = 'issue_created';
                eventContent = `Issue #${issue.number} created`;
                break;
              case 'assigned':
                eventType = 'issue_assigned';
                eventContent = `Issue #${issue.number} assigned to ${event.assignee}`;
                break;
              case 'in_progress':
                eventType = 'issue_in_progress';
                eventContent = `Issue #${issue.number} marked in progress`;
                break;
              case 'closed':
                eventType = 'issue_closed';
                eventContent = `Issue #${issue.number} closed`;
                break;
            }

            timeline.push({
              type: eventType,
              date: event.date,
              comment_author: event.actor,
              comment_content: eventContent,
              comment_url: issue.url,
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
        per_page: 100, // Increase from default 30 to 100 to catch more reviews
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
              ? review.body.substring(0, 100) + '...'
              : 'no body',
          })),
        });
      }

      // GraphQL verification (debug mode only) - compares REST vs GraphQL API results
      if (logger.level === 'debug') {
        logger.debug('Checking GraphQL API for review state comparison');

        try {
          const graphqlQuery = `
            query($owner: String!, $name: String!, $number: Int!) {
              repository(owner: $owner, name: $name) {
                pullRequest(number: $number) {
                  reviews(first: 100) {
                    nodes {
                      author {
                        login
                      }
                      state
                      submittedAt
                      createdAt
                    }
                  }
                }
              }
            }
          `;

          const graphqlResult: any = await this.octokit.graphql(graphqlQuery, {
            owner,
            name: repo,
            number: prNumber,
          });

          const graphqlReviews =
            graphqlResult.repository.pullRequest.reviews.nodes;
          logger.debug('Found reviews via GraphQL', {
            reviewCount: graphqlReviews.length,
            reviews: graphqlReviews.map((review: any, index: number) => ({
              index: index + 1,
              user: review.author?.login || 'unknown',
              state: review.state,
              submittedAt: review.submittedAt,
            })),
          });

          // Check for approvals that might be missing from REST API
          const graphqlApprovals = graphqlReviews.filter(
            (review: any) => review.state === 'APPROVED'
          );
          logger.debug('Found approvals via GraphQL', {
            approvalCount: graphqlApprovals.length,
          });
        } catch (graphqlError) {
          logger.debug('GraphQL query failed, continuing with REST API only', {
            error: graphqlError,
          });
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
      logger.error('Error fetching review timings', { error: String(error) });
      return [];
    }
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
      // Handles both same-repo (#123) and cross-repo (https://github.com/owner/repo/issues/123) references

      const issueReferences = new Set<{
        number: number;
        owner: string;
        repo: string;
      }>();

      // Extract same-repo issue references (#123)
      const sameRepoPatterns = [
        /(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|address(?:e[sd])?)\s+#(\d+)/gi,
        /(?:related\s+to|see|ref(?:erence)?)\s+#(\d+)/gi,
        /#(\d+)/g, // Generic issue references
      ];

      for (const pattern of sameRepoPatterns) {
        let match;
        while ((match = pattern.exec(prBody)) !== null) {
          const issueNumber = parseInt(match[1]);
          if (issueNumber) {
            issueReferences.add({ number: issueNumber, owner, repo });
          }
        }
      }

      // Extract cross-repo issue references (full URLs)
      const crossRepoPatterns = [
        /(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|address(?:e[sd])?)\s+<?https?:\/\/github\.com\/([\w-]+)\/([\w-]+)\/issues\/(\d+)>?/gi,
        /(?:related\s+to|see|ref(?:erence)?)\s+<?https?:\/\/github\.com\/([\w-]+)\/([\w-]+)\/issues\/(\d+)>?/gi,
      ];

      for (const pattern of crossRepoPatterns) {
        let match;
        while ((match = pattern.exec(prBody)) !== null) {
          const issueOwner = match[1];
          const issueRepo = match[2];
          const issueNumber = parseInt(match[3]);
          if (issueNumber && issueOwner && issueRepo) {
            issueReferences.add({
              number: issueNumber,
              owner: issueOwner,
              repo: issueRepo,
            });
          }
        }
      }

      if (issueReferences.size === 0) {
        logger.debug('No issue references found in PR body');
        return [];
      }

      logger.debug(
        `Found ${issueReferences.size} issue references: ${Array.from(
          issueReferences
        )
          .map(ref => `${ref.owner}/${ref.repo}#${ref.number}`)
          .join(', ')}`
      );

      // Fetch issue details for all referenced issues
      const issues: LinkedIssue[] = [];

      for (const issueRef of issueReferences) {
        try {
          const { data: issue } = await this.octokit.rest.issues.get({
            owner: issueRef.owner,
            repo: issueRef.repo,
            issue_number: issueRef.number,
          });

          // Skip if it's actually a PR (GitHub treats PRs as issues internally)
          if (issue.pull_request) {
            continue;
          }

          // Fetch issue lifecycle events
          const lifecycleEvents = await this.getIssueLifecycleEvents(
            issueRef.owner,
            issueRef.repo,
            issueRef.number,
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
            `Fetched issue ${issueRef.owner}/${issueRef.repo}#${issueRef.number}: ${issue.title} with ${lifecycleEvents.length} lifecycle events`
          );

          // Add small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (issueError) {
          logger.warn(
            `Could not fetch issue ${issueRef.owner}/${issueRef.repo}#${issueRef.number}`,
            {
              error:
                issueError instanceof Error
                  ? issueError.message
                  : String(issueError),
            }
          );
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

  /**
   * Get releases that were published after the PR was merged
   */
  async getReleasesAfterMerge(
    owner: string,
    repo: string,
    mergedAt: string | null
  ): Promise<Release[]> {
    if (!mergedAt) {
      logger.debug('PR not merged, no releases to fetch');
      return [];
    }

    try {
      logger.debug(`Fetching releases after PR merge date: ${mergedAt}`);

      const { data: releases } = await this.octokit.rest.repos.listReleases({
        owner,
        repo,
        per_page: 100, // Get recent releases
      });

      const mergeDate = new Date(mergedAt);
      const releasesAfterMerge = releases
        .filter(release => {
          if (!release.published_at) return false;
          const publishDate = new Date(release.published_at);
          return publishDate > mergeDate && !release.draft;
        })
        .map(release => ({
          id: release.id,
          name: release.name || release.tag_name,
          tag_name: release.tag_name,
          published_at: release.published_at!,
          html_url: release.html_url,
          prerelease: release.prerelease,
          draft: release.draft,
        }))
        .sort(
          (a, b) =>
            new Date(a.published_at).getTime() -
            new Date(b.published_at).getTime()
        );

      logger.debug(
        `Found ${releasesAfterMerge.length} releases after merge: ${releasesAfterMerge.map(r => r.tag_name).join(', ')}`
      );

      return releasesAfterMerge;
    } catch (error) {
      logger.warn('Failed to fetch releases', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Search for Slack messages that mention the PR URL
   */
  async getSlackMessages(
    owner: string,
    repo: string,
    prNumber: number,
    prCreatedAt: string
  ): Promise<SlackMessage[]> {
    if (!this.slack) {
      logger.debug(
        'Slack client not configured, skipping Slack message search'
      );
      return [];
    }

    try {
      const prUrl = `https://github.com/${owner}/${repo}/pull/${prNumber}`;
      const shortPrUrl = `${owner}/${repo}#${prNumber}`;

      logger.debug(`Searching Slack for messages mentioning PR: ${prUrl}`);

      // Search for messages containing the PR URL or reference
      const searchQuery = `${prUrl} OR ${shortPrUrl}`;

      const result = await this.slack.search.messages({
        query: searchQuery,
        sort: 'timestamp',
        sort_dir: 'asc',
        count: 50, // Limit to prevent rate limiting
      });

      if (!result.ok || !result.messages?.matches) {
        logger.debug('No Slack messages found for PR');
        return [];
      }

      const messages: SlackMessage[] = [];
      const prCreatedDate = new Date(prCreatedAt);

      for (const match of result.messages.matches) {
        try {
          // Only include messages from after PR creation
          const messageDate = new Date(parseFloat(match.ts!) * 1000);
          if (messageDate < prCreatedDate) {
            continue;
          }

          // Get channel info to get channel name
          let channelName = match.channel?.name || 'unknown';
          if (match.channel?.id) {
            try {
              const channelInfo = await this.slack.conversations.info({
                channel: match.channel.id,
              });
              if (channelInfo.ok && channelInfo.channel?.name) {
                channelName = channelInfo.channel.name;
              }
            } catch (channelError) {
              logger.debug(
                `Could not get channel info for ${match.channel.id}`
              );
            }
          }

          // Get user info to get username
          let username = match.username || 'unknown';
          if (match.user) {
            try {
              const userInfo = await this.slack.users.info({
                user: match.user,
              });
              if (userInfo.ok && userInfo.user?.name) {
                username = userInfo.user.name;
              }
            } catch (userError) {
              logger.debug(`Could not get user info for ${match.user}`);
            }
          }

          messages.push({
            ts: match.ts!,
            text: match.text || '',
            user: match.user || '',
            username: username,
            channel: match.channel?.id || '',
            channel_name: channelName,
            permalink: match.permalink || '',
            timestamp: messageDate.toISOString(),
            thread_ts: (match as any).thread_ts,
            reply_count: (match as any).reply_count,
          });

          // Add small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (messageError) {
          logger.debug(`Error processing Slack message: ${messageError}`);
          continue;
        }
      }

      logger.debug(
        `Found ${messages.length} Slack messages for PR ${prNumber}`
      );
      return messages.sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
    } catch (error) {
      logger.warn('Failed to search Slack messages', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }
}
