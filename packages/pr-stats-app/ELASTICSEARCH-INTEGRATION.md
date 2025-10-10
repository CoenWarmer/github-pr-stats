# Elasticsearch Integration

This document describes the Elasticsearch integration that automatically indexes GitHub PR statistics.

## Overview

The Elasticsearch integration serves two primary purposes:

### 1. **Primary Cache** (NEW! 🎯)

Elasticsearch is used as the primary persistent cache for PR data, with filesystem as a secondary cache for debugging. This provides:

- **Persistent cache**: Survives deployments and serverless cold starts
- **Shared cache**: All instances share the same cache
- **Faster responses**: Cached PRs load instantly
- **Cost savings**: Fewer GitHub API calls

See [DUAL-CACHE.md](./DUAL-CACHE.md) for complete details on the caching system.

### 2. **Analytics & Search**

The integration also indexes PR statistics for analysis:

- **Historical tracking**: Store PR metrics over time
- **Search & analytics**: Query PR data across repositories and teams
- **Dashboard creation**: Build custom dashboards using Kibana or other tools
- **Trend analysis**: Analyze delivery metrics, build times, and team performance

## Configuration

### Environment Variables

Configure Elasticsearch by setting the following environment variables:

```bash
# Elasticsearch cluster endpoint
ES_NODE=https://your-elasticsearch-cluster:9200

# Elasticsearch API Key for authentication
ES_API_KEY=your_elasticsearch_api_key

# Index name (optional, defaults to 'github-pr-stats')
ES_INDEX_NAME=github-pr-stats
```

### Setting Up Elasticsearch

