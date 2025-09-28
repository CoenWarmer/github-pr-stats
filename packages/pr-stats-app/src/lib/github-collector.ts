import { Octokit } from '@octokit/rest';
import {
  TimelineEvent,
  ReviewTiming,
  LinkedIssue,
  IssueLifecycleEvent,
  PullRequestStats,
  BuildkiteBuild,
  BuildkiteJob,
} from './types';
import { logger } from './logger';

export class GitHubCollector {
  public octokit: Octokit;
  private buildkiteToken?: string;
  private buildkiteOrgSlug?: string;

  constructor(
    token?: string,
    buildkiteToken?: string,
    buildkiteOrgSlug?: string
  ) {
    const authToken = token || process.env.GITHUB_TOKEN;

    if (!authToken) {
      throw new Error(
        'GitHub token is required. Please set GITHUB_TOKEN environment variable or pass token to constructor.'
      );
    }

    logger.info('Initializing GitHub collector with token');

    this.octokit = new Octokit({
      auth: authToken,
      userAgent: 'pr-stats-app/1.0.0',
    });

    this.buildkiteToken = buildkiteToken || process.env.BUILDKITE_TOKEN;
    this.buildkiteOrgSlug = buildkiteOrgSlug || process.env.BUILDKITE_ORG_SLUG;

    if (this.buildkiteToken && this.buildkiteOrgSlug) {
      logger.info('Buildkite integration enabled');
    }
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
    prData: PullRequestStats,
    reviewTimings: ReviewTiming[],
    linkedIssues?: LinkedIssue[]
  ): Promise<TimelineEvent[]> {
    const timeline: TimelineEvent[] = [];

    try {
      // Check if PR was opened as draft
      timeline.push({
        type: prData.draft ? 'opened_draft' : 'opened',
        date: prData.created_at,
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

      // Add commit events and fetch Buildkite builds for each commit
      for (const group of commitGroups) {
        timeline.push({
          type: 'commits_added',
          date: group.date,
          commit_count: group.commits.length,
          commits: group.commits,
        });

        // Fetch Buildkite builds for each commit in the group
        for (const commitInfo of group.commits) {
          const fullSha = commits.find(c =>
            c.sha.startsWith(commitInfo.sha)
          )?.sha;
          if (fullSha) {
            const buildkiteBuilds =
              await this.getBuildkiteBuildsForCommit(fullSha);

            for (const build of buildkiteBuilds) {
              // Create enriched CI events from Buildkite data
              const buildkiteEvents = this.createCIEventsFromBuildkiteBuild(
                build,
                {
                  includeJobs: true, // Create job events for cache
                  hideJobsFromTimeline: true, // But hide them from timeline display
                }
              );

              // Add the enriched events to timeline
              timeline.push(...buildkiteEvents);

              logger.debug('Added Buildkite events for commit', {
                commitSha: fullSha.substring(0, 8),
                buildId: build.id,
                state: build.state,
                pipelineName: build.pipeline.name,
                eventCount: buildkiteEvents.length,
              });
            }
          }
        }
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
        // for (const checkRun of checkRuns.check_runs) {
        //   if (checkRun.started_at) {
        //     if (checkRun.completed_at && checkRun.conclusion) {
        //       // Create a single duration-based CI event
        //       timeline.push({
        //         type: 'ci_run',
        //         date: checkRun.started_at,
        //         end_date: checkRun.completed_at,
        //         workflow_name: checkRun.name,
        //         ci_conclusion: checkRun.conclusion,
        //         ci_status: 'completed',
        //         build_url: checkRun.details_url || undefined,
        //       });
        //     } else {
        //       // Create a point-in-time event for started (still running)
        //       timeline.push({
        //         type: 'ci_started',
        //         date: checkRun.started_at,
        //         workflow_name: checkRun.name,
        //         ci_status: 'started',
        //         build_url: checkRun.details_url || undefined,
        //       });
        //     }
        //   }
        // }
        // Also fetch legacy commit statuses
        // for (const status of statuses) {
        //   if (status.created_at) {
        //     timeline.push({
        //       type:
        //         status.state === 'success' || status.state === 'failure'
        //           ? 'ci_completed'
        //           : 'ci_started',
        //       date: status.created_at,
        //       workflow_name: status.context || 'CI Check',
        //       ci_conclusion: status.state,
        //       ci_status: status.state === 'pending' ? 'started' : 'completed',
        //       build_url: status.target_url || undefined,
        //     });
        //   }
        // }
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

      // Also fetch timeline events to capture team review requests
      try {
        const { data: timelineEvents } =
          await this.octokit.rest.issues.listEventsForTimeline({
            owner,
            repo,
            issue_number: prNumber,
            per_page: 100,
          });

        // Look for review_requested events for teams
        const teamRequestEvents = timelineEvents.filter(
          (event: any) =>
            event.event === 'review_requested' && event.requested_team
        );

        // Add these as timeline events for tracking
        for (const event of teamRequestEvents) {
          const eventAny = event as any;
          if (eventAny.requested_team) {
            timeline.push({
              type: 'team_review_requested',
              date: eventAny.created_at || prData.created_at,
              requested_team: eventAny.requested_team.slug,
            });
          }
        }
      } catch (error) {
        console.log('Error fetching timeline events:', error);
      }

      // Add awaiting review events
      const awaitingReviewEvents = this.createAwaitingReviewEvents(
        prData,
        timeline
      );
      timeline.push(...awaitingReviewEvents);

      logger.info(
        `Built timeline with ${timeline.length} events (including ${awaitingReviewEvents.length} awaiting review events)`
      );

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
    prAuthor: string,
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

        // Extract all teams that were ever requested from timeline events
        const allRequestedTeams = [
          ...new Set([
            ...requestedTeams, // Current pending teams
            ...timelineEvents
              .filter(e => e.type === 'team_review_requested')
              .map(e => e.requested_team)
              .filter((team): team is string => Boolean(team)),
          ]),
        ];

        // Get reviewer teams - use all requested teams as the source of truth for code owners
        const reviewerTeams = await this.getReviewerTeams(
          review.user.login,
          owner,
          allRequestedTeams
        );

        if (logger.level === 'debug') {
          logger.debug('Processing review', {
            reviewer: review.user.login,
            state: review.state,
            submitted_at: review.submitted_at,
            reviewerTeams,
            requestedTeams,
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

  async getUserTeams(_username: string, _org: string): Promise<string[]> {
    try {
      // This method is kept for backward compatibility but may not work reliably
      // for private team memberships
      return [];
    } catch (_error) {
      return [];
    }
  }

  async getReviewerTeams(
    username: string,
    org: string,
    requestedTeams: string[]
  ): Promise<string[]> {
    // Simple heuristic: If teams were requested for review and someone reviewed,
    // we assume they're from one of the requested teams (reasonable for code owner reviews)

    if (requestedTeams.length === 0) {
      // No teams were requested, so this reviewer is not part of code owner teams
      return [];
    }

    const userTeamsInRequested: string[] = [];

    // Check each requested team to see if the user is a member
    for (const teamSlug of requestedTeams) {
      try {
        // Use the GitHub API to check team membership
        await this.octokit.rest.teams.getMembershipForUserInOrg({
          org,
          team_slug: teamSlug,
          username,
        });

        // If no error, user is a member of this team
        userTeamsInRequested.push(teamSlug);
      } catch (error: any) {
        // User is not a member of this team, or we don't have permission to see it
        console.log(
          `❌ ${username} is not a member of team ${teamSlug} (or no permission)`
        );
      }
    }

    if (userTeamsInRequested.length > 0) {
      return userTeamsInRequested;
    }

    // Fallback: if we can't determine team membership, assume they belong to the first requested team
    // This handles cases where team membership is private or we don't have the right permissions
    console.log(
      `⚠️ Could not determine team membership for ${username}, assigning to first requested team: ${requestedTeams[0]}`
    );
    return [requestedTeams[0]];
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

  /**
   * Fetch Buildkite builds for a specific commit SHA
   */
  async getBuildkiteBuildsForCommit(
    commitSha: string
  ): Promise<BuildkiteBuild[]> {
    if (!this.buildkiteToken || !this.buildkiteOrgSlug) {
      logger.debug('Buildkite integration not configured');
      return [];
    }

    try {
      // Fetch all builds for the organization, filtered by commit
      const apiUrl = `https://api.buildkite.com/v2/organizations/${this.buildkiteOrgSlug}/builds?commit=${commitSha}&per_page=100`;

      const response = await fetch(apiUrl, {
        headers: {
          Authorization: `Bearer ${this.buildkiteToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        logger.warn(
          `Buildkite API error: ${response.status} ${response.statusText}`,
          { apiUrl, commitSha }
        );
        return [];
      }

      const builds: BuildkiteBuild[] = await response.json();

      logger.debug(
        `Found ${builds.length} Buildkite builds for commit ${commitSha.substring(0, 8)}`,
        {
          commitSha: commitSha.substring(0, 8),
          buildCount: builds.length,
          pipelines: builds.map(b => b.pipeline.name),
        }
      );

      return builds;
    } catch (error) {
      logger.warn('Error fetching Buildkite builds for commit', {
        error: error instanceof Error ? error.message : String(error),
        commitSha: commitSha.substring(0, 8),
      });
      return [];
    }
  }

  /**
   * Fetch Buildkite build information from a Buildkite URL (legacy method for backward compatibility)
   */
  async getBuildkiteBuild(buildUrl: string): Promise<BuildkiteBuild | null> {
    if (!this.buildkiteToken || !this.buildkiteOrgSlug) {
      logger.debug('Buildkite integration not configured');
      return null;
    }

    try {
      // Extract pipeline slug and build number from URL
      // Example: https://buildkite.com/elastic/kibana-pull-request/builds/339958
      const pipelineSlug = this.extractBuildkitePipelineSlug(buildUrl);
      const buildNumber = this.extractBuildkiteBuildNumber(buildUrl);

      if (!pipelineSlug || !buildNumber) {
        logger.warn(
          'Could not extract pipeline slug or build number from URL',
          {
            buildUrl,
            pipelineSlug,
            buildNumber,
          }
        );
        return null;
      }

      // Fetch the specific build using the API
      const apiUrl = `https://api.buildkite.com/v2/organizations/${this.buildkiteOrgSlug}/pipelines/${pipelineSlug}/builds/${buildNumber}`;

      const response = await fetch(apiUrl, {
        headers: {
          Authorization: `Bearer ${this.buildkiteToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        logger.warn(
          `Buildkite API error: ${response.status} ${response.statusText}`,
          { apiUrl }
        );
        return null;
      }

      const build: BuildkiteBuild = await response.json();

      logger.debug(
        `Found Buildkite build ${build.number} for pipeline ${build.pipeline.slug}`,
        {
          buildId: build.id,
          state: build.state,
          pipelineName: build.pipeline.name,
        }
      );

      return build;
    } catch (error) {
      logger.warn('Error fetching Buildkite build', {
        error: error instanceof Error ? error.message : String(error),
        buildUrl,
      });
      return null;
    }
  }

  /**
   * Extract Buildkite pipeline slug from a Buildkite URL
   */
  private extractBuildkitePipelineSlug(url: string): string | null {
    // Example: https://buildkite.com/elastic/kibana-pull-request/builds/339958
    const match = url.match(/buildkite\.com\/[^\/]+\/([^\/]+)\/builds/);
    return match ? match[1] : null;
  }

  /**
   * Extract Buildkite build number from a Buildkite URL
   */
  private extractBuildkiteBuildNumber(url: string): string | null {
    // Example: https://buildkite.com/elastic/kibana-pull-request/builds/339958
    const match = url.match(/builds\/(\d+)/);
    return match ? match[1] : null;
  }

  /**
   * Create enriched CI events from Buildkite build data
   */
  createCIEventsFromBuildkiteBuild(
    build: BuildkiteBuild,
    options: { includeJobs?: boolean; hideJobsFromTimeline?: boolean } = {}
  ): TimelineEvent[] {
    const events: TimelineEvent[] = [];

    // Calculate duration for the main build
    const startTime = build.started_at || build.created_at;
    const endTime = build.finished_at;
    let durationMs = 0;

    if (startTime && endTime) {
      durationMs = new Date(endTime).getTime() - new Date(startTime).getTime();
    }

    // Create main build event
    const buildEvent: TimelineEvent = {
      type: build.state === 'running' ? 'ci_started' : 'ci_run',
      date: startTime,
      end_date: endTime || undefined,
      workflow_name: build.pipeline.name,
      ci_conclusion: this.mapBuildkiteStateToCIConclusion(build.state),
      ci_status: build.state === 'running' ? 'started' : 'completed',
      build_url: build.web_url,
      buildkite_build_id: build.id,
      buildkite_pipeline_slug: build.pipeline.slug,
      // Add duration information
      duration_ms: durationMs,
      duration_minutes: Math.round(durationMs / (1000 * 60)),
      duration_hours: Math.round((durationMs / (1000 * 60 * 60)) * 100) / 100, // 2 decimal places
    };

    events.push(buildEvent);

    // Optionally create events for individual jobs if needed
    const { includeJobs = true, hideJobsFromTimeline = true } = options;

    if (includeJobs && build.jobs && build.jobs.length > 0) {
      for (const job of build.jobs) {
        if (job.type === 'script' && job.name) {
          // Calculate duration for individual job
          const jobStartTime = job.started_at || job.created_at;
          const jobEndTime = job.finished_at;
          let jobDurationMs = 0;

          if (jobStartTime && jobEndTime) {
            jobDurationMs =
              new Date(jobEndTime).getTime() - new Date(jobStartTime).getTime();
          }

          const jobEvent: TimelineEvent = {
            type: job.state === 'running' ? 'ci_started' : 'ci_run',
            date: jobStartTime,
            end_date: jobEndTime || undefined,
            workflow_name: `${build.pipeline.name} - ${job.name}`,
            ci_conclusion: this.mapBuildkiteJobStateToCIConclusion(job.state),
            ci_status: job.state === 'running' ? 'started' : 'completed',
            build_url: job.web_url,
            buildkite_build_id: build.id,
            buildkite_pipeline_slug: build.pipeline.slug,
            // Add job duration information
            duration_ms: jobDurationMs,
            duration_minutes: Math.round(jobDurationMs / (1000 * 60)),
            duration_hours:
              Math.round((jobDurationMs / (1000 * 60 * 60)) * 100) / 100,
            // Hide job events from timeline display (but keep in cache)
            hidden_from_timeline: hideJobsFromTimeline,
          };

          events.push(jobEvent);
        }
      }
    }

    logger.debug(`Created ${events.length} CI events from Buildkite build`, {
      buildId: build.id,
      pipelineName: build.pipeline.name,
      state: build.state,
      jobCount: build.jobs?.length || 0,
    });

    return events;
  }

  /**
   * Map Buildkite job state to GitHub CI conclusion
   */
  private mapBuildkiteJobStateToCIConclusion(
    state: BuildkiteJob['state']
  ): string {
    switch (state) {
      case 'passed':
        return 'success';
      case 'failed':
      case 'broken':
      case 'timed_out':
        return 'failure';
      case 'canceled':
        return 'cancelled';
      case 'blocked':
        return 'action_required';
      case 'skipped':
        return 'skipped';
      case 'waiting':
      case 'pending':
      case 'running':
        return 'in_progress';
      default:
        return 'neutral';
    }
  }

  /**
   * Map Buildkite build state to GitHub CI conclusion
   */
  private mapBuildkiteStateToCIConclusion(
    state: BuildkiteBuild['state']
  ): string {
    switch (state) {
      case 'passed':
        return 'success';
      case 'failed':
        return 'failure';
      case 'canceled':
      case 'canceling':
        return 'cancelled';
      case 'blocked':
        return 'action_required';
      case 'skipped':
      case 'not_run':
        return 'skipped';
      case 'running':
      case 'scheduled':
        return 'in_progress';
      default:
        return 'neutral';
    }
  }

  /**
   * Create awaiting review timeline events
   */
  createAwaitingReviewEvents(
    pr: PullRequestStats,
    timeline: TimelineEvent[]
  ): TimelineEvent[] {
    const awaitingEvents: TimelineEvent[] = [];

    // Sort timeline events by date
    const sortedEvents = [...timeline].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    let reviewPeriodStart: Date | null = null;
    let reviewPeriodCount = 0;

    // Determine when PR becomes ready for review
    const readyForReviewDate = this.findReadyForReviewDate(pr, sortedEvents);
    if (readyForReviewDate) {
      reviewPeriodStart = readyForReviewDate;
    }

    // Process events to find review periods
    for (const event of sortedEvents) {
      const eventDate = new Date(event.date);

      // If we're in a review period and get a review from a code owner team member
      if (reviewPeriodStart && this.isCodeOwnerReview(event)) {
        // End the current review period
        const durationHours = Math.round(
          (eventDate.getTime() - reviewPeriodStart.getTime()) / (1000 * 60 * 60)
        );

        // Assign to the first team of the reviewer
        const targetTeam = event.reviewer_teams?.[0] || 'unknown';

        // End the awaiting period 1 second before the review to ensure proper ordering
        const awaitingEndTime = new Date(eventDate.getTime() - 1000);

        awaitingEvents.push({
          type: 'awaiting_review',
          date: reviewPeriodStart.toISOString(),
          end_date: awaitingEndTime.toISOString(),
          workflow_name: `Awaiting Review - ${targetTeam}`,
          reviewer: event.reviewer,
          reviewer_teams: [targetTeam],
          duration_ms: awaitingEndTime.getTime() - reviewPeriodStart.getTime(),
          duration_minutes: Math.round(
            (awaitingEndTime.getTime() - reviewPeriodStart.getTime()) /
              (1000 * 60)
          ),
          duration_hours: durationHours,
        });

        reviewPeriodStart = null;
        reviewPeriodCount++;
      }

      // Start a new review period after commits are pushed (if not already in one)
      if (
        !reviewPeriodStart &&
        (event.type === 'commits_pushed' || event.type === 'commits_added')
      ) {
        reviewPeriodStart = eventDate;
      }

      // Start review period when PR becomes ready for review
      if (!reviewPeriodStart && event.type === 'ready_for_review') {
        reviewPeriodStart = eventDate;
      }
    }

    // If there's an ongoing review period at the end, close it with PR closure/merge
    if (reviewPeriodStart) {
      const prEndDate = pr.closed_at || pr.merged_at;
      if (prEndDate) {
        const endDate = new Date(prEndDate);
        const durationHours = Math.round(
          (endDate.getTime() - reviewPeriodStart.getTime()) / (1000 * 60 * 60)
        );

        // Try to find the specific team that was requested for review during this period
        const reviewPeriodStartTime = reviewPeriodStart.getTime();
        const prEndTime = endDate.getTime();

        // Look for team review requests during this review period
        const teamRequestsInPeriod = timeline
          .filter(event => event.type === 'team_review_requested')
          .filter(event => {
            const eventTime = new Date(event.date).getTime();
            return eventTime >= reviewPeriodStartTime && eventTime <= prEndTime;
          })
          .sort(
            (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
          ); // Most recent first

        // Use the most recent team request in this period, or fall back to code owner teams
        const codeOwnerTeams = this.extractCodeOwners(pr);
        let targetTeam: string;

        if (
          teamRequestsInPeriod.length > 0 &&
          teamRequestsInPeriod[0].requested_team
        ) {
          targetTeam = teamRequestsInPeriod[0].requested_team;
        } else if (codeOwnerTeams.length > 0) {
          targetTeam = codeOwnerTeams[0];
        } else {
          targetTeam = 'discussion';
        }

        const durationMs = endDate.getTime() - reviewPeriodStart.getTime();

        awaitingEvents.push({
          type: 'awaiting_review',
          date: reviewPeriodStart.toISOString(),
          end_date: prEndDate,
          workflow_name: `Awaiting Re-review - ${targetTeam}`,
          reviewer_teams:
            targetTeam !== 'discussion' ? [targetTeam] : undefined,
          duration_ms: durationMs,
          duration_minutes: Math.round(durationMs / (1000 * 60)),
          duration_hours: durationHours,
        });
      }
    }

    logger.debug(`Created ${awaitingEvents.length} awaiting review events`);
    return awaitingEvents;
  }

  /**
   * Finds when the PR became ready for review
   */
  private findReadyForReviewDate(
    pr: PullRequestStats,
    sortedEvents: TimelineEvent[]
  ): Date | null {
    // Look for explicit ready_for_review event
    const readyEvent = sortedEvents.find(
      event => event.type === 'ready_for_review'
    );
    if (readyEvent) {
      return new Date(readyEvent.date);
    }

    // If no explicit ready event, assume ready when created (if not draft)
    // or when first commits are pushed
    const firstCommitEvent = sortedEvents.find(
      event => event.type === 'commits_pushed' || event.type === 'commits_added'
    );

    if (firstCommitEvent) {
      return new Date(firstCommitEvent.date);
    }

    // Fallback to PR creation date
    return new Date(pr.created_at);
  }

  /**
   * Checks if an event is a review from a code owner team member
   */
  private isCodeOwnerReview(event: TimelineEvent): boolean {
    if (event.type !== 'review') {
      return false;
    }

    // Only reviewers who are part of code owner teams can end awaiting review periods
    if (event.reviewer_teams && event.reviewer_teams.length > 0) {
      return true;
    }

    return false;
  }

  /**
   * Extracts all code owner teams from the PR timeline
   */
  private extractCodeOwners(pr: PullRequestStats): string[] {
    const codeOwnerTeams = new Set<string>();

    // Extract teams from review events
    pr.timeline.forEach(event => {
      if (event.type === 'review') {
        if (event.reviewer_teams && event.reviewer_teams.length > 0) {
          // Add all teams for this reviewer
          event.reviewer_teams.forEach(team => {
            codeOwnerTeams.add(team);
          });
        }
      }
    });

    const result = Array.from(codeOwnerTeams).sort();

    // Only return actual teams - no fallback to individual reviewers
    return result;
  }
}
