import { NextRequest, NextResponse } from 'next/server';
import { GitHubCollector } from '@/lib/github-collector';
import { logger } from '@/lib/logger';
import { PullRequestStats } from '@/lib/types';
import { calculatePRComplexity, calculateDeliveryFriction } from '@/lib/utils';
import * as fs from 'fs';
import * as path from 'path';

// File-based cache configuration
interface CacheEntry {
  data: PullRequestStats;
  timestamp: number;
  expiresAt: number;
}

const CACHE_TTL = 60 * 60 * 1000; // 60 minutes in milliseconds
const CACHE_DIR = path.join(process.cwd(), 'data', 'cache');

// Ensure cache directory exists
function ensureCacheDir(): void {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    logger.debug(`Created cache directory: ${CACHE_DIR}`);
  }
}

function getCacheKey(owner: string, repo: string, prNumber: number): string {
  return `${owner}-${repo}-${prNumber}`;
}

function getCacheFilePath(cacheKey: string): string {
  return path.join(CACHE_DIR, `${cacheKey}.json`);
}

function getCachedData(cacheKey: string): PullRequestStats | null {
  try {
    const filePath = getCacheFilePath(cacheKey);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const entry: CacheEntry = JSON.parse(fileContent);

    // Check if cache entry has expired
    if (Date.now() > entry.expiresAt) {
      fs.unlinkSync(filePath);
      logger.debug(`Cache expired and removed for ${cacheKey}`);
      return null;
    }

    logger.info(`Cache hit for ${cacheKey}`);
    return entry.data;
  } catch (error) {
    logger.warn(`Error reading cache for ${cacheKey}:`, error);
    // Clean up corrupted cache file
    try {
      const filePath = getCacheFilePath(cacheKey);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (cleanupError) {
      logger.warn(`Error cleaning up corrupted cache file:`, cleanupError);
    }
    return null;
  }
}

function setCachedData(cacheKey: string, data: PullRequestStats): void {
  try {
    ensureCacheDir();

    const now = Date.now();
    const entry: CacheEntry = {
      data,
      timestamp: now,
      expiresAt: now + CACHE_TTL,
    };

    const filePath = getCacheFilePath(cacheKey);
    fs.writeFileSync(filePath, JSON.stringify(entry, null, 2), 'utf-8');

    logger.info(
      `Cached data to file for ${cacheKey} (expires in ${CACHE_TTL / 1000 / 60}m)`
    );
  } catch (error) {
    logger.error(`Error writing cache for ${cacheKey}:`, error);
  }
}

function clearCacheEntry(cacheKey: string): boolean {
  try {
    const filePath = getCacheFilePath(cacheKey);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      logger.info(`Cache file removed for ${cacheKey}`);
      return true;
    }
    return false;
  } catch (error) {
    logger.error(`Error removing cache file for ${cacheKey}:`, error);
    return false;
  }
}

function clearAllCache(): number {
  try {
    ensureCacheDir();
    const files = fs.readdirSync(CACHE_DIR);
    const cacheFiles = files.filter(file => file.endsWith('.json'));

    let removedCount = 0;
    for (const file of cacheFiles) {
      try {
        fs.unlinkSync(path.join(CACHE_DIR, file));
        removedCount++;
      } catch (error) {
        logger.warn(`Error removing cache file ${file}:`, error);
      }
    }

    logger.info(`Cleared ${removedCount} cache files`);
    return removedCount;
  } catch (error) {
    logger.error('Error clearing all cache:', error);
    return 0;
  }
}

function getCacheStats(): {
  totalFiles: number;
  totalSize: number;
  oldestFile?: string;
  newestFile?: string;
} {
  try {
    ensureCacheDir();
    const files = fs.readdirSync(CACHE_DIR);
    const cacheFiles = files.filter(file => file.endsWith('.json'));

    let totalSize = 0;
    let oldestTime = Number.MAX_SAFE_INTEGER;
    let newestTime = 0;
    let oldestFile = '';
    let newestFile = '';

    for (const file of cacheFiles) {
      try {
        const filePath = path.join(CACHE_DIR, file);
        const stats = fs.statSync(filePath);
        totalSize += stats.size;

        if (stats.mtime.getTime() < oldestTime) {
          oldestTime = stats.mtime.getTime();
          oldestFile = file;
        }

        if (stats.mtime.getTime() > newestTime) {
          newestTime = stats.mtime.getTime();
          newestFile = file;
        }
      } catch (error) {
        logger.warn(`Error getting stats for cache file ${file}:`, error);
      }
    }

    return {
      totalFiles: cacheFiles.length,
      totalSize,
      oldestFile: oldestFile || undefined,
      newestFile: newestFile || undefined,
    };
  } catch (error) {
    logger.error('Error getting cache stats:', error);
    return { totalFiles: 0, totalSize: 0 };
  }
}

