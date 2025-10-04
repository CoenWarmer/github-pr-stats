import { NextRequest, NextResponse } from 'next/server';
import { GitHubCollector } from '@/lib/github-collector';
import { logger } from '@/lib/logger';
import { PullRequestStats } from '@/lib/types';
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

    // Check for force parameter to bypass cache
    const { searchParams } = new URL(request.url);
    const forceRefresh = searchParams.get('force') === 'true';

    const cacheKey = getCacheKey(owner, repo, prNum);

    // Try to get cached data if not forcing refresh
    if (!forceRefresh) {
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

    const collector = new GitHubCollector(process.env.GITHUB_TOKEN);

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
      collector.getLinkedIssues(owner, repo, pr.body, prNum),
    ]);

    // Extract requested teams from PR data
    const requestedTeams = pr.requested_teams?.map(team => team.slug) || [];

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
      requested_teams: pr.requested_teams?.map(team => team.slug) || [],
    };

    // First, build a basic timeline to get team request events
    const basicTimeline = await collector.buildPRTimeline(
      owner,
      repo,
      prNum,
      prDataForTimeline,
      [], // Empty review timings for now
      linkedIssues
    );

    // Get review timings with access to timeline events
    const reviewTimings = await collector.getReviewTimings(
      owner,
      repo,
      prNum,
      pr.created_at,
      userTeams,
      requestedTeams,
      basicTimeline
    );

    // Build final timeline with review timings
    const timeline = await collector.buildPRTimeline(
      owner,
      repo,
      prNum,
      prDataForTimeline,
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
    // Remove hidden_from_timeline from timeline events to reduce cache size
    const cleanedTimeline = timeline.map(event => {
      const { hidden_from_timeline: _hidden, ...rest } = event;
      void _hidden;
      return rest;
    });

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
      headSha: pr.head.sha,
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
      timeline: cleanedTimeline,
      codeowners: { teams: codeowners.teams, individuals: [] },
      linked_issues: linkedIssues,
      requested_teams: requestedTeams,
    };

    logger.info(`Timeline events collected: ${timeline.length}`);
    logger.info('✅ PR visualization data generated successfully');

    // Cache the result for future requests
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
