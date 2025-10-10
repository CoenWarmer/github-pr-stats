# Dual-Cache System: Elasticsearch + Filesystem

## Overview

The application uses a **dual-cache system** with Elasticsearch as the primary cache and the filesystem as a secondary cache for debugging and local development.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Request for PR Data                     │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
              ┌─────────────────────────┐
              │  Check Elasticsearch    │
              │   (Primary Cache)       │
              └─────────┬───────────────┘
                        │
                ┌───────┴────────┐
                │                │
           FOUND│                │NOT FOUND
                │                │
                ▼                ▼
         ┌──────────┐    ┌─────────────────┐
         │ Return   │    │ Check Filesystem │
         │ ES Data  │    │ (Secondary)      │
         └────┬─────┘    └────┬─────────────┘
              │               │
              │      ┌────────┴─────────┐
              │      │                  │
              │ FOUND│                  │NOT FOUND
              │      │                  │
              │      ▼                  ▼
              │  ┌────────────┐   ┌──────────────┐
              │  │ Backfill   │   │ Fetch from   │
              │  │ to ES      │   │ GitHub API   │
              │  └────┬───────┘   └───┬──────────┘
              │       │               │
              │       ▼               ▼
              │  ┌────────────┐   ┌──────────────┐
              │  │ Return FS  │   │ Write to FS  │
              │  │ Data       │   │ & ES         │
              │  └────────────┘   └───┬──────────┘
              │                       │
              │                       ▼
              │                  ┌─────────┐
              │                  │ Return  │
              │                  │ Fresh   │
              │                  │ Data    │
              │                  └─────────┘
              │                       │
              └───────────────────────┘
                                      │
                                      ▼
                           ┌──────────────────┐
                           │ Also write to FS │
                           │ for debugging    │
                           └──────────────────┘
```

## Cache Hierarchy

### 1. **Elasticsearch (Primary)**

**Purpose**: Persistent cache across deployments and serverless instances

**Benefits**:

- ✅ **Persistent**: Survives deployments
- ✅ **Shared**: All function instances access the same cache
- ✅ **Scalable**: Handles large datasets
- ✅ **Searchable**: Can query and analyze cached data
- ✅ **TTL**: Built-in expiration (1 hour)

**Storage Location**:

- Index: `github-pr-stats` (configurable via `ES_INDEX_NAME`)
- Document ID: `{owner}-{repo}-{prNumber}` (e.g., `elastic-kibana-234886`)

### 2. **Filesystem (Secondary)**

**Purpose**: Debugging, local development, and fallback

**Benefits**:

- ✅ **Easy to inspect**: JSON files in `data/cache/`
- ✅ **Fast local access**: No network calls
- ✅ **Debugging**: Can view and modify cache manually
- ✅ **Fallback**: Works when ES is unavailable

**Storage Location**:

- Local: `data/cache/{owner}-{repo}-{prNumber}.json`
- Netlify: `/tmp/cache/{owner}-{repo}-{prNumber}.json`

## Cache Flow

### Reading (Cache Hit)

1. **Check Elasticsearch**
   - If found and not expired → Return ES data
   - Also write to filesystem for debugging

2. **Check Filesystem** (if ES miss)
   - If found and not expired → Return FS data
   - Backfill to Elasticsearch (async)

3. **Fetch from GitHub** (if both miss)
   - Fetch fresh data from GitHub API
   - Write to both ES and FS
   - Return fresh data

### Writing (Cache Miss)

When fetching fresh data:

```typescript
// 1. Fetch from GitHub
const prStats = await collector.buildCompletePRStats(...);

// 2. Write to filesystem (synchronous - for debugging)
setCachedData(cacheKey, prStats);

// 3. Write to Elasticsearch (primary cache)
await elasticsearchService.indexPRStats(prStats);
```

### Force Refresh

When `?force=true`:

1. **Clear both caches**
   - Delete filesystem file
   - Delete Elasticsearch document

2. **Fetch fresh data**

3. **Write to both caches**

## Configuration

### Environment Variables

```bash
# Elasticsearch Configuration
ES_NODE=https://your-elasticsearch:9200
ES_API_KEY=your_api_key
ES_INDEX_NAME=github-pr-stats  # Optional, default: github-pr-stats

# Cache TTL (defined in code)
CACHE_TTL=3600000  # 1 hour in milliseconds
```

### Enabling/Disabling

**With Elasticsearch**:

```bash
# Set ES environment variables
ES_NODE=https://...
ES_API_KEY=...

# ES becomes primary cache
# Filesystem used for debugging
```

**Without Elasticsearch**:

```bash
# Don't set ES environment variables

