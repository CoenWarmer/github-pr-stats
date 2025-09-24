import { NextRequest, NextResponse } from 'next/server';
import { GitHubCollector } from '@/lib/github-collector';
import { logger } from '@/lib/logger';
import { PullRequestStats } from '@/lib/types';

export async function GET(
  request: NextRequest,
  { params }: { params: { owner: string; repo: string; prNumber: string } }
) {
  try {
    const { owner, repo, prNumber } = params;
    const prNum = parseInt(prNumber);

    if (!owner || !repo || isNaN(prNum)) {
      return NextResponse.json(
        { error: 'Invalid parameters. Expected owner, repo, and prNumber.' },
        { status: 400 }
      );
    }

    logger.info(`🚀 Generating visualization for PR #${prNum}`);

    const collector = new GitHubCollector();

    logger.info('Fetching PR from GitHub...');

    // Fetch PR data
    const { data: pr } = await collector.octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: prNum,
    });

    if (!pr) {
      return NextResponse.json({ error: 'PR not found' }, { status: 404 });
    }

    logger.info(`Found PR: ${pr.title} (${pr.user?.login})`);

    // Fetch related data in parallel
    const [
      reviewComments,
      issueComments,
      prCommits,
      userTeams,
      codeowners,
      linkedIssues,
    ] = await Promise.all([
      collector.octokit.rest.pulls.listReviewComments({
        owner,
        repo,
        pull_number: prNum,
      }),
      collector.octokit.rest.issues.listComments({
        owner,
        repo,
        issue_number: prNum,
      }),
      collector.octokit.rest.pulls.listCommits({
        owner,
        repo,
        pull_number: prNum,
      }),
      collector.getUserTeams(pr.user?.login || '', owner),
      collector.parseCodeowners(owner, repo, prNum),
      collector.getLinkedIssues(owner, repo, pr.body),
    ]);

    // Get review timings
    const reviewTimings = await collector.getReviewTimings(
      owner,
      repo,
      prNum,
      pr.created_at,
      userTeams,
      prCommits.data,
      issueComments.data,
      pr.user?.login || ''
    );

    // Prepare PR data for timeline building
    const prData = {
      id: pr.number,
      number: pr.number,
      title: pr.title,
      url: pr.html_url,
      state: pr.state,
      createdAt: pr.created_at,
      updatedAt: pr.updated_at,
      closedAt: pr.closed_at,
      mergedAt: pr.merged_at,
      author: { login: pr.user?.login || 'unknown' },
      headRefName: pr.head.ref,
      headSha: pr.head.sha,
      baseRefName: pr.base.ref,
      draft: pr.draft,
    };

    // Build timeline
    const timeline = await collector.buildPRTimeline(
      owner,
      repo,
      prNum,
      prData,
      reviewTimings,
      linkedIssues
    );

    // Calculate back and forth count
    const sortedReviews = [...reviewTimings].sort((a, b) =>
      a.submitted_at.localeCompare(b.submitted_at)
    );
    let backAndForthCount = 0;
    let lastChangeRequestedIndex = -1;

    for (let i = 0; i < sortedReviews.length; i++) {
      if (sortedReviews[i].state === 'CHANGES_REQUESTED') {
        lastChangeRequestedIndex = i;
      } else if (
        lastChangeRequestedIndex !== -1 &&
        i > lastChangeRequestedIndex
      ) {
        backAndForthCount++;
        lastChangeRequestedIndex = -1;
      }
    }

    // Build PR stats object
    const prStats: PullRequestStats = {
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
      turnaround_time_hours: pr.closed_at
        ? Math.round(
            ((new Date(pr.closed_at).getTime() -
              new Date(pr.created_at).getTime()) /
              (1000 * 60 * 60)) *
              100
          ) / 100
        : 0,
      back_and_forth_count: backAndForthCount,
      comments: issueComments.data.length,
      commits: prCommits.data.length,
      deletions: pr.deletions || 0,
      review_comments: reviewComments.data.length,
      review_timings: reviewTimings,
      title: pr.title,
      timeline: timeline,
      codeowners: codeowners,
      linked_issues: linkedIssues,
    };

    logger.info(`Timeline events collected: ${timeline.length}`);
    logger.info('✅ PR visualization data generated successfully');

    return NextResponse.json({ data: prStats });
  } catch (error) {
    logger.error('Error generating PR visualization', {
      error: error instanceof Error ? error.message : error,
    });

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}

