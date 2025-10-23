# CI/CD OpenTelemetry Pipeline

Multi-source telemetry pipeline that receives GitHub and Buildkite webhook events, enriches them with metadata, and exports as OpenTelemetry logs for observability and analytics.

**🚀 [Quick Start Guide](./QUICKSTART.md)** - Get running in 5 minutes!

## Features

### GitHub Integration

- **Pull Request Events**: Track PR lifecycle (opened, merged, closed, draft transitions)
- **Code Reviews**: Capture review submissions, comments, and states
- **Releases**: Monitor software release events
- **Enrichment**:
  - Parse CODEOWNERS files to identify responsible teams
  - Fetch user team memberships via GitHub API
  - Calculate complexity metrics (files changed, lines added/deleted)
  - Extract diff/patch information per file

### Buildkite Integration

- **Build Events**: Track CI/CD builds (started, passed, failed, canceled)
- **Job Metrics**: Monitor individual job performance within builds
- **PR Linking**: Automatically link builds to PRs via commit messages or branch names
- **Performance**: Calculate build duration, parallelization factor, and cumulative job time

### OpenTelemetry Export

All events are transformed into structured OTel log records with:

- Standardized attributes (event type, source, timestamps)
- Severity levels (INFO for normal operations, ERROR for failures)
- Correlation between PRs, builds, reviews, and team members

## API Endpoints

### Webhooks

- `POST /webhook/github` - Receive GitHub webhook events
- `POST /webhook/buildkite` - Receive Buildkite webhook events

### Backfill (Historical Data)

- `POST /backfill/github` - Retroactively process historical PRs
- `POST /backfill/buildkite` - Retroactively process historical builds

### Health Check

- `GET /health` - Service status and configuration

## Configuration

Set the following environment variables:

```bash
# Server
PORT=3000                                    # Server port (default: 3000)
SERVICE_NAME=telemetry-pipeline             # OTel service name

# OpenTelemetry (Standard OTel Environment Variables)
OTEL_EXPORTER_OTLP_ENDPOINT=https://your-apm.elastic.cloud:443  # Elastic APM OTLP endpoint
OTEL_EXPORTER_OTLP_HEADERS=Authorization=ApiKey YOUR_API_KEY     # APM API key
OTEL_RESOURCE_ATTRIBUTES=service.name=cicd-otel-pipeline,service.version=1.0.0,deployment.environment=production

# GitHub
GITHUB_TOKEN=ghp_xxx                        # GitHub API token (optional, for enrichment)
GITHUB_WEBHOOK_SECRET=xxx                   # GitHub webhook secret for signature verification

# Buildkite
BUILDKITE_WEBHOOK_TOKEN=xxx                 # Buildkite webhook token for verification
```

## Quick Start

### Option 1: Docker Compose (Recommended)

Run with OpenTelemetry Collector shipping to your external Elasticsearch:

```bash
# Copy environment template
cp env.template .env

# Edit .env with your credentials:
# - ELASTICSEARCH_ENDPOINT: Your ES instance URL
# - ELASTICSEARCH_USERNAME / PASSWORD: Your ES credentials
# - GITHUB_TOKEN, GITHUB_WEBHOOK_SECRET, BUILDKITE_WEBHOOK_TOKEN

# Start services (app + OTel Collector)
docker-compose up -d

# View logs
docker-compose logs -f

# Access services:
# - Your app: http://localhost:3000
# - OTel Collector health: http://localhost:13133
# - Your Kibana (external): View logs in your own Kibana instance
```

**Optional: Local Development with Bundled Elasticsearch**

If you want to test locally without an external ES instance:

```bash
# Use the local docker-compose file (includes ES + Kibana)
docker-compose -f docker-compose.local.yml up -d

# Access Kibana at http://localhost:5601
```

### Option 2: Local Development

```bash
# Install dependencies
yarn install

# Set up environment
cp env.template .env
# Edit .env - set OTEL_EXPORTER_OTLP_ENDPOINT to your Elastic APM endpoint

# Development mode with hot reload
yarn dev

# Production mode
yarn start

# Build TypeScript
yarn build
```

### Option 3: Production Deployment

See **[DEPLOYMENT.md](./DEPLOYMENT.md)** for:

- Kubernetes deployment
- Docker Swarm setup
- VM/Bare metal installation
- Elasticsearch Cloud integration
- Security best practices
- Scaling strategies

## Usage

### Configure GitHub Webhook

1. Go to your GitHub repository settings → Webhooks
2. Add webhook with URL: `https://your-domain.com/webhook/github`
3. Select events: Pull requests, Pull request reviews, Pull request review comments, Releases
4. Set secret (matches `GITHUB_WEBHOOK_SECRET`)

### Configure Buildkite Webhook

1. Go to Buildkite organization settings → Notification Services
2. Add webhook with URL: `https://your-domain.com/webhook/buildkite`
3. Set token (matches `BUILDKITE_WEBHOOK_TOKEN`)
4. Subscribe to build events

### Backfill Historical Data

**GitHub PRs:**

```bash
curl -X POST http://localhost:3000/backfill/github \
  -H "Content-Type: application/json" \
  -d '{
    "owner": "elastic",
    "repo": "kibana",
    "since": "2024-01-01",
    "until": "2024-12-31",
    "state": "all"
  }'
```

**Buildkite Builds:**

```bash
curl -X POST http://localhost:3000/backfill/buildkite \
  -H "Content-Type: application/json" \
  -d '{
    "organization": "elastic",
    "pipeline": "kibana-pull-request",
    "since": "2024-01-01",
    "until": "2024-12-31",
    "branch": "main"
  }'
```

## Use Cases

- **Engineering Metrics**: Track PR cycle time, review latency, build performance
- **Team Analytics**: Measure code ownership, team velocity, collaboration patterns
- **CI/CD Observability**: Monitor build health, failure rates, bottlenecks
- **Compliance**: Audit trail of code changes and approvals
- **Dashboards**: Feed data to Elasticsearch, Grafana, or other observability platforms

## Security

- GitHub webhook signatures are verified using HMAC-SHA256
- Buildkite webhooks are verified using token authentication
- All secrets are configured via environment variables
- Optional enrichment features (requires GitHub token)
