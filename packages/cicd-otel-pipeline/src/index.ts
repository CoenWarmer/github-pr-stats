// Load environment variables FIRST before any other imports
import './env.js';

// Multi-Source Telemetry Pipeline: GitHub + Buildkite Events to OpenTelemetry
import express from 'express';
import { config } from './config.js';
import { octokit } from './octokit.js';
import { loggerProvider } from './otel.js';
import { closeElasticsearch } from './elasticsearch.js';
import { registerWebhookRoutes } from './routes/webhooks.js';
import { registerBackfillRoutes } from './routes/backfill.js';
import { registerHealthRoute } from './routes/health.js';

// Express app
const app = express();
app.use(express.json());

// Register routes
registerWebhookRoutes(app);
registerBackfillRoutes(app);
registerHealthRoute(app);

// Start server
app.listen(config.port, () => {
  console.log(
    `Multi-source telemetry pipeline listening on port ${config.port}`
  );
  console.log(
    `GitHub webhook endpoint: http://localhost:${config.port}/webhook/github`
  );
  console.log(
    `Buildkite webhook endpoint: http://localhost:${config.port}/webhook/buildkite`
  );
  console.log(
    `GitHub backfill endpoint: http://localhost:${config.port}/backfill/github`
  );
  console.log(
    `Buildkite backfill endpoint: http://localhost:${config.port}/backfill/buildkite`
  );
  console.log(`OTLP endpoint: ${config.otlpEndpoint}`);
  console.log(
    `GitHub webhook secret configured: ${!!config.githubWebhookSecret}`
  );
  console.log(
    `Buildkite webhook token configured: ${!!config.buildkiteWebhookToken}`
  );
  console.log(`GitHub token configured: ${!!config.githubToken}`);
  console.log(`Enrichment enabled: ${!!octokit}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  await loggerProvider.shutdown();
  await closeElasticsearch();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  await loggerProvider.shutdown();
  await closeElasticsearch();
  process.exit(0);
});