1. **Create an Elasticsearch cluster** (if you don't have one):
   - Use Elastic Cloud (https://cloud.elastic.co) - supports both traditional and serverless
   - Or run Elasticsearch locally via Docker

   **Note**: Both traditional and serverless Elasticsearch deployments are supported. The service automatically adapts to your deployment type.

2. **Generate an API Key**:

   ```bash
   # Using Elasticsearch API
   curl -X POST "https://your-cluster:9200/_security/api_key" \
     -H "Content-Type: application/json" \
     -u elastic:your_password \
     -d '{
       "name": "github-pr-stats-indexer",
       "role_descriptors": {
         "pr-stats-writer": {
           "cluster": ["monitor"],
           "indices": [
             {
               "names": ["github-pr-stats*"],
               "privileges": ["create_index", "write", "read"]
             }
           ]
         }
       }
     }'
   ```

3. **Add environment variables** to your `.env.local`:
   ```bash
   ES_NODE=https://your-cluster.es.us-east-1.aws.found.io:9243
   ES_API_KEY=your_generated_api_key
   ES_INDEX_NAME=github-pr-stats
   ```

## Data Structure

The Elasticsearch index automatically maps the following fields:

### Core Fields

- `id` (keyword): PR identifier
- `title` (text): PR title
- `url` (keyword): PR URL
- `created_at` (date): PR creation timestamp
- `updated_at` (date): PR last update timestamp
- `merged_at` (date): PR merge timestamp
- `closed_at` (date): PR close timestamp
- `author` (keyword): PR author username
- `author_teams` (keyword array): Teams the author belongs to
- `state` (keyword): PR state (open, closed, merged)
- `draft` (boolean): Whether PR is a draft

### Size Metrics

- `commits` (integer): Number of commits
- `additions` (integer): Lines added
- `deletions` (integer): Lines deleted
- `changed_files` (integer): Number of files changed

### Build Statistics

- `build_stats.total_builds` (integer)
- `build_stats.completed_builds` (integer)
- `build_stats.failed_builds` (integer)
- `build_stats.successful_builds` (integer)
- `build_stats.cancelled_builds` (integer)
- `build_stats.total_build_time_ms` (long)
- `build_stats.wall_to_wall_build_time_ms` (long)
- `build_stats.cumulative_build_time_ms` (long)

### Calculated Metrics

- `metrics.turnaround_time_hours` (float)
- `metrics.complexity` (float): PR complexity score
- `metrics.delivery_friction` (float): Delivery friction score
- `metrics.total_team_review_time_ms` (long): Time to first review
- `metrics.run_start_time` (date)
- `metrics.run_end_time` (date)

### Review Data

- `reviews.comments` (integer)
- `reviews.back_and_forth_count` (integer)
- `reviews.requested_teams` (keyword array)
- `reviews.review_comments` (integer)

### Metadata

- `indexed_at` (date): When the document was indexed
- `repo_owner` (keyword): Repository owner
- `repo_name` (keyword): Repository name

### Complex Objects

- `timeline`: Complete PR timeline (stored as object, not searchable)
- `otel_timeline`: OpenTelemetry-compliant timeline (stored as object)
- `linked_issues`: Linked issue details (stored as object)

## Usage

### Automatic Indexing

Once configured, PR stats are automatically indexed to Elasticsearch when:

- A PR is fetched via the API (`/api/pr/{owner}/{repo}/{prNumber}`)
- The data is collected (both streaming and non-streaming modes)

The indexing happens asynchronously and won't slow down the API response.

### Querying Data

#### Via Kibana

1. **Create an Index Pattern**:
   - Go to Stack Management → Index Patterns
   - Create pattern: `github-pr-stats*`
   - Set time field: `created_at`

2. **Build Visualizations**:
   - Average PR complexity by team
   - Build success rate over time
   - Review turnaround time trends
   - Delivery friction by repository

#### Via Elasticsearch API

```bash
# Search PRs by author
curl -X GET "https://your-cluster:9200/github-pr-stats/_search" \
  -H "Authorization: ApiKey your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "query": {
      "term": { "author": "username" }
    }
  }'

# Aggregate metrics by repository
curl -X GET "https://your-cluster:9200/github-pr-stats/_search" \
  -H "Authorization: ApiKey your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "size": 0,
    "aggs": {
      "by_repo": {
        "terms": { "field": "repo_name" },
        "aggs": {
          "avg_complexity": { "avg": { "field": "metrics.complexity" } },
          "avg_turnaround": { "avg": { "field": "metrics.turnaround_time_hours" } }
        }
      }
    }
  }'
```

#### Programmatic Access

The service is exported and can be used directly:

```typescript
import { elasticsearchService } from '@/lib/services';

// Check if enabled
if (elasticsearchService.isEnabled()) {
  // Search PRs
  const results = await elasticsearchService.searchPRStats({
    author: 'username',
    repo_owner: 'elastic',
    repo_name: 'kibana',
    state: 'merged',
    from: new Date('2024-01-01'),
    to: new Date('2024-12-31'),
    size: 50,
  });

  // Bulk index multiple PRs
  await elasticsearchService.bulkIndexPRStats(prStatsList);
}
```

## Monitoring

### Check Service Status

The service logs its initialization state:

```
INFO: Elasticsearch service initialized { node: 'https://...', index: 'github-pr-stats' }
```

Or if disabled:

```
DEBUG: Elasticsearch service is disabled (missing configuration)
```

### Index Statistics

Monitor your index health via Kibana or the Elasticsearch API:

```bash
curl -X GET "https://your-cluster:9200/github-pr-stats/_stats" \
  -H "Authorization: ApiKey your_api_key"
```

## Performance Considerations

1. **Asynchronous Indexing**: Indexing happens in the background and won't block API responses
2. **Auto Index Creation**: The index is created automatically with proper mappings on first use
3. **Upsert Strategy**: Documents are upserted by ID, so re-fetching a PR updates its data
4. **No Refresh Wait**: Documents aren't immediately searchable (eventual consistency) for better performance
5. **Error Handling**: Indexing failures are logged but don't fail the API request

## Troubleshooting

### Service Not Enabled

**Symptom**: Logs show "Elasticsearch service is disabled"

**Solution**: Verify `ES_NODE` and `ES_API_KEY` are set in your environment variables.

### Connection Failed

**Symptom**: Logs show "Elasticsearch connection failed"

**Solutions**:

- Verify the cluster URL is correct and accessible
- Check that your API key has proper permissions
- Test connection: `curl -H "Authorization: ApiKey YOUR_KEY" https://your-cluster:9200`

### Indexing Errors

**Symptom**: Logs show "Error indexing PR stats to Elasticsearch"

**Solutions**:

- Check API key permissions (needs `create_index`, `write`, `read` on the index)
- Verify the cluster has available storage
- Check Elasticsearch cluster health

### Data Not Appearing

**Symptom**: Data is indexed but not showing in searches

**Solutions**:

- Wait a few seconds (indexing is async, and refresh is not immediate)
- Force refresh: `POST /github-pr-stats/_refresh`
- Check index exists: `GET /github-pr-stats/_mapping`

## Security Best Practices

1. **Use API Keys**: Don't use username/password authentication
2. **Restrict Permissions**: Create API keys with minimal required permissions
3. **Rotate Keys**: Regularly rotate API keys
4. **Network Security**: Use HTTPS and consider IP filtering
5. **Environment Variables**: Never commit credentials to version control

## Advanced Configuration

### Custom Index Template

You can create a custom index template before first use.

**For traditional Elasticsearch deployments:**

```bash
curl -X PUT "https://your-cluster:9200/_index_template/github-pr-stats-template" \
  -H "Authorization: ApiKey your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "index_patterns": ["github-pr-stats*"],
    "template": {
      "settings": {
        "number_of_shards": 2,
        "number_of_replicas": 1,
        "refresh_interval": "30s"
      }
    }
  }'
```

**For serverless Elasticsearch:**

Settings like `number_of_shards` and `number_of_replicas` are managed automatically and cannot be configured. The service will create the index with only mappings.

### Index Lifecycle Management (ILM)

**Note**: ILM is only available for traditional Elasticsearch deployments. Serverless deployments manage data lifecycle automatically.

Set up ILM policies to automatically manage index retention (traditional deployments only):

```bash
curl -X PUT "https://your-cluster:9200/_ilm/policy/github-pr-stats-policy" \
  -H "Authorization: ApiKey your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "policy": {
      "phases": {
        "hot": {
          "actions": {
            "rollover": {
              "max_age": "30d",
              "max_size": "50gb"
            }
          }
        },
        "delete": {
          "min_age": "365d",
          "actions": {
            "delete": {}
          }
        }
      }
    }
  }'
```

## Example Queries

### Top Contributors by PR Count

```json
{
  "size": 0,
  "aggs": {
    "authors": {
      "terms": {
        "field": "author",
        "size": 10
      }
    }
  }
}
```

### Average Build Time by Repository

```json
{
  "size": 0,
  "aggs": {
    "repos": {
      "terms": { "field": "repo_name" },
      "aggs": {
        "avg_build_time": {
          "avg": {
            "field": "build_stats.wall_to_wall_build_time_ms"
          }
        }
      }
    }
  }
}
```

### PRs with High Delivery Friction

```json
{
  "query": {
    "range": {
      "metrics.delivery_friction": {
        "gte": 7.0
      }
    }
  },
  "sort": [{ "metrics.delivery_friction": "desc" }]
}
```

### Build Success Rate Over Time

```json
{
  "size": 0,
  "aggs": {
    "by_month": {
      "date_histogram": {
        "field": "created_at",
        "calendar_interval": "month"
      },
      "aggs": {
        "total_builds": { "sum": { "field": "build_stats.total_builds" } },
        "successful_builds": {
          "sum": { "field": "build_stats.successful_builds" }
        }
      }
    }
  }
}
```

## Support

For issues or questions:

- Check Elasticsearch logs for detailed error messages
- Verify environment variable configuration
- Consult Elasticsearch documentation: https://www.elastic.co/guide/en/elasticsearch/reference/current/index.html
