import { Octokit } from '@octokit/rest';
import {
  TimelineEvent,
  ReviewTiming,
  LinkedIssue,
  PullRequestStats,
} from './types';
import { logger } from './logger';
import {
  calculateMetricsFromTimeline,
  BuildkiteService,
  CodeOwnersService,
  ReviewService,
  ReleaseService,
  IssuesService,
} from './services';

export type ProgressCallback = (
  step: string,
  current: number,
  total: number
) => void;

export class GitHubCollector {
  public octokit: Octokit;
  private progressCallback?: ProgressCallback;

  // Service instances
  private buildkiteService: BuildkiteService;
  private codeownersService: CodeOwnersService;
  private reviewService: ReviewService;
  private releaseService: ReleaseService;
  private issuesService: IssuesService;

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

    this.progressCallback = progressCallback;

    // Initialize services
    this.buildkiteService = new BuildkiteService(
      buildkiteToken,
      buildkiteOrgSlug
    );
    this.codeownersService = new CodeOwnersService(this.octokit);
    this.issuesService = new IssuesService(this.octokit);
    this.reviewService = new ReviewService(this.octokit);
    this.releaseService = new ReleaseService(this.octokit);

    if (buildkiteToken && buildkiteOrgSlug) {
      logger.info('Buildkite integration enabled');
    }
  }

  private reportProgress(step: string, current: number = 1, total: number = 1) {
    if (this.progressCallback) {
      this.progressCallback(step, current, total);
    }
  }

  /**
   * Builds complete PR statistics including timeline and all calculated metrics
   */
  async buildCompletePRStats(
    owner: string,
    repo: string,
    prNumber: number,
    onProgress?: (step: string, current: number, total: number) => void
  ): Promise<PullRequestStats> {
    const sendProgress = onProgress || (() => {});

    sendProgress('Fetching PR data', 5, 100);

    // Fetch PR data
    const { data: pr } = await this.octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    });

    if (!pr) {
      throw new Error('PR not found');
    }

    logger.info(`Found PR: ${pr.title} (${pr.user?.login})`);

    sendProgress('Fetching related data', 10, 100);

    // Fetch PR timeline events once (used by both linkedIssues and buildPRTimeline)
    const { data: prTimelineEvents } =
      await this.octokit.rest.issues.listEventsForTimeline({
        owner,
        repo,
        issue_number: prNumber,
        per_page: 100,
      });

    // Fetch related data in parallel
    const [userTeams, codeowners, linkedIssues] = await Promise.all([
      this.reviewService.getUserTeams(pr.user?.login || '', owner),
      this.codeownersService.getCodeOwnersForPR(owner, repo, prNumber),
      this.issuesService.getLinkedIssues(
        owner,
        repo,
        pr.body,
        prNumber,
        prTimelineEvents
      ),
    ]);

    sendProgress('Fetched related data', 20, 100);

    // Prepare initial PR data structure
    const prDataForTimeline: PullRequestStats = {
      id: pr.number,
      url: pr.html_url,
      state: pr.state,
      additions: pr.additions || 0,
      author: pr.user?.login || 'unknown',
      changed_files: pr.changed_files || 0,
      created_at: pr.created_at,
      closed_at: pr.closed_at,
      merged_at: pr.merged_at,
      updated_at: pr.updated_at,
      metrics: { turnaround_time_hours: 0 },
      reviews: {
        back_and_forth_count: 0,
        comments: 0,
        review_comments: 0,
        review_timings: [],
        requested_teams: pr.requested_teams?.map(team => team.slug) || [],
      },
      build_stats: {
        total_builds: 0,
        completed_builds: 0,
        failed_builds: 0,
        successful_builds: 0,
        total_build_time_ms: 0,
      },
      commits: 0,
      deletions: pr.deletions || 0,
      title: pr.title,
      timeline: [],
      headSha: pr.head.sha,
      mergeCommitSha: pr.merge_commit_sha,
      author_teams: [],
      draft: pr.draft,
    };

    sendProgress('Calculating review timings', 50, 100);

    const reviewTimings = await this.reviewService.getReviewTimings(
      owner,
      repo,
      prNumber,
      pr.created_at,
      userTeams,
      codeowners.teams.map(team => team)
    );

    sendProgress('Building timeline', 70, 100);

    // Build timeline (pass through progress callback for internal progress)
    const timeline = await this.buildPRTimeline(
      owner,
      repo,
      prNumber,
      prDataForTimeline,
      reviewTimings,
      linkedIssues,
      (step, current, total) => {
        // Map internal progress (0-10) to our range (70-85)
        const percentage = 70 + Math.floor((current / total) * 15);
        sendProgress(step, percentage, 100);
      }
    );

    sendProgress('Calculating metrics', 85, 100);

    // Calculate all metrics from timeline
    const metrics = calculateMetricsFromTimeline(timeline, pr, linkedIssues);

    sendProgress('Finalizing data', 95, 100);

    // Build complete PR stats object
    const prStats: PullRequestStats = {
      id: pr.number,
      url: pr.html_url,
      state: pr.state,
      draft: pr.draft,
      linked_issues: linkedIssues,
      commits: metrics.commitCount,
      additions: pr.additions || 0,
      deletions: pr.deletions || 0,
      author: pr.user?.login || 'unknown',
      author_teams: userTeams,
      changed_files: pr.changed_files || 0,
      created_at: pr.created_at,
      closed_at: pr.closed_at,
      merged_at: pr.merged_at,
      updated_at: pr.updated_at,
      codeowners: {
        teams: codeowners.teams,
        individuals: codeowners.individuals || [],
      },
      headSha: pr.head.sha,
      mergeCommitSha: pr.merge_commit_sha,
      metrics: {
        turnaround_time_hours: pr.closed_at
          ? Math.round(
              ((new Date(pr.closed_at).getTime() -
                new Date(pr.created_at).getTime()) /
                (1000 * 60 * 60)) *
                100
            ) / 100
          : 0,
        complexity: metrics.complexity,
        delivery_friction: metrics.deliveryFriction,
        total_team_review_time_ms: metrics.totalTeamReviewTimeMs,
        author_codeowner_relationship: metrics.authorCodeownerRelationship,
        run_start_time: metrics.runStartTime,
        run_end_time: metrics.runEndTime,
      },
      build_stats: metrics.buildStats,
      reviews: {
        back_and_forth_count: metrics.backAndForthCount,
        comments: metrics.issueCommentsCount,
        review_comments: metrics.reviewCommentsCount,
        review_timings: reviewTimings,
        requested_teams: pr.requested_teams?.map(team => team.slug) || [],
      },
      timeline,
      title: pr.title,
    };

    sendProgress('Complete', 100, 100);

    return prStats;
  }

  async buildPRTimeline(
    owner: string,
    repo: string,
    prNumber: number,
    prData: PullRequestStats,
    reviewTimings: ReviewTiming[],
    linkedIssues?: LinkedIssue[],
    onProgress?: (step: string, current: number, total: number) => void
  ): Promise<TimelineEvent[]> {
    const timeline: TimelineEvent[] = [];
    const reportProgress = onProgress || (() => {});

    try {
      reportProgress('Initializing timeline', 1, 10);

      // Check if PR was opened as draft
      timeline.push({
        type: prData.draft ? 'opened_draft' : 'opened',
        date: prData.created_at,
      });

      reportProgress('Fetching timeline events', 2, 10);

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

      reportProgress('Fetching commits', 3, 10);

      // Fetch commits
      const { data: commits } = await this.octokit.rest.pulls.listCommits({
        owner,
        repo,
        pull_number: prNumber,
        per_page: 100,
      });

      // Show each commit individually
      const commitGroups: Array<{
        date: string;
        commits: Array<{
          sha: string;
          message: string;
          full_message?: string;
          body?: string;
          author: string;
          date: string;
        }>;
      }> = [];

      for (const commit of commits) {
        const commitDate = new Date(commit.commit.author?.date || '');
        const [title, ...bodyLines] = commit.commit.message.split('\n');
        const body = bodyLines.join('\n').trim();

        // Create a separate group for each commit
        commitGroups.push({
          date: commitDate.toISOString(),
          commits: [
            {
              sha: commit.sha.substring(0, 8),
              message: title,
              full_message: commit.commit.message,
              body: body || undefined,
              author: commit.commit.author?.name || 'Unknown',
              date: commit.commit.author?.date || '',
            },
          ],
        });
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
              await this.buildkiteService.getBuildkiteBuildsForCommit(fullSha);

            for (const build of buildkiteBuilds) {
              // Create enriched CI events from Buildkite data
              const buildkiteEvents =
                this.buildkiteService.createCIEventsFromBuildkiteBuild(build, {
                  includeJobs: true, // Create job events for cache
                  hideJobsFromTimeline: false, // Show them in timeline (in collapsible CI Jobs row)
                });

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

      reportProgress('Fetching comments', 5, 10);

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
          url: comment.html_url,
          comment_id: comment.id,
        });
      }

      reportProgress('Fetching review comments', 6, 10);

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
          url: comment.html_url,
          comment_id: comment.id,
        });
      }

      reportProgress('Processing linked issues', 7, 10);

      // Add linked issue lifecycle events to the timeline
      if (linkedIssues && linkedIssues.length > 0) {
        for (const issue of linkedIssues) {
          for (const event of issue.lifecycle_events) {
            timeline.push({
              type: `issue_${event.event_type}`,
              date: event.date,
              end_date: event.end_date,
              issue_number: issue.number,
              issue_title: issue.title,
              assignee: event.assignee,
            });
          }

          // Iteration events removed - no longer displaying iteration timeline
        }
      }

      reportProgress('Processing reviews', 8, 10);

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
          url: reviewTiming.url,
          submitted_at: reviewTiming.submitted_at,
          review_body: reviewTiming.body,
        });
      }

      // Extract team review requests from timeline events if provided
      if (prTimelineEvents) {
        try {
          // Look for review_requested events for teams
          const teamRequestEvents = prTimelineEvents.filter(
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
          console.log('Error processing timeline events:', error);
        }
      }

      reportProgress('Checking releases', 9, 10);

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

            const releases = await Promise.race([
              this.releaseService.getFirstReleasesForCommit(
                owner,
                repo,
                commitToCheck,
                prData.merged_at
              ),
              new Promise<Array<any>>(resolve =>
                setTimeout(() => resolve([]), 10000)
              ), // 10 second timeout
            ]);

            // Add all releases (up to 3) to the timeline
            for (const release of releases) {
              timeline.push({
                type: 'released',
                date: release.published_at,
                release_tag: release.tag_name,
                url: release.html_url,
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

      reportProgress('Timeline complete', 10, 10);

      return timeline;
    } catch (error) {
      logger.error('Error building timeline for PR', {
        prNumber,
        error: error instanceof Error ? error.message : String(error),
      });
      return timeline;
    }
  }
}
