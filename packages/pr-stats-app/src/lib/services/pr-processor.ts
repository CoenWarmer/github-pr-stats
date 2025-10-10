import { GitHubCollector } from '../github-collector';
import { PullRequestStats } from '../types';
import { elasticsearchService } from './elasticsearch-service';
import { logger } from '../logger';
import * as fs from 'fs';
import * as path from 'path';

// Cache configuration
export interface CacheEntry {
  data: PullRequestStats;
  timestamp: number;
  expiresAt: number;
}

export const CACHE_TTL = 60 * 60 * 1000; // 60 minutes in milliseconds

// Detect if we're running on a serverless platform (Netlify, Vercel, AWS Lambda, etc.)
// These platforms only allow writes to /tmp
const isServerless =
  process.env.NETLIFY === 'true' ||
  process.env.VERCEL === '1' ||
  process.env.AWS_LAMBDA_FUNCTION_NAME ||
  process.env.CONTEXT || // Netlify sets this
  process.env.LAMBDA_TASK_ROOT; // AWS Lambda

export const CACHE_DIR = isServerless
  ? path.join('/tmp', 'cache')
  : path.join(process.cwd(), 'data', 'cache');

function ensureCacheDir(): void {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    logger.debug(`Created cache directory: ${CACHE_DIR}`);
  }
}

export function getCacheKey(
  owner: string,
  repo: string,
  prNumber: number
): string {
  return `${owner}-${repo}-${prNumber}`;
}

function getCacheFilePath(cacheKey: string): string {
  return path.join(CACHE_DIR, `${cacheKey}.json`);
}

/**
 * Check if cache exists for a PR (ignores TTL/expiration)
 */
export function hasCachedData(
  owner: string,
  repo: string,
  prNumber: number
): boolean {
  try {
    const cacheKey = getCacheKey(owner, repo, prNumber);
    const filePath = getCacheFilePath(cacheKey);
    return fs.existsSync(filePath);
  } catch (error) {
    return false;
  }
}

function getCachedData(cacheKey: string): PullRequestStats | null {
  try {
    const filePath = getCacheFilePath(cacheKey);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const entry: CacheEntry = JSON.parse(fileContent);

    if (Date.now() > entry.expiresAt) {
      fs.unlinkSync(filePath);
      logger.debug(`Cache expired and removed for ${cacheKey}`);
      return null;
    }

    logger.info(`Cache hit for ${cacheKey}`);
    return entry.data;
  } catch (error) {
    logger.warn(`Error reading cache for ${cacheKey}:`, error);
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

export function clearCacheEntry(cacheKey: string): boolean {
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

export function clearAllCache(): number {
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

export function getCacheStats(): {
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

/**
 * Process a single PR and return its stats
 * Returns both the data and whether it was from cache
 *
 * Cache hierarchy:
 * 1. Elasticsearch (primary cache - persistent across deployments)
 * 2. Filesystem (secondary cache - for debugging and local dev)
 */
export async function processPR(
  owner: string,
  repo: string,
  prNumber: number,
  forceRefresh = false
): Promise<{ data: PullRequestStats; cached: boolean }> {
  const cacheKey = getCacheKey(owner, repo, prNumber);

  // Try to get cached data if not forcing refresh
  if (!forceRefresh) {
    // 1. Try Elasticsearch first (primary cache)
    if (elasticsearchService.isEnabled()) {
      try {
        const esCachedData = await elasticsearchService.getCachedPRStats(
          owner,
          repo,
          prNumber
        );
        if (esCachedData) {
          logger.info(
            `Returning cached data from Elasticsearch for PR #${prNumber}`
          );

          // Also write to filesystem for debugging (async, don't wait)
          setCachedData(cacheKey, esCachedData);

          return { data: esCachedData, cached: true };
        }
      } catch (error) {
        logger.warn(
          'Failed to get cached data from Elasticsearch, falling back to filesystem',
          {
            error: error instanceof Error ? error.message : error,
          }
        );
      }
    }

    // 2. Fall back to filesystem cache
    const cachedData = getCachedData(cacheKey);
    if (cachedData) {
      logger.info(`Returning cached data from filesystem for PR #${prNumber}`);

      // If ES is enabled, backfill to ES (async, don't wait)
      if (elasticsearchService.isEnabled()) {
        elasticsearchService.indexPRStats(cachedData).catch(error => {
          logger.warn('Failed to backfill cache to Elasticsearch', {
            error: error instanceof Error ? error.message : error,
          });
        });
      }

      return { data: cachedData, cached: true };
    }
  } else {
    logger.info(`Force refresh requested for PR #${prNumber}, bypassing cache`);

    // Clear both caches
    clearCacheEntry(cacheKey);

    if (elasticsearchService.isEnabled()) {
      elasticsearchService.deletePRStats(owner, repo, prNumber).catch(error => {
        logger.warn('Failed to clear ES cache', {
          error: error instanceof Error ? error.message : error,
        });
      });
    }
  }

  logger.info(`🚀 Fetching fresh data for PR #${prNumber}`);

  const collector = new GitHubCollector(
    process.env.GITHUB_TOKEN!,
    process.env.BUILDKITE_TOKEN,
    process.env.BUILDKITE_ORG_SLUG
  );

  // Build complete PR stats
  const prStats = await collector.buildCompletePRStats(owner, repo, prNumber);

  // Cache to filesystem for debugging (always, regardless of ES)
  setCachedData(cacheKey, prStats);

  // Cache to Elasticsearch (primary cache)
  if (elasticsearchService.isEnabled()) {
    try {
      await elasticsearchService.indexPRStats(prStats);
      logger.info(`Cached PR stats to Elasticsearch for PR #${prNumber}`);
    } catch (error) {
      logger.warn('Failed to cache to Elasticsearch', {
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  return { data: prStats, cached: false };
}