// Helper function to collect PR data with optional progress callback
async function collectPRData(
  owner: string,
  repo: string,
  prNum: number,
  onProgress?: (step: string, current: number, total: number) => void
): Promise<PullRequestStats> {
  const sendProgress = onProgress || (() => {});

  sendProgress('Starting data collection', 0, 100);

  const collector = new GitHubCollector(
    process.env.GITHUB_TOKEN!,
    process.env.BUILDKITE_TOKEN,
    process.env.BUILDKITE_ORG_SLUG,
    onProgress
      ? (step, current, total) => {
          // Map progress to 0-50 range for timeline building
          const percentage = Math.floor((current / total) * 50);
          sendProgress(step, percentage, 100);
        }
      : undefined
  );

  sendProgress('Fetching PR data', 5, 100);

  // Fetch PR data
  const { data: pr } = await collector.octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: prNum,
  });

  if (!pr) {
    throw new Error('PR not found');
  }

  logger.info(`Found PR: ${pr.title} (${pr.user?.login})`);

  sendProgress('Fetching related data', 10, 100);

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
    collector.getUserTeams(pr.user?.login || '', owner, repo),
    collector.getCodeOwnersForPR(owner, repo, prNum),
    collector.getLinkedIssues(owner, repo, pr.body, prNum),
  ]);

  sendProgress('Fetched related data', 20, 100);

  // Prepare PR data for timeline building
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
  };

  sendProgress('Calculating review timings', 50, 100);

  // Get review timings - this needs requestedTeams from timeline, so we'll extract them
  // from the raw review request events
  const { data: prTimelineEvents } =
    await collector.octokit.rest.issues.listEventsForTimeline({
      owner,
      repo,
      issue_number: prNum,
      per_page: 100,
    });

  // Extract team review requests from timeline
  const teamReviewRequests = prTimelineEvents
    .filter(
      event =>
        event.event === 'review_requested' &&
        'requested_team' in event &&
        event.requested_team
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((event: any) => event.requested_team?.slug)
    .filter((team): team is string => Boolean(team));

  const allRequestedTeams = [
    ...new Set([
      ...(pr.requested_teams?.map(team => team.slug) || []),
      ...teamReviewRequests,
    ]),
  ];

  const reviewTimings = await collector.getReviewTimings(
    owner,
    repo,
    prNum,
    pr.created_at,
    userTeams,
    allRequestedTeams,
    [] // Empty array since we don't need the full timeline yet
  );

  sendProgress('Building timeline', 70, 100);

  // Now build the complete timeline once with review timings
  const timeline = await collector.buildPRTimeline(
    owner,
    repo,
    prNum,
    prDataForTimeline,
    reviewTimings,
    linkedIssues
  );

  sendProgress('Finalizing data', 80, 100);

  // Calculate back-and-forth interactions
  let backAndForthCount = 0;
  let lastCommentAuthor = '';
  for (const event of timeline) {
    if (
      (event.type === 'comment_added' ||
        event.type === 'review_comment_added') &&
      'author' in event &&
      typeof event.author === 'string'
    ) {
      if (lastCommentAuthor && lastCommentAuthor !== event.author) {
        backAndForthCount++;
      }
      lastCommentAuthor = event.author;
    }
  }

  // Build the complete PR stats object
  const prStats: PullRequestStats = {
    id: pr.number,
    url: pr.html_url,
    state: pr.state,
    draft: pr.draft,
    linked_issues: linkedIssues,
    commits: prCommits.data.length,
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
      complexity: 0,
      delivery_friction: 0,
      total_team_review_time_ms: 0,
    },
    build_stats: {
      total_builds: 0,
      completed_builds: 0,
      failed_builds: 0,
      successful_builds: 0,
      total_build_time_ms: 0,
    },
    reviews: {
      back_and_forth_count: backAndForthCount,
      comments: issueComments.data.length,
      review_comments: reviewComments.data.length,
      review_timings: reviewTimings,
      requested_teams: pr.requested_teams?.map(team => team.slug) || [],
    },
    timeline,
    title: pr.title,
  };

  sendProgress('Calculating metrics', 85, 100);

  // Calculate PR complexity
  const complexity = calculatePRComplexity(prStats);
  prStats.metrics.complexity = complexity;

  // Calculate delivery friction
  const totalBuildMinutes =
    timeline
      .filter(event => event.type === 'ci_run')
      .reduce((sum, event) => sum + (event.duration_ms || 0), 0) /
    (1000 * 60);

  const totalWaitingMinutes =
    timeline
      .filter(event => event.type === 'awaiting_review')
      .reduce((sum, event) => sum + (event.duration_ms || 0), 0) /
    (1000 * 60);

  const deliveryFriction = calculateDeliveryFriction(
    prStats,
    totalBuildMinutes,
    totalWaitingMinutes
  );
  prStats.metrics.delivery_friction = deliveryFriction;

  // Calculate total team review time
  let totalTeamReviewTimeMs = 0;
  for (const event of timeline) {
    if (
      event.type === 'team_review_requested' &&
      'requested_team' in event &&
      typeof event.requested_team === 'string'
    ) {
      const requestTime = new Date(event.date).getTime();
      const teamName = event.requested_team;
      const firstApproval = timeline.find(
        e =>
          e.type === 'review' &&
          e.date > event.date &&
          'state' in e &&
          e.state?.toLowerCase() === 'approved' &&
          'reviewer_teams' in e &&
          Array.isArray(e.reviewer_teams) &&
          e.reviewer_teams.includes(teamName)
      );

      if (firstApproval) {
        const durationMs = new Date(firstApproval.date).getTime() - requestTime;
        totalTeamReviewTimeMs += durationMs;
      }
    }
  }

  prStats.metrics.total_team_review_time_ms = totalTeamReviewTimeMs;

  // Calculate build statistics
  const allCiBuilds = timeline.filter(event => event.type === 'ci_run');
  const totalBuilds = allCiBuilds.length;
  const completedBuilds = allCiBuilds.filter(
    event => event.ci_status === 'completed'
  ).length;
  const failedBuilds = allCiBuilds.filter(
    event =>
      event.ci_conclusion === 'failure' || event.ci_conclusion === 'error'
  ).length;
  const successfulBuilds = allCiBuilds.filter(
    event => event.ci_conclusion === 'success'
  ).length;
  const totalBuildTimeMs = allCiBuilds.reduce(
    (sum, event) => sum + (event.duration_ms || 0),
    0
  );

  prStats.build_stats.total_builds = totalBuilds;
  prStats.build_stats.completed_builds = completedBuilds;
  prStats.build_stats.failed_builds = failedBuilds;
  prStats.build_stats.successful_builds = successfulBuilds;
  prStats.build_stats.total_build_time_ms = totalBuildTimeMs;

  // Calculate run time
  let runStartTime: Date;
  if (prStats.linked_issues && prStats.linked_issues.length > 0) {
    const earliestIssueDate = prStats.linked_issues
      .map(issue => new Date(issue.created_at))
      .sort((a, b) => a.getTime() - b.getTime())[0];
    runStartTime = earliestIssueDate;
  } else {
    runStartTime = new Date(prStats.created_at);
  }

  let runEndTime: Date;
  if (prStats.linked_issues && prStats.linked_issues.length > 0) {
    const latestIssueClosed = prStats.linked_issues
      .filter(issue => issue.closed_at)
      .map(issue => new Date(issue.closed_at!))
      .sort((a, b) => b.getTime() - a.getTime())[0];

    const prEndDate = prStats.merged_at || prStats.closed_at;
    const prEndTime = prEndDate ? new Date(prEndDate) : null;

    if (latestIssueClosed && prEndTime) {
      runEndTime =
        latestIssueClosed > prEndTime ? latestIssueClosed : prEndTime;
    } else if (latestIssueClosed) {
      runEndTime = latestIssueClosed;
    } else if (prEndTime) {
      runEndTime = prEndTime;
    } else {
      runEndTime = new Date();
    }
  } else {
    const prEndDate = prStats.closed_at || prStats.merged_at;
    runEndTime = prEndDate ? new Date(prEndDate) : new Date();
  }

  prStats.metrics.run_start_time = runStartTime.toISOString();
  prStats.metrics.run_end_time = runEndTime.toISOString();

  // Calculate author-codeowner relationship
  const codeOwnerTeams = prStats.codeowners?.teams || [];
  const requestedTeams = prStats.reviews.requested_teams || [];
  const allCodeOwnerTeams = [
    ...new Set([...codeOwnerTeams, ...requestedTeams]),
  ];

  // Check review events to see if any reviewer has relationship info
  const reviewWithRelationship = timeline.find(
    event =>
      event.type === 'review' &&
      'author_reviewer_relationship' in event &&
      event.author_reviewer_relationship
  );

  if (
    reviewWithRelationship &&
    'author_reviewer_relationship' in reviewWithRelationship
  ) {
    prStats.metrics.author_codeowner_relationship =
      reviewWithRelationship.author_reviewer_relationship as
        | 'same-team'
        | 'cross-team';
  } else {
    // Fallback: check if author is in code owner teams
    const isAuthorInCodeOwners = allCodeOwnerTeams.length > 0;
    prStats.metrics.author_codeowner_relationship = isAuthorInCodeOwners
      ? 'same-team'
      : 'cross-team';
  }

  sendProgress('Complete', 100, 100);

  logger.info(`Timeline events collected: ${timeline.length}`);
  logger.info(`PR Complexity: ${complexity.toFixed(2)}`);
  logger.info(`Delivery Friction: ${deliveryFriction}/100`);
  logger.info(
    `Total Team Review Time: ${(totalTeamReviewTimeMs / (1000 * 60 * 60)).toFixed(2)}h`
  );
  logger.info(
    `Total Builds: ${totalBuilds} (${successfulBuilds} successful, ${failedBuilds} failed)`
  );
  logger.info(
    `Total Build Time: ${(totalBuildTimeMs / (1000 * 60)).toFixed(2)}min`
  );
  logger.info(
    `Run Time: ${runStartTime.toISOString()} to ${runEndTime.toISOString()}`
  );
  logger.info(
    `Author-Codeowner Relationship: ${prStats.metrics.author_codeowner_relationship}`
  );
  logger.info('✅ PR visualization data generated successfully');

  return prStats;
}

