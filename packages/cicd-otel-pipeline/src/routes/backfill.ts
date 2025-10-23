import type { Request, Response, Router } from 'express';
import { octokit } from '../octokit.js';
import { config } from '../config.js';
import {
  handleGithubPREvent,
  handleGithubReviewEvent,
  handleGithubReviewCommentEvent,
} from '../github/handlers.js';
import { handleBuildkiteBuildEvent } from '../buildkite/handlers.js';
import { prTraceExists } from '../elasticsearch.js';
import type {
  PREvent,
  ReviewEvent,
  ReviewCommentEvent,
  BuildkiteBuildEvent,
  PullRequest,
  Review,
  ReviewComment,
  BuildkiteApiBuild,
} from '../types.js';

export function registerBackfillRoutes(app: Router): void {
  // Backfill endpoint for historical GitHub data
  app.post('/backfill/github', async (req: Request, res: Response) => {
    if (!octokit) {
      return res.status(503).json({
        error: 'GitHub token not configured. Set GITHUB_TOKEN to use backfill.',
      });
    }

    const { owner, repo, since, until, state = 'all' } = req.body;

    if (!owner || !repo) {
      return res.status(400).json({
        error: 'Missing required fields: owner and repo',
      });
    }

    res.status(202).json({
      message: 'Backfill started',
      params: { owner, repo, since, until, state },
    });

    try {
      console.log(
        `[Backfill] Starting GitHub backfill for ${owner}/${repo}...`
      );

      const params = {
        owner,
        repo,
        state,
        sort: 'created' as const,
        direction: 'desc' as const,
        per_page: 100,
      };

      let prCount = 0;
      let skippedCount = 0;
      let eventCount = 0;

      for await (const response of octokit.paginate.iterator(
        octokit.rest.pulls.list,
        params
      )) {
        for (const pr of response.data) {
          if (since && new Date(pr.created_at) < new Date(since)) continue;
          if (until && new Date(pr.created_at) > new Date(until)) continue;

          // Check if PR trace already exists (skip if already backfilled)
          const exists = await prTraceExists(`${owner}/${repo}`, pr.number);
          if (exists) {
            skippedCount++;
            console.log(
              `[Backfill] Skipping PR #${pr.number} (already exists)`
            );
            continue;
          }

          prCount++;
          console.log(`[Backfill] Processing PR #${pr.number}: ${pr.title}`);

          const prEvent: PREvent = {
            action: 'opened',
            number: pr.number,
            pull_request: pr as PullRequest,
            repository: {
              full_name: `${owner}/${repo}`,
            },
          };

          await handleGithubPREvent(prEvent);
          eventCount++;

          try {
            const { data: reviews } = await octokit.rest.pulls.listReviews({
              owner,
              repo,
              pull_number: pr.number,
            });

            for (const review of reviews) {
              const reviewEvent: ReviewEvent = {
                action: 'submitted',
                review: review as Review,
                pull_request: pr as PullRequest,
                repository: {
                  full_name: `${owner}/${repo}`,
                },
              };

              await handleGithubReviewEvent(reviewEvent);
              eventCount++;
            }
          } catch (err) {
            const message =
              err instanceof Error ? err.message : 'Unknown error';
            console.error(
              `[Backfill] Error fetching reviews for PR #${pr.number}:`,
              message
            );
          }

          try {
            const { data: comments } =
              await octokit.rest.pulls.listReviewComments({
                owner,
                repo,
                pull_number: pr.number,
              });

            for (const comment of comments) {
              const commentEvent: ReviewCommentEvent = {
                action: 'created',
                comment: comment as ReviewComment,
                pull_request: pr as PullRequest,
                repository: {
                  full_name: `${owner}/${repo}`,
                },
              };

              await handleGithubReviewCommentEvent(commentEvent);
              eventCount++;
            }
          } catch (err) {
            const message =
              err instanceof Error ? err.message : 'Unknown error';
            console.error(
              `[Backfill] Error fetching review comments for PR #${pr.number}:`,
              message
            );
          }

          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      console.log(
        `[Backfill] Completed: ${prCount} PRs processed, ${skippedCount} PRs skipped (already exist), ${eventCount} events total`
      );
    } catch (error) {
      console.error('[Backfill] Error:', error);
    }
  });

  // Backfill endpoint for historical Buildkite data
  app.post('/backfill/buildkite', async (req: Request, res: Response) => {
    const { organization, pipeline, since, until, branch, state } = req.body;

    if (!organization || !pipeline) {
      return res.status(400).json({
        error: 'Missing required fields: organization and pipeline',
      });
    }

    if (!config.githubToken) {
      return res.status(503).json({
        error: 'GITHUB_TOKEN required for Buildkite API access',
      });
    }

    res.status(202).json({
      message: 'Backfill started',
      params: { organization, pipeline, since, until, branch, state },
    });

    try {
      console.log(
        `[Backfill] Starting Buildkite backfill for ${organization}/${pipeline}...`
      );

      // Buildkite API base URL
      const buildkiteApiUrl = 'https://api.buildkite.com/v2';

      let page = 1;
      let hasMore = true;
      let buildCount = 0;
      let eventCount = 0;

      while (hasMore) {
        const params = new URLSearchParams({
          page: page.toString(),
          per_page: '100',
        });

        if (branch) params.append('branch', branch);
        if (state) params.append('state', state);

        const url = `${buildkiteApiUrl}/organizations/${organization}/pipelines/${pipeline}/builds?${params}`;

        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${config.githubToken}`,
          },
        });

        if (!response.ok) {
          throw new Error(
            `Buildkite API error: ${response.status} ${response.statusText}`
          );
        }

        const builds = (await response.json()) as BuildkiteApiBuild[];

        if (builds.length === 0) {
          hasMore = false;
          break;
        }

        for (const build of builds) {
          // Filter by date if provided
          if (since && new Date(build.created_at) < new Date(since)) {
            hasMore = false;
            break;
          }
          if (until && new Date(build.created_at) > new Date(until)) continue;

          buildCount++;
          console.log(
            `[Backfill] Processing build #${build.number}: ${build.message}`
          );

          // Transform API response to webhook format
          const buildEvent: BuildkiteBuildEvent = {
            event: `build.${build.state}`,
            build: {
              id: build.id,
              number: build.number,
              state: build.state,
              message: build.message,
              branch: build.branch,
              commit: build.commit,
              url: build.url,
              web_url: build.web_url,
              started_at: build.started_at,
              finished_at: build.finished_at,
              created_at: build.created_at,
              pipeline: {
                name: build.pipeline.name,
                slug: build.pipeline.slug,
                repository: build.pipeline.repository,
              },
              creator: {
                name: build.creator.name,
                email: build.creator.email,
              },
              jobs: build.jobs?.map(job => ({
                id: job.id,
                name: job.name,
                state: job.state,
                started_at: job.started_at,
                finished_at: job.finished_at,
                exit_status: job.exit_status,
              })),
              pull_request: build.pull_request
                ? {
                    id: build.pull_request.id,
                    number: parseInt(
                      build.pull_request.id.split('/').pop() || '0'
                    ),
                    repository: build.pull_request.repository,
                  }
                : undefined,
            },
          };

          await handleBuildkiteBuildEvent(buildEvent);
          eventCount++;

          await new Promise(resolve => setTimeout(resolve, 200));
        }

        page++;
      }

      console.log(
        `[Backfill] Completed: ${buildCount} builds, ${eventCount} events processed`
      );
    } catch (error) {
      console.error('[Backfill] Error:', error);
    }
  });
}