# Filesystem becomes the only cache
# Works fine for local development
```

## Cache Behavior by Environment

| Environment           | ES Enabled? | Primary Cache | Secondary Cache | Cache Persistence  |
| --------------------- | ----------- | ------------- | --------------- | ------------------ |
| **Local Dev**         | Optional    | FS or ES      | FS              | ✅ Persistent      |
| **Netlify (No ES)**   | ❌ No       | FS (`/tmp`)   | None            | ❌ Ephemeral       |
| **Netlify (With ES)** | ✅ Yes      | ES            | FS (`/tmp`)     | ✅ Persistent (ES) |
| **Docker/VPS**        | Optional    | ES or FS      | FS              | ✅ Persistent      |

## Implementation Details

### Cache Key Generation

```typescript
function getCacheKey(owner: string, repo: string, prNumber: number): string {
  return `${owner}-${repo}-${prNumber}`;
}
```

### TTL (Time To Live)

Both caches use **1 hour TTL**:

```typescript
export const CACHE_TTL = 60 * 60 * 1000; // 1 hour
```

After 1 hour:

- Cached data is considered stale
- Next request fetches fresh data
- Cache is updated with new data

### Backfilling

If data is found in filesystem but not in Elasticsearch:

```typescript
// Automatically backfill to ES (async, don't wait)
if (elasticsearchService.isEnabled()) {
  elasticsearchService.indexPRStats(cachedData).catch(...);
}
```

This ensures the primary cache stays populated.

## Benefits of Dual-Cache

### ✅ **Production Benefits**

1. **Persistent Cache on Netlify**: ES cache survives deployments and cold starts
2. **Shared Cache**: All serverless instances share the same cache
3. **Better Performance**: Faster cache hits from ES
4. **Cost Savings**: Fewer GitHub API calls

### ✅ **Development Benefits**

1. **Easy Debugging**: Inspect JSON files locally
2. **Offline Development**: Can work without ES
3. **Cache Inspection**: View cached data directly
4. **Manual Testing**: Modify cache files for testing

### ✅ **Operational Benefits**

1. **Fallback**: Works even if ES is down
2. **Gradual Migration**: Can enable ES without code changes
3. **Zero Downtime**: Cache keeps working during ES maintenance
4. **Observability**: See what's cached in both places

## Monitoring

### Cache Hit Rates

Check logs for cache performance:

```
# Elasticsearch hits
grep "Returning cached data from Elasticsearch" logs

# Filesystem hits (after ES miss)
grep "Returning cached data from filesystem" logs

# Cache misses
grep "Fetching fresh data" logs
```

### Cache Size

**Filesystem**:

```bash
# Local
du -sh data/cache/

# Check stats via API
GET /api/pr/cache-stats
```

**Elasticsearch**:

```bash
# Via Elasticsearch
GET /github-pr-stats/_stats

# Via API
GET /api/pr/cache-stats?source=elasticsearch
```

## Troubleshooting

### Problem: ES cache not being used

**Check**:

1. Is `ES_NODE` and `ES_API_KEY` set?
2. Can the app connect to ES?
3. Check logs for "Elasticsearch indexing skipped"

**Solution**:

```bash
# Test ES connection
curl -H "Authorization: ApiKey $ES_API_KEY" $ES_NODE

# Check app logs
grep "Elasticsearch" logs
```

### Problem: Filesystem cache growing too large

**Check**:

```bash
# Local
du -sh data/cache/
ls -lh data/cache/ | wc -l

# Netlify
# Cache clears automatically on each deployment
```

**Solution**:

```bash
# Clear old cache files
rm data/cache/*.json

# Or use the API
DELETE /api/pr/cache
```

### Problem: Stale cache data

**Check**:

- Is TTL too long?
- Is `indexed_at` field present?

**Solution**:

```bash
# Force refresh specific PR
GET /api/pr/elastic/kibana/234886?force=true

# Or clear all cache
DELETE /api/pr/cache
```

## Migration from Single Cache

### Before (Filesystem Only)

```typescript
// Old code - filesystem only
const cachedData = getCachedData(cacheKey);
if (cachedData) return cachedData;

const prStats = await fetchFromGitHub();
setCachedData(cacheKey, prStats);
```

### After (Dual Cache)

```typescript
// New code - ES primary, filesystem secondary
const esCachedData = await es.getCachedPRStats(...);
if (esCachedData) return esCachedData;

const fsCachedData = getCachedData(cacheKey);
if (fsCachedData) return fsCachedData;

const prStats = await fetchFromGitHub();
setCachedData(cacheKey, prStats);
await es.indexPRStats(prStats);
```

### Migration Steps

1. ✅ **No code changes needed** - already implemented!
2. ✅ **Add ES environment variables** to enable ES cache
3. ✅ **Deploy** - cache starts using ES automatically
4. ✅ **Monitor** - check logs for ES cache hits
5. ✅ **Optional**: Pre-populate ES cache from filesystem

## Future Enhancements

### Possible Improvements

1. **Configurable TTL**: Per-environment or per-repo TTL
2. **Cache Warming**: Pre-populate cache for frequently accessed PRs
3. **Smart Eviction**: LRU or LFU cache policies
4. **Cache Statistics**: Detailed metrics and dashboards
5. **Redis Option**: Add Redis as another cache tier
6. **Partial Updates**: Update only changed fields
7. **Cache Tags**: Group and invalidate related PRs

## Summary

| Feature         | Elasticsearch     | Filesystem                |
| --------------- | ----------------- | ------------------------- |
| **Role**        | Primary cache     | Secondary/Debug           |
| **Persistent**  | ✅ Yes            | ⚠️ Depends on environment |
| **Shared**      | ✅ Yes            | ❌ No (per-instance)      |
| **TTL**         | ✅ 1 hour         | ✅ 1 hour                 |
| **Searchable**  | ✅ Yes            | ❌ No                     |
| **Debugging**   | ⚠️ Requires tools | ✅ Easy (JSON files)      |
| **Fallback**    | -                 | ✅ Always available       |
| **Performance** | ✅ Fast           | ✅✅ Faster (local)       |

The dual-cache system gives you the **best of both worlds**: persistent, shared caching with ES for production, and easy-to-debug filesystem caching for development! 🎯
