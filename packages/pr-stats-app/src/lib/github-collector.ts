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

export type ProgressCallback = (
  step: string,
  current: number,
  total: number
) => void;

export class GitHubCollector {
  public octokit: Octokit;
  private buildkiteToken?: string;
  private buildkiteOrgSlug?: string;
  private progressCallback?: ProgressCallback;

  constructor(
    token?: string,
    buildkiteToken?: string,
    buildkiteOrgSlug?: string,
    progressCallback?: ProgressCallback
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
    this.progressCallback = progressCallback;

    if (this.buildkiteToken && this.buildkiteOrgSlug) {
      logger.info('Buildkite integration enabled');
    }
  }

  private reportProgress(step: string, current: number = 1, total: number = 1) {
    if (this.progressCallback) {
      this.progressCallback(step, current, total);
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
      this.reportProgress('Initializing timeline', 1, 10);

      // Check if PR was opened as draft
      timeline.push({
        type: prData.draft ? 'opened_draft' : 'opened',
        date: prData.created_at,
      });

      this.reportProgress('Fetching PR events', 2, 10);

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

      this.reportProgress('Fetching commits', 3, 10);

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
                  hideJobsFromTimeline: false, // Show them in timeline (in collapsible CI Jobs row)
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

      this.reportProgress('Fetching comments', 5, 10);

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

      this.reportProgress('Fetching review comments', 6, 10);

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

      this.reportProgress('Processing linked issues', 7, 10);

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

          // Add iteration event as a duration event if available
          if (issue.project_iteration) {
            timeline.push({
              type: 'issue_iteration',
              date: issue.project_iteration.iterationStartDate,
              end_date: issue.project_iteration.iterationEndDate,
              issue_number: issue.number,
              issue_title: issue.title,
              workflow_name: issue.project_iteration.iterationTitle, // Reuse workflow_name for iteration title
              comment_content: issue.project_iteration.projectTitle, // Reuse comment_content for project title
            });
          }
        }
      }

      this.reportProgress('Processing reviews', 8, 10);

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

      this.reportProgress('Checking releases', 9, 10);

      // Check for releases that include this PR's merge commit
      // Add timeout to prevent hanging on large repos
      if (prData.merged_at) {
        // Prefer merge_commit_sha if available, fallback to headSha
        const commitToCheck = prData.mergeCommitSha || prData.headSha;

        if (commitToCheck) {
          try {
            logger.debug(
              `Checking releases for ${commitToCheck.substring(0, 8)} (${prData.mergeCommitSha ? 'merge commit' : 'head commit'})`
            );

            const release = await Promise.race([
              this.getFirstReleaseForCommit(
                owner,
                repo,
                commitToCheck,
                prData.merged_at
              ),
              new Promise<null>(resolve =>
                setTimeout(() => resolve(null), 10000)
              ), // 10 second timeout
            ]);

            if (release) {
              timeline.push({
                type: 'released',
                date: release.published_at,
                release_tag: release.tag_name,
                release_url: release.html_url,
              });
            }
          } catch (releaseError) {
            logger.warn('Error fetching release information', {
              error:
                releaseError instanceof Error
                  ? releaseError.message
                  : String(releaseError),
            });
            // Continue without release information
          }
        }
      }

      this.reportProgress('Timeline complete', 10, 10);

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

