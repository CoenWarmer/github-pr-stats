# Elasticsearch Queries for Review Timings

Since `review_timings` is a nested field, you need to use nested queries to access the data.

## 1. Check if documents have review_timings

```json
GET github-pr-stats-elastic-kibana/_search
{
  "query": {
    "nested": {
      "path": "review_timings",
      "query": {
        "exists": {
          "field": "review_timings.reviewer"
        }
      }
    }
  },
  "_source": ["number", "title", "review_timings"],
  "size": 10
}
```

## 2. Get all documents with their review_timings (basic search)

```json
GET github-pr-stats-elastic-kibana/_search
{
  "_source": ["number", "title", "review_timings"],
  "size": 10
}
```

## 3. Search for specific reviewer

```json
GET github-pr-stats-elastic-kibana/_search
{
  "query": {
    "nested": {
      "path": "review_timings",
      "query": {
        "term": {
          "review_timings.reviewer": "juliaElastic"
        }
      }
    }
  },
  "_source": ["number", "title", "review_timings"]
}
```

## 4. Get review timings statistics

```json
GET github-pr-stats-elastic-kibana/_search
{
  "size": 0,
  "aggs": {
    "review_timings_stats": {
      "nested": {
        "path": "review_timings"
      },
      "aggs": {
        "avg_review_time": {
          "avg": {
            "field": "review_timings.time_to_review_hours"
          }
        },
        "reviewer_count": {
          "cardinality": {
            "field": "review_timings.reviewer"
          }
        },
        "review_states": {
          "terms": {
            "field": "review_timings.state"
          }
        },
        "team_relationships": {
          "terms": {
            "field": "review_timings.author_reviewer_relationship"
          }
        }
      }
    }
  }
}
```

## 5. Check index mapping to confirm nested structure

```json
GET github-pr-stats-elastic-kibana/_mapping
```

## 6. Simple count of documents with review_timings

```json
GET github-pr-stats-elastic-kibana/_count
{
  "query": {
    "nested": {
      "path": "review_timings",
      "query": {
        "match_all": {}
      }
    }
  }
}
```

## 7. In Kibana Discover

If you're using Kibana Discover, you can:

1. Go to Discover
2. Select the index pattern: `github-pr-stats-elastic-kibana`
3. Add fields to the table: `number`, `title`, `review_timings.reviewer`, `review_timings.time_to_review_hours`, `review_timings.state`
4. Use KQL query: `review_timings.reviewer: *` to show only documents with reviews

## Common Issues

1. **Wrong Index Name**: Make sure you're querying the correct index: `github-pr-stats-elastic-kibana`
2. **Nested Field Confusion**: Remember that `review_timings` is nested, so direct field access won't work in aggregations without nested queries
3. **Empty Results**: If PRs don't have reviews, the `review_timings` array will be empty

## Debug Query - Check what's actually indexed

```json
GET github-pr-stats-elastic-kibana/_search
{
  "query": {
    "match_all": {}
  },
  "_source": true,
  "size": 1
}
```

This will show you the actual structure of indexed documents.