export async function GET(
  request: NextRequest,
  {
    params,
  }: { params: Promise<{ owner: string; repo: string; prNumber: string }> }
) {
  try {
    const { owner, repo, prNumber } = await params;
    const prNum = parseInt(prNumber);

    if (!owner || !repo || isNaN(prNum)) {
      return NextResponse.json(
        { error: 'Invalid parameters. Expected owner, repo, and prNumber.' },
        { status: 400 }
      );
    }

    // Check if GitHub token is available
    if (!process.env.GITHUB_TOKEN) {
      logger.error('GITHUB_TOKEN environment variable is not set');
      return NextResponse.json(
        {
          error:
            'GitHub token is not configured. Please set GITHUB_TOKEN environment variable.',
        },
        { status: 500 }
      );
    }

    // Check for parameters
    const { searchParams } = new URL(request.url);
    const forceRefresh = searchParams.get('force') === 'true';
    const streamProgress = searchParams.get('stream') === 'true';

    const cacheKey = getCacheKey(owner, repo, prNum);

    // Try to get cached data if not forcing refresh and not streaming
    if (!forceRefresh && !streamProgress) {
      const cachedData = getCachedData(cacheKey);
      if (cachedData) {
        logger.info(`Returning cached data for PR #${prNum}`);
        return NextResponse.json({
          data: cachedData,
          cached: true,
          timestamp: Date.now(),
        });
      }
    } else {
      logger.info(`Force refresh requested for PR #${prNum}, bypassing cache`);
      // Remove from cache if force refresh
      clearCacheEntry(cacheKey);
    }

    logger.info(`🚀 Fetching fresh data for PR #${prNum}`);

    // If streaming is requested, use SSE
    if (streamProgress) {
      const encoder = new TextEncoder();

      const stream = new ReadableStream({
        async start(controller) {
          try {
            const sendProgress = (
              step: string,
              current: number,
              total: number
            ) => {
              const data = JSON.stringify({
                step,
                current,
                total,
                timestamp: Date.now(),
              });
              controller.enqueue(encoder.encode(`data: ${data}\n\n`));
            };

            // Collect data with progress reporting
            const prStats = await collectPRData(
              owner,
              repo,
              prNum,
              sendProgress
            );

            // Cache the result
            setCachedData(cacheKey, prStats);

            // Send final data
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ data: prStats, complete: true })}\n\n`
              )
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

    // Non-streaming mode: collect data and return JSON
    const prStats = await collectPRData(owner, repo, prNum);

    // Cache the result
    setCachedData(cacheKey, prStats);

    return NextResponse.json({
      data: prStats,
      cached: false,
      timestamp: Date.now(),
    });
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

// DELETE endpoint to clear cache for specific PR or all cache
export async function DELETE(
  request: NextRequest,
  {
    params,
  }: { params: Promise<{ owner: string; repo: string; prNumber: string }> }
) {
  try {
    const { owner, repo, prNumber } = await params;
    const prNum = parseInt(prNumber);

    const { searchParams } = new URL(request.url);
    const clearAll = searchParams.get('all') === 'true';

    if (clearAll) {
      const clearedCount = clearAllCache();
      return NextResponse.json({
        message: `Cache cleared (${clearedCount} files removed)`,
        cleared: clearedCount,
      });
    } else {
      const cacheKey = getCacheKey(owner, repo, prNum);
      const existed = clearCacheEntry(cacheKey);
      return NextResponse.json({
        message: `Cache ${existed ? 'cleared' : 'was already empty'} for PR #${prNum}`,
        cleared: existed ? 1 : 0,
      });
    }
  } catch (error) {
    logger.error('Error clearing cache', {
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

// OPTIONS endpoint to get cache statistics
export async function OPTIONS(request: NextRequest) {
  try {
    const stats = getCacheStats();
    const { searchParams } = new URL(request.url);
    const detailed = searchParams.get('detailed') === 'true';

    const response = {
      cacheStats: {
        totalFiles: stats.totalFiles,
        totalSizeBytes: stats.totalSize,
        totalSizeMB: Math.round((stats.totalSize / (1024 * 1024)) * 100) / 100,
        oldestFile: stats.oldestFile,
        newestFile: stats.newestFile,
        cacheDirectory: CACHE_DIR,
        cacheTTLMinutes: CACHE_TTL / 1000 / 60,
      },
    };

    if (detailed && stats.totalFiles > 0) {
      try {
        const files = fs.readdirSync(CACHE_DIR);
        const cacheFiles = files.filter(file => file.endsWith('.json'));
        const fileDetails = cacheFiles.map(file => {
          try {
            const filePath = path.join(CACHE_DIR, file);
            const fileStats = fs.statSync(filePath);
            const content = fs.readFileSync(filePath, 'utf-8');
            const entry: CacheEntry = JSON.parse(content);

            return {
              filename: file,
              sizeBytes: fileStats.size,
              created: fileStats.birthtime,
              modified: fileStats.mtime,
              expiresAt: new Date(entry.expiresAt),
              expired: Date.now() > entry.expiresAt,
              prTitle:
                entry.data.title?.substring(0, 50) +
                (entry.data.title?.length > 50 ? '...' : ''),
            };
          } catch {
            return {
              filename: file,
              error: 'Could not read file details',
            };
          }
        });

        (
          response as typeof response & { fileDetails: typeof fileDetails }
        ).fileDetails = fileDetails;
      } catch (error) {
        logger.warn('Error getting detailed cache info:', error);
      }
    }

    return NextResponse.json(response);
  } catch (error) {
    logger.error('Error getting cache stats', {
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