    // Do not guess membership. If we cannot verify team membership, return empty
    // so the UI places the review under 'additional reviewers'.
    console.log(
      `⚠️ Could not verify team membership for ${username}. Returning no reviewer teams.`
    );
    return [];
  }

  async parseCodeowners(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<{ teams: string[] }> {
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
                  }
                }
              }
            }
          }
        }

        return {
          teams: Array.from(teams),
        };
      }
    } catch (error) {
      logger.debug('Could not parse CODEOWNERS file', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return { teams: [] };
  }

  /**
   * Fetch GitHub Projects v2 iteration information for an issue
   */
  async getIssueProjectIteration(
    owner: string,
    repo: string,
    issueNumber: number
  ): Promise<{
    projectTitle: string;
    iterationTitle: string;
    iterationStartDate: string;
    iterationEndDate: string;
  } | null> {
    try {
      // Use GraphQL to fetch project iteration data
      const query = `
        query($owner: String!, $repo: String!, $issueNumber: Int!) {
          repository(owner: $owner, name: $repo) {
            issue(number: $issueNumber) {
              projectItems(first: 10) {
                nodes {
                  project {
                    title
                  }
                  fieldValues(first: 20) {
                    nodes {
                      ... on ProjectV2ItemFieldIterationValue {
                        title
                        startDate
                        duration
                        iterationId
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `;

      const response: any = await this.octokit.graphql(query, {
        owner,
        repo,
        issueNumber,
      });

      const projectItems =
        response?.repository?.issue?.projectItems?.nodes || [];

      // Find the first project item with an iteration
      for (const item of projectItems) {
        if (!item.project?.title) continue;

        const iterationField = item.fieldValues?.nodes?.find(
          (node: any) => node?.title && node?.startDate
        );

        if (iterationField) {
          // Calculate end date from start date and duration
          const startDate = new Date(iterationField.startDate);
          const durationDays = iterationField.duration || 14; // Default to 2 weeks
          const endDate = new Date(startDate);
          endDate.setDate(endDate.getDate() + durationDays);

          logger.debug(
            `Found iteration for issue #${issueNumber}: ${iterationField.title} in project ${item.project.title}`
          );

          return {
            projectTitle: item.project.title,
            iterationTitle: iterationField.title,
            iterationStartDate: iterationField.startDate,
            iterationEndDate: endDate.toISOString(),
          };
        }
      }

      logger.debug(`No iteration found for issue #${issueNumber}`);
      return null;
    } catch (error) {
      logger.warn(
        `Could not fetch project iteration for issue #${issueNumber}`,
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return null;
    }
  }

  /**
   * Extract issue numbers from PR body/description and fetch issue details
   * Also checks PR timeline events for connected issues
   */
  async getLinkedIssues(
    owner: string,
    repo: string,
    prBody: string | null,
    prNumber?: number
  ): Promise<LinkedIssue[]> {
    logger.debug('getLinkedIssues called', {
      owner,
      repo,
      bodyLength: prBody?.length || 0,
      bodyPreview: prBody?.substring(0, 200) || 'null',
    });

    if (!prBody) {
      logger.debug('PR body is null or empty, returning empty linked issues');
      return [];
    }

    try {
      // Extract issue references from PR body
      const issuePatterns = [
        // Keywords followed by issue numbers
        /(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|address(?:e[sd])?)\s*:?\s*#(\d+)/gi,
        /(?:related\s+to|see|ref(?:erence)?|relates?\s+to)\s*:?\s*#(\d+)/gi,
        // GitHub's closing keywords
        /(?:closes?|fixes?|resolves?)\s+#(\d+)/gi,
        // Generic issue references (but be more specific to avoid false positives)
        /(?:^|\s)#(\d+)(?:\s|$|[.,!?])/g,
        // Cross-repository references (owner/repo#number)
        /(?:^|\s)[\w-]+\/[\w-]+#(\d+)(?:\s|$|[.,!?])/g,
        // Full GitHub URLs to issues in same repository
        new RegExp(`https://github\\.com/${owner}/${repo}/issues/(\\d+)`, 'gi'),
        // Full GitHub URLs to issues in any repository (extract issue number only)
        /https:\/\/github\.com\/[\w-]+\/[\w-]+\/issues\/(\d+)/gi,
      ];

      const issueNumbers = new Set<number>();
      const crossRepoIssues = new Set<{
        owner: string;
        repo: string;
        number: number;
      }>();

      for (const pattern of issuePatterns) {
        let match;
        while ((match = pattern.exec(prBody)) !== null) {
          const issueNumber = parseInt(match[1]);
          if (issueNumber) {
            // Check if this is a cross-repository URL pattern
            if (pattern.source.includes('github\\.com')) {
              // Extract owner and repo from the full match
              const urlMatch = match[0].match(
                /https:\/\/github\.com\/([\w-]+)\/([\w-]+)\/issues\/(\d+)/
              );
              if (urlMatch) {
                const [, matchOwner, matchRepo, matchNumber] = urlMatch;
                if (matchOwner === owner && matchRepo === repo) {
                  // Same repository - add to regular issue numbers
                  issueNumbers.add(issueNumber);
                  logger.debug(`Found same-repo issue URL: #${issueNumber}`);
                } else {
                  // Cross-repository - add to cross-repo set
                  crossRepoIssues.add({
                    owner: matchOwner,
                    repo: matchRepo,
                    number: parseInt(matchNumber),
                  });
                  logger.debug(
                    `Found cross-repo issue: ${matchOwner}/${matchRepo}#${matchNumber}`
                  );
                }
              }
            } else {
              // Regular pattern - assume same repository
              issueNumbers.add(issueNumber);
              logger.debug(
                `Found issue reference: #${issueNumber} with pattern: ${pattern.source}`
              );
            }
          }
        }
      }

      if (issueNumbers.size === 0 && crossRepoIssues.size === 0) {
        logger.debug('No issue references found in PR body', { prBody });
        return [];
      }

      logger.debug(
        `Found ${issueNumbers.size} same-repo issue references from PR body: ${Array.from(issueNumbers).join(', ')}`
      );

      if (crossRepoIssues.size > 0) {
        logger.debug(
          `Found ${crossRepoIssues.size} cross-repo issue references: ${Array.from(
            crossRepoIssues
          )
            .map(i => `${i.owner}/${i.repo}#${i.number}`)
            .join(', ')}`
        );
      }

      // Also check PR timeline events for connected issues if PR number is provided
      if (prNumber) {
        try {
          const { data: timelineEvents } =
            await this.octokit.rest.issues.listEventsForTimeline({
              owner,
              repo,
              issue_number: prNumber,
              per_page: 100,
            });

          for (const event of timelineEvents) {
            // Look for "connected" or "cross-referenced" events that link to issues
            if (
              event.event === 'connected' ||
              event.event === 'cross-referenced'
            ) {
              const source = (
                event as {
                  source?: {
                    issue?: { number: number; pull_request?: unknown };
                  };
                }
              ).source;
              if (source?.issue && !source.issue.pull_request) {
                issueNumbers.add(source.issue.number);
                logger.debug(
                  `Found connected issue from timeline: #${source.issue.number}`
                );
              }
            }
          }
        } catch (timelineError) {
          logger.warn('Error fetching PR timeline for linked issues', {
            error:
              timelineError instanceof Error
                ? timelineError.message
                : String(timelineError),
          });
        }
      }

      if (issueNumbers.size === 0 && crossRepoIssues.size === 0) {
        logger.debug('No issue references found in PR body or timeline');
        return [];
      }

      logger.debug(
        `Total issue references found: ${issueNumbers.size} same-repo + ${crossRepoIssues.size} cross-repo`
      );

      // Fetch issue details for all referenced issues
      const issues: LinkedIssue[] = [];

      // Fetch same-repository issues
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

          // Fetch project iteration information
          const projectIteration = await this.getIssueProjectIteration(
            owner,
            repo,
            issueNumber
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
            project_iteration: projectIteration || undefined,
          });

          logger.debug(
            `Fetched issue #${issueNumber}: ${issue.title} with ${lifecycleEvents.length} lifecycle events${projectIteration ? ` and iteration ${projectIteration.iterationTitle}` : ''}`
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

      // Fetch cross-repository issues
      for (const crossRepoIssue of crossRepoIssues) {
        try {
          const { data: issue } = await this.octokit.rest.issues.get({
            owner: crossRepoIssue.owner,
            repo: crossRepoIssue.repo,
            issue_number: crossRepoIssue.number,
          });

          // Skip if it's actually a PR
          if (issue.pull_request) {
            continue;
          }

          // Fetch issue lifecycle events
          const lifecycleEvents = await this.getIssueLifecycleEvents(
            crossRepoIssue.owner,
            crossRepoIssue.repo,
            crossRepoIssue.number,
            issue.created_at
          );

          // Fetch project iteration information
          const projectIteration = await this.getIssueProjectIteration(
            crossRepoIssue.owner,
            crossRepoIssue.repo,
            crossRepoIssue.number
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
            project_iteration: projectIteration || undefined,
          });

          logger.debug(
            `Fetched cross-repo issue ${crossRepoIssue.owner}/${crossRepoIssue.repo}#${crossRepoIssue.number}: ${issue.title} with ${lifecycleEvents.length} lifecycle events${projectIteration ? ` and iteration ${projectIteration.iterationTitle}` : ''}`
          );

          // Add small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (issueError) {
          logger.warn(
            `Could not fetch cross-repo issue ${crossRepoIssue.owner}/${crossRepoIssue.repo}#${crossRepoIssue.number}`,
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

      logger.info(`Found ${issues.length} linked issues for PR`, {
        sameRepoIssues: Array.from(issueNumbers),
        crossRepoIssues: Array.from(crossRepoIssues).map(
          i => `${i.owner}/${i.repo}#${i.number}`
        ),
        successfullyFetched: issues.map(i => `#${i.number}: ${i.title}`),
      });
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
   * Fetch the first release that includes a specific commit SHA
   */
  async getFirstReleaseForCommit(
    owner: string,
    repo: string,
    commitSha: string,
    prMergedAt: string
  ): Promise<{
    tag_name: string;
    published_at: string;
    html_url: string;
  } | null> {
    try {
      const mergedDate = new Date(prMergedAt);

      // Fetch releases published after the PR merge date (with some buffer)
      // Add a 1-day buffer before merge date in case of timezone issues
      const searchFromDate = new Date(
        mergedDate.getTime() - 24 * 60 * 60 * 1000
      );

      logger.debug(
        `Searching for releases after ${searchFromDate.toISOString()} for commit ${commitSha.substring(0, 8)}`
      );

      // Fetch releases (GitHub returns them in descending order by created_at)
      const { data: releases } = await this.octokit.rest.repos.listReleases({
        owner,
        repo,
        per_page: 50, // Reduced from 100 to speed up
      });

      // Filter and sort releases by published date (oldest first)
      // Only consider releases published after (or close to) the PR merge
      const relevantReleases = releases
        .filter(release => {
          if (!release.published_at) return false;
          const releaseDate = new Date(release.published_at);
          return releaseDate >= searchFromDate;
        })
        .sort((a, b) => {
          const dateA = new Date(a.published_at!).getTime();
          const dateB = new Date(b.published_at!).getTime();
          return dateA - dateB;
        });

      if (relevantReleases.length === 0) {
        logger.debug(
          `No releases found after ${searchFromDate.toISOString()} for commit ${commitSha.substring(0, 8)}`
        );
        return null;
      }

      logger.debug(
        `Found ${relevantReleases.length} releases to check for commit ${commitSha.substring(0, 8)}`
      );

      // Parse version numbers to identify the main (non-backport) version line
      // Main version line is typically the highest major version
      const versionsWithReleases = relevantReleases
        .map(release => {
          const versionMatch = release.tag_name.match(/v?(\d+)\.(\d+)\.(\d+)/);
          if (versionMatch) {
            return {
              release,
              major: parseInt(versionMatch[1]),
              minor: parseInt(versionMatch[2]),
              patch: parseInt(versionMatch[3]),
            };
          }
          return null;
        })
        .filter(v => v !== null);

      // Find the highest major version (main line)
      const maxMajorVersion = Math.max(
        ...versionsWithReleases.map(v => v!.major)
      );

      logger.debug(
        `Identified main version line: v${maxMajorVersion}.x from ${versionsWithReleases.length} releases`
      );

      // Separate main line releases from backports
      const mainLineReleases = versionsWithReleases
        .filter(v => v!.major === maxMajorVersion)
        .map(v => v!.release);

      const backportReleases = versionsWithReleases
        .filter(v => v!.major < maxMajorVersion)
        .map(v => v!.release);

      // Check main line releases first, then backports
      const releasesToCheck = [
        ...mainLineReleases.slice(0, 5), // Check first 5 main line releases
        ...backportReleases.slice(0, 5), // Then first 5 backports
      ];

      for (const release of releasesToCheck) {
        try {
          // Compare the commit with the release tag
          const { data: comparison } =
            await this.octokit.rest.repos.compareCommitsWithBasehead({
              owner,
              repo,
              basehead: `${commitSha}...${release.tag_name}`,
            });

          logger.debug(
            `Comparison result for ${commitSha.substring(0, 8)}...${release.tag_name}: ${comparison.status} (ahead: ${comparison.ahead_by}, behind: ${comparison.behind_by})`
          );

          // If the commit is behind or identical with the release tag, it's included
          // For "diverged" status, if behind_by > 0, it means the release tag has commits
          // that came after our commit, so the commit is likely included
          if (
            comparison.status === 'behind' ||
            comparison.status === 'identical' ||
            (comparison.status === 'diverged' && comparison.behind_by > 0)
          ) {
            logger.info(
              `Found first release for commit ${commitSha.substring(0, 8)}: ${release.tag_name}`
            );
            return {
              tag_name: release.tag_name,
              published_at: release.published_at!,
              html_url: release.html_url,
            };
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

      logger.debug(`No release found for commit ${commitSha.substring(0, 8)}`);
      return null;
    } catch (error) {
      logger.warn('Error fetching releases for commit', {
        error: error instanceof Error ? error.message : String(error),
        commitSha: commitSha.substring(0, 8),
      });
      return null;
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
}
