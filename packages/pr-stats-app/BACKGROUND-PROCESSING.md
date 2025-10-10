# Background Processing for Team PR Ingestion

## Overview

This document describes the background job processing system implemented to handle long-running PR ingestion tasks on Netlify, which has strict timeout limits for serverless functions.

## Problem

Netlify serverless functions have the following timeout limits:

- **Free tier**: 10 seconds
- **Pro tier**: 26 seconds
- **Regular functions**: Cannot run longer than these limits

Processing hundreds of PRs for a team can take many minutes, far exceeding these limits. Even with Server-Sent Events (SSE) and keep-alive messages, there's a hard limit on how long a connection can stay open.

## Solution: Background Jobs with Polling

Instead of using long-running SSE connections, we've implemented a **background job system** with **polling for status updates**.

### Architecture

```
Frontend                  Backend
   |                         |
   |-- POST /api/prs/team/start --> [Create Job]
   |                         |
   |<-- 202 Accepted ---------|
   |    { jobId, statusUrl }  |
   |                         |
   |                    [Process PRs in background]
   |                         |
   |-- Poll every 2s ------->|
   |    GET /api/prs/team/status/{jobId}
   |                         |
   |<-- Job Status ----------|
   |    { status, prs, ... } |
   |                         |
   |-- Poll again ---------->|
   |<-- Updated Status ------|
   |                         |
   |-- Poll until complete ->|
   |<-- { status: 'completed' }
```

### Components

#### 1. Job Manager (`lib/services/job-manager.ts`)

Manages job state using the filesystem:

- **Location**: `/tmp/pr-jobs` on Netlify, `data/jobs` locally
- **Functions**:
  - `createJob(jobId, status)`: Create a new job
  - `updateJobStatus(jobId, updates)`: Update job progress
  - `getJobStatus(jobId)`: Read current job status
  - `deleteJob(jobId)`: Clean up completed jobs

#### 2. Start Job Endpoint (`api/prs/team/start/route.ts`)

**Method**: `POST`

**Request Body**:

```json
{
  "team": "team-slug",
  "repos": "kibana",
  "startDate": "2025-09-10",
  "endDate": "2025-10-10"
}
```

**Response** (202 Accepted):

```json
{
  "jobId": "uuid-v4",
  "totalPRs": 42,
  "statusUrl": "/api/prs/team/status/{jobId}"
}
```

**What it does**:

1. Fetches team members from GitHub
2. Queries GitHub GraphQL API for PRs
3. Creates a job with initial status
4. Starts processing PRs in the background (non-blocking)
5. Returns immediately

#### 3. Status Endpoint (`api/prs/team/status/[jobId]/route.ts`)

**Method**: `GET`

**Response**:

```json
{
  "jobId": "uuid",
  "status": "running" | "completed" | "error",
  "team": "team-slug",
  "repo": "elastic/kibana",
  "totalPRs": 42,
  "processedPRs": 15,
  "completedPRs": 14,
  "errorPRs": 1,
  "prs": [
    {
      "number": 12345,
      "owner": "elastic",
      "repo": "kibana",
      "title": "Fix bug",
      "author": "user",
      "status": "completed" | "processing" | "pending" | "error",
      "error": "optional error message"
    }
  ],
  "startedAt": "2025-10-10T10:00:00Z",
  "completedAt": "2025-10-10T10:05:00Z" // if completed
}
```

#### 4. Frontend Polling (`app/ingest/page.tsx`)

The ingest page:

1. Makes a POST request to `/api/prs/team/start`
2. Receives a `jobId`
3. Polls `/api/prs/team/status/{jobId}` every **2 seconds**
4. Updates the UI with current progress
5. Stops polling when `status === 'completed'` or `status === 'error'`

### How It Works

1. **User submits form** → Frontend calls `/api/prs/team/start`
2. **Backend starts job** → Creates job file, returns immediately
3. **Background processing** → Node.js continues processing PRs asynchronously
4. **Frontend polls status** → Every 2 seconds, checks job progress
5. **Backend updates job** → After each PR, updates job status file
6. **Frontend updates UI** → Shows progress bar and table with PR statuses
7. **Job completes** → Frontend stops polling, shows final results

### Benefits

✅ **No timeouts**: Start endpoint returns immediately  
✅ **Works on Netlify**: Backend continues processing in background  
✅ **Real-time updates**: Polling gives near-real-time progress  
✅ **Resilient**: If frontend disconnects, backend keeps running  
✅ **Efficient**: Only reads small status file on each poll  
✅ **Scalable**: Can handle hundreds of PRs without issues

### Caching Integration

The background processor checks if each PR is already cached:

- If **cached**: Skips processing, marks as completed immediately
- If **not cached**: Processes PR, caches result, indexes to Elasticsearch

This means re-running the same job is very fast!

### Limitations

- **Job files stored in `/tmp`**: On Netlify, `/tmp` is ephemeral and shared across invocations within a short time window
- **No job persistence**: If Netlify instance is killed, job state is lost
- **Polling overhead**: Frontend makes a request every 2 seconds
- **No real-time push**: There's a 2-second delay in UI updates

### Future Improvements

1. **Database storage**: Use a database for job state (Redis, PostgreSQL)
2. **WebSockets**: Switch to WebSockets for true real-time updates
3. **Job queue**: Use a proper queue service (AWS SQS, Azure Queue Storage)
4. **Job expiration**: Clean up old job files automatically
5. **Resume capability**: Allow resuming failed jobs
6. **Parallel processing**: Process multiple PRs concurrently

## Comparison: SSE vs Background Jobs

| Feature               | SSE (Previous)                | Background Jobs (Current)         |
| --------------------- | ----------------------------- | --------------------------------- |
| Connection type       | Long-lived HTTP               | Polling (multiple short requests) |
| Timeout issues        | ❌ Yes, hard limit            | ✅ No, returns immediately        |
| Real-time updates     | ✅ Instant                    | ⚠️ 2-second delay                 |
| Network usage         | ✅ One connection             | ⚠️ Multiple requests              |
| Resilience            | ❌ Connection drops = failure | ✅ Can reconnect anytime          |
| Netlify compatibility | ⚠️ Limited by timeout         | ✅ Fully compatible               |

## Testing

### Local Development

```bash
cd packages/pr-stats-app
yarn dev
```

Navigate to `/`, select a team, date range, and repo. Click "Ingest Team PRs".

### On Netlify

Deploy to Netlify and test with larger datasets (100+ PRs).

### Debugging

Check logs for job processing:

```bash
# On Netlify
netlify logs

# Locally
# Job files are in packages/pr-stats-app/data/jobs/
ls -la packages/pr-stats-app/data/jobs/
cat packages/pr-stats-app/data/jobs/{jobId}.json
```

## Environment Variables

Required:

- `GITHUB_TOKEN`: GitHub personal access token
- `GITHUB_OWNER`: GitHub organization (e.g., "elastic")

Optional:

- `ES_NODE`: Elasticsearch endpoint
- `ES_API_KEY`: Elasticsearch API key
- `ES_INDEX_NAME`: Elasticsearch index name

See `env.template` for details.
