# Quick Start Guide

Get up and running in 5 minutes! 🚀

## Prerequisites

- Docker and Docker Compose installed
- An Elasticsearch cluster (Cloud, Serverless, or self-hosted)
- GitHub token (for enrichment features)
- Webhook secrets from GitHub/Buildkite

## Step 1: Configure Environment

```bash
# Copy the environment template
cp env.template .env

# Edit .env with your credentials
nano .env
```

**Required settings:**

```bash
# Elasticsearch Serverless (shared with pr-stats-app)
ES_NODE=https://your-project.es.region.aws.found.io:443
ES_API_KEY=your_api_key_here
ES_INDEX_NAME=github-pr-stats

# GitHub credentials
GITHUB_TOKEN=ghp_your_token_here
GITHUB_WEBHOOK_SECRET=your_webhook_secret

# Buildkite token
BUILDKITE_WEBHOOK_TOKEN=your_buildkite_token
```

## Step 2: Start Services

```bash
# Start the OpenTelemetry Collector and your app
docker-compose up -d

# Check logs
docker-compose logs -f
```

## Step 3: Verify Everything Works

### Check Service Health

```bash
# Your app
curl http://localhost:3000/health
# Should return: {"status":"healthy","receivers":{"github":true,"buildkite":true}}

# OTel Collector
curl http://localhost:13133
# Should return: {"status":"Server available"}
```

### Send a Test Event

```bash
curl -X POST http://localhost:3000/webhook/github \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: pull_request" \
  -d '{
    "action": "opened",
    "number": 1,
    "pull_request": {
      "id": 1,
      "title": "Test PR",
      "state": "open",
      "html_url": "https://github.com/test/repo/pull/1",
      "user": {"login": "testuser"},
      "base": {"ref": "main"},
      "head": {"ref": "feature"},
      "created_at": "2024-01-01T00:00:00Z",
      "updated_at": "2024-01-01T00:00:00Z"
    },
    "repository": {"full_name": "test/repo"}
  }'
```

### Check Elasticsearch for the Event

```bash
# Get today's index
TODAY=$(date +%Y.%m.%d)

# Search for events
curl -X GET "https://your-es-host:9200/cicd-events-${TODAY}/_search?pretty" \
  -u elastic:your_password \
  -H 'Content-Type: application/json' \
  -d '{"query": {"match_all": {}},"size": 1}'
```

## Step 4: Configure Webhooks

### GitHub Webhook

1. Go to your repo: `https://github.com/owner/repo/settings/hooks`
2. Click "Add webhook"
3. Set **Payload URL**: `https://your-domain.com/webhook/github`
4. Set **Content type**: `application/json`
5. Set **Secret**: (same as `GITHUB_WEBHOOK_SECRET` in .env)
6. Select events:
   - Pull requests
   - Pull request reviews
   - Pull request review comments
   - Releases
7. Click "Add webhook"

### Buildkite Webhook

1. Go to: `https://buildkite.com/organizations/your-org/services/webhooks/new`
2. Set **URL**: `https://your-domain.com/webhook/buildkite`
3. Set **Token**: (same as `BUILDKITE_WEBHOOK_TOKEN` in .env)
4. Select events: Build events
5. Click "Add webhook"

## Step 5: View Logs in Kibana

1. Open your Kibana: `https://your-kibana-host:5601`
2. Go to **Management** → **Stack Management** → **Data Views**
3. Create data view: `cicd-events-*`
4. Go to **Analytics** → **Discover**
5. Select the `cicd-events-*` data view
6. You should see your GitHub/Buildkite events! 🎉

## Recommended Kibana Queries

### All PR events

```
event.type: "github.pull_request"
```

### Failed builds

```
event.type: "buildkite.build" AND buildkite.build.state: "failed"
```

### PRs by a specific author

```
github.pr.author: "username"
```

### Builds for a specific PR

```
github.pr.number: 123
```

### Events from the last 24 hours with complexity > 100

```
@timestamp >= now-24h AND github.pr.complexity_score > 100
```

## Troubleshooting

### No events appearing in Elasticsearch?

1. **Check OTel Collector logs:**

   ```bash
   docker logs otel-collector
   ```

2. **Verify Elasticsearch connectivity:**

   ```bash
   docker exec otel-collector curl http://your-es-host:9200
   ```

3. **Check if indices are being created:**
   ```bash
   curl https://your-es-host:9200/_cat/indices/cicd-events-*?v
   ```

### Webhook verification failing?

1. **Check your webhook secret matches:**

   ```bash
   # In .env
   grep WEBHOOK_SECRET .env
   ```

2. **Test without verification** (for debugging only):
   - Temporarily comment out the secret in `.env`
   - Restart: `docker-compose restart`

### OTel Collector memory issues?

Adjust the memory limiter in `otel-collector-config.yaml`:

```yaml
processors:
  memory_limiter:
    limit_mib: 1024 # Increase from 512
```

## Next Steps

- 📊 [Create Kibana Dashboards](https://www.elastic.co/guide/en/kibana/current/dashboard.html)
- 🔍 [Set up alerts](https://www.elastic.co/guide/en/kibana/current/alerting-getting-started.html)
- 📈 [Backfill historical data](./README.md#backfill-historical-data)
- 🚀 [Deploy to production](./DEPLOYMENT.md)

## Support

- 📖 Full documentation: [README.md](./README.md)
- 🚀 Deployment guide: [DEPLOYMENT.md](./DEPLOYMENT.md)
- 🐛 Issues: Check Docker logs and Elasticsearch indices
