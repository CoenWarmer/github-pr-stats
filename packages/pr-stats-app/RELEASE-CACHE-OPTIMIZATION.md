# Release Cache Optimization for Bulk PR Ingestion

## Problem

When ingesting multiple PRs for a team (bulk processing), the app was making redundant API calls to GitHub to fetch release information for every PR. This caused:

1. **Excessive API calls**: For N PRs, we were making N × M API calls (where M = number of releases to check)
2. **Rate limiting**: Could easily hit GitHub API rate limits during large ingests
3. **Slow processing**: Each PR had to wait for multiple sequential release comparison API calls
4. **Duplicate work**: Many PRs share the same releases, so we were fetching and comparing the same data repeatedly

### Example: Before Optimization

Ingesting 100 PRs from a team:

- 100 calls to list releases (same data each time!)
- Up to 300 calls to compare commits with releases (3 releases per PR)
- **Total: ~400 redundant API calls**

## Solution

Build a **release commit cache** once at the start of the batch job and reuse it for all PRs.

### How It Works

1. **At job start**: Build a cache of all releases since the user's start date, including all commits in each release
2. **For each PR**: Look up the PR's merge commit in the pre-built cache (O(1) lookup) instead of making API calls
3. **Result**: Reduce hundreds of API calls to just a few dozen upfront

### Example: After Optimization

Ingesting 100 PRs from the same team:

- 1 call to list releases (shared)
- ~20-30 calls to get commits for each release (shared)
- **Total: ~30 API calls (93% reduction!)**

## Architecture

### 1. ReleaseService (`release-service.ts`)

Added new methods:

```typescript
interface ReleaseCommitCache {
  releases: Array<{
    tag_name: string;
    published_at: string;
    html_url: string;
    commits: Set<string>; // Set of commit SHAs
  }>;
  lastFetchTime: number;
}

// Build cache once
async buildReleaseCommitCache(
  owner: string,
  repo: string,
  sinceDate: string
): Promise<ReleaseCommitCache>

// Lookup in cache (no API calls)
findReleasesForCommitInCache(
  commitSha: string,
  prMergedAt: string,
  cache: ReleaseCommitCache
): Array<Release>
```

**Cache building process**:

1. Fetch all releases published after `sinceDate`
2. For each release, get all commits via `compareCommitsWithBasehead`
3. Store commits in a `Set` for O(1) lookup
4. Sort releases chronologically

### 2. GitHubCollector (`github-collector.ts`)

Updated method signatures:

```typescript
async buildCompletePRStats(
  owner: string,
  repo: string,
  prNumber: number,
  onProgress?: ProgressCallback,
  releaseCache?: ReleaseCommitCache // NEW: optional cache
): Promise<PullRequestStats>

async buildPRTimeline(
  /* ... existing params ... */
  releaseCache?: ReleaseCommitCache // NEW: optional cache
): Promise<TimelineEvent[]>
```

**Logic in buildPRTimeline**:

```typescript
// Conditional: use cache if available, otherwise fetch
let releases: Array<any>;
if (releaseCache && prData.merged_at) {
  // Fast path: lookup in cache
  releases = this.releaseService.findReleasesForCommitInCache(
    commitSha,
    prData.merged_at,
    releaseCache
  );
} else {
  // Slow path: fetch from API (for single PR requests)
  releases = await this.releaseService.getReleasesForPR(
    owner,
    repo,
    commitSha,
    prData.merged_at
  );
}
```

### 3. PR Processor (`pr-processor.ts`)

Updated to pass cache through:

```typescript
export async function processPR(
  owner: string,
  repo: string,
  prNumber: number,
  forceRefresh = false,
  releaseCache?: ReleaseCommitCache // NEW
): Promise<{ data: PullRequestStats; cached: boolean }>;
```

### 4. Team Ingestion Job (`team/start/route.ts`)

**Key changes**:

```typescript
async function processJobInBackground(
  jobId: string,
  prs: Array<PR>,
  startDate: string // NEW: needed to build cache
) {
  // 🔥 BUILD CACHE ONCE
  let releaseCache: ReleaseCommitCache | undefined;
  if (prs.length > 0) {
    const firstPR = prs[0];
    const octokit = new Octokit({ auth: githubToken });
    const releaseService = new ReleaseService(octokit);
    releaseCache = await releaseService.buildReleaseCommitCache(
      firstPR.owner,
      firstPR.repo,
      startDate
    );
    logger.info(
      `Release cache built with ${releaseCache.releases.length} releases`
    );
  }

  // REUSE CACHE FOR ALL PRs
  for (const pr of prs) {
    await processPR(pr.owner, pr.repo, pr.number, false, releaseCache);
  }
}
```

## Performance Impact

### Before (N PRs):

- **API calls**: N × (1 list + 3 compare) = 4N calls
- **Time**: ~2-3 seconds per PR just for releases
- **For 100 PRs**: 400 API calls, ~4-5 minutes

### After (N PRs):

- **API calls**: 1 list + M compare (M = number of releases, typically 10-30)
- **Time**: ~30 seconds upfront + instant lookups
- **For 100 PRs**: ~30 API calls, ~30 seconds total

**Result**: ~93% reduction in API calls, 10x faster processing!

## Backwards Compatibility

The optimization is **fully backwards compatible**:

- Single PR requests (`/api/pr/owner/repo/number`) still use the original API-based approach
- Only bulk ingestion jobs benefit from the cache
- Cache is optional everywhere—if not provided, falls back to original behavior

## Usage

### Single PR (No cache, normal behavior)

```typescript
const prStats = await collector.buildCompletePRStats(owner, repo, prNumber);
```

### Bulk Ingestion (With cache)

```typescript
// Build cache once
const releaseCache = await releaseService.buildReleaseCommitCache(
  owner,
  repo,
  startDate
);

// Reuse for all PRs
for (const pr of prs) {
  const prStats = await collector.buildCompletePRStats(
    pr.owner,
    pr.repo,
    pr.number,
    undefined,
    releaseCache // Pass cache
  );
}
```

## Future Enhancements

Potential improvements:

1. **Persistent cache**: Store release cache in Redis/Elasticsearch for multi-job reuse
2. **Incremental updates**: Fetch only new releases since last cache build
3. **Multi-repo support**: Build caches for multiple repos in parallel
4. **Cache invalidation**: Refresh cache periodically or when new releases are detected
5. **Smart caching**: Build cache only if processing >10 PRs (skip for small batches)

## Testing

To verify the optimization is working:

1. Check logs during team ingestion—you should see:

   ```
   Building release cache for elastic/kibana since 2024-01-01
   Release cache built with 25 releases
   Found 3 release(s) containing commit abcd1234 (from cache)
   ```

2. Monitor API rate limit—should stay much lower during bulk ingests

3. Compare ingestion times before/after for the same team/date range

## Files Modified

- `src/lib/services/release-service.ts` - Added cache building and lookup methods
- `src/lib/services/index.ts` - Export ReleaseCommitCache type
- `src/lib/github-collector.ts` - Pass cache through to timeline builder
- `src/lib/services/pr-processor.ts` - Accept cache parameter
- `src/app/api/prs/team/start/route.ts` - Build cache once, reuse for all PRs

## Credits

Optimization suggested by: @coenwarmer
Implemented: 2025-10-23

