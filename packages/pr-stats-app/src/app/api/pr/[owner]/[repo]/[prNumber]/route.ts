import { NextRequest, NextResponse } from 'next/server';
import { GitHubCollector } from '@/lib/github-collector';
import { logger } from '@/lib/logger';
import { elasticsearchService } from '@/lib/services';
import {
  processPR,
  getCacheKey,
  clearCacheEntry,
  clearAllCache,
  getCacheStats,
  CACHE_DIR,
  CACHE_TTL,
  type CacheEntry,
} from '@/lib/services/pr-processor';
import * as fs from 'fs';
import * as path from 'path';

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

    // If streaming is requested, use SSE with progress updates
    // Note: Streaming bypasses processPR to provide real-time progress callbacks
    if (streamProgress) {
      const collector = new GitHubCollector(
        process.env.GITHUB_TOKEN!,
        process.env.BUILDKITE_TOKEN,
        process.env.BUILDKITE_ORG_SLUG
      );
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

            // Index to Elasticsearch (processPR would do this, but we're bypassing it)
            if (elasticsearchService.isEnabled()) {
              elasticsearchService.indexPRStats(prStats).catch(error => {
                logger.warn('Failed to index PR stats to Elasticsearch', {
                  error: error instanceof Error ? error.message : error,
                });
              });
            }

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
    // Use shared processPR service which handles caching and ES indexing
    const result = await processPR(owner, repo, prNum, forceRefresh);

    return NextResponse.json({
      data: result.data,
      cached: result.cached,
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
              prTitle: entry.data.title
                ? entry.data.title.substring(0, 50) +
                  (entry.data.title.length > 50 ? '...' : '')
                : 'Unknown',
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
