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

    const collector = new GitHubCollector(
      process.env.GITHUB_TOKEN!,
      process.env.BUILDKITE_TOKEN,
      process.env.BUILDKITE_ORG_SLUG
    );

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

            // Use the consolidated method that does everything
            const prStats = await collector.buildCompletePRStats(
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

    // Use the consolidated method that does everything
    const prStats = await collector.buildCompletePRStats(owner, repo, prNum);

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
