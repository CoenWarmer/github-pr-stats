import { Client } from '@elastic/elasticsearch';
import { createHash } from 'crypto';

// Initialize Elasticsearch client if credentials are available
let esClient: Client | null = null;

if (
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT &&
  process.env.OTEL_EXPORTER_OTLP_HEADERS
) {
  // Extract the base URL (remove path)
  const otlpUrl = new URL(process.env.OTEL_EXPORTER_OTLP_ENDPOINT);
  const esNode = `${otlpUrl.protocol}//${otlpUrl.host}`;

  // Parse authorization header
  const headers = process.env.OTEL_EXPORTER_OTLP_HEADERS;
  const authMatch = headers.match(/Authorization=ApiKey\s+(.+)/);

  if (authMatch) {
    esClient = new Client({
      node: esNode,
      auth: {
        apiKey: authMatch[1].trim(),
      },
    });
    console.log('✓ Elasticsearch client initialized for duplicate detection');
  }
}

// Generate deterministic trace ID (must match otel.ts logic)
function generateDeterministicTraceId(
  repository: string,
  prNumber: number
): string {
  const input = `${repository}:pr:${prNumber}`;
  const hash = createHash('sha256').update(input).digest('hex');
  return hash.substring(0, 32);
}

/**
 * Check if a PR trace already exists in Elasticsearch
 * Returns true if the PR has already been backfilled
 */
export async function prTraceExists(
  repository: string,
  prNumber: number
): Promise<boolean> {
  if (!esClient) {
    // If ES client is not configured, assume PR doesn't exist (allow processing)
    return false;
  }

  try {
    const deterministicTraceId = generateDeterministicTraceId(
      repository,
      prNumber
    );

    const result = await esClient.search({
      index: 'traces-generic.otel-default',
      size: 0,
      query: {
        term: {
          'attributes.github.deterministic_trace_id': deterministicTraceId,
        },
      },
      timeout: '5s',
    });

    const count =
      typeof result.hits.total === 'object'
        ? result.hits.total.value
        : result.hits.total;

    return (count ?? 0) > 0;
  } catch (error: any) {
    // If index doesn't exist or other error, assume PR doesn't exist
    if (error.meta?.statusCode === 404) {
      return false;
    }
    console.warn(`[ES] Error checking for PR #${prNumber}:`, error.message);
    return false;
  }
}

/**
 * Close the Elasticsearch client gracefully
 */
export async function closeElasticsearch(): Promise<void> {
  if (esClient) {
    await esClient.close();
  }
}
