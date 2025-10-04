import { NextRequest } from 'next/server';
import { GitHubCollector } from '@/lib/github-collector';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  {
    params,
  }: { params: Promise<{ owner: string; repo: string; prNumber: string }> }
) {
  const { owner, repo, prNumber } = await params;
  const prNum = parseInt(prNumber);

  if (!owner || !repo || isNaN(prNum)) {
    return new Response('Invalid parameters', { status: 400 });
  }

  // Check if GitHub token is available
  if (!process.env.GITHUB_TOKEN) {
    return new Response('GitHub token not configured', { status: 500 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const sendProgress = (step: string, current: number, total: number) => {
          const data = JSON.stringify({
            step,
            current,
            total,
            timestamp: Date.now(),
          });
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        };

        sendProgress('Starting data collection', 0, 100);

        const collector = new GitHubCollector(
          process.env.GITHUB_TOKEN,
          process.env.BUILDKITE_TOKEN,
          process.env.BUILDKITE_ORG_SLUG,
          (step, current, total) => {
            // Map progress to 0-50 range for timeline building
            const percentage = Math.floor((current / total) * 50);
            sendProgress(step, percentage, 100);
          }
        );

        sendProgress('Fetching PR data', 5, 100);

        // Fetch PR data
        const { data: pr } = await collector.octokit.rest.pulls.get({
          owner,
          repo,
          pull_number: prNum,
        });

        if (!pr) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ error: 'PR not found' })}\n\n`
            )
          );
          controller.close();
          return;
        }

        sendProgress('Fetching related data', 10, 100);

        // Fetch related data in parallel
        const [userTeams, linkedIssues] = await Promise.all([
          collector.getUserTeams(pr.user?.login || '', owner),
          collector.getLinkedIssues(owner, repo, pr.body, prNum),
        ]);

        sendProgress('Fetched related data', 20, 100);

        const prDataForTimeline = {
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
          turnaround_time_hours: 0,
          back_and_forth_count: 0,
          comments: 0,
          commits: 0,
          deletions: pr.deletions || 0,
          review_comments: 0,
          review_timings: [],
          title: pr.title,
          timeline: [],
          headSha: pr.head.sha,
          mergeCommitSha: pr.merge_commit_sha,
          requested_teams: pr.requested_teams?.map(team => team.slug) || [],
        };

        sendProgress('Building timeline', 25, 100);

        const basicTimeline = await collector.buildPRTimeline(
          owner,
          repo,
          prNum,
          prDataForTimeline,
          [],
          linkedIssues
        );

        sendProgress('Calculating review timings', 60, 100);

        const reviewTimings = await collector.getReviewTimings(
          owner,
          repo,
          prNum,
          pr.created_at,
          userTeams,
          pr.requested_teams?.map(team => team.slug) || [],
          basicTimeline
        );

        sendProgress('Building final timeline', 70, 100);

        await collector.buildPRTimeline(
          owner,
          repo,
          prNum,
          prDataForTimeline,
          reviewTimings,
          linkedIssues
        );

        sendProgress('Processing complete', 100, 100);

        // Send completion message
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ complete: true })}\n\n`)
        );
        controller.close();
      } catch (error) {
        logger.error('Error in progress stream', {
          error: error instanceof Error ? error.message : error,
        });
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' })}\n\n`
          )
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
