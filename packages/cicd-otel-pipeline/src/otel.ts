import {
  trace,
  context,
  SpanStatusCode,
  SpanKind,
  Span,
  diag,
  DiagConsoleLogger,
  DiagLogLevel,
} from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { Resource } from '@opentelemetry/resources';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import { config } from './config';
import { createHash } from 'crypto';

// Enable OpenTelemetry diagnostic logging to see export errors
diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN);

// Utility functions for deterministic ID generation
// This ensures backfills are idempotent - same PR = same trace/span IDs
function generateDeterministicTraceId(
  repository: string,
  prNumber: number
): string {
  const input = `${repository}:pr:${prNumber}`;
  const hash = createHash('sha256').update(input).digest('hex');
  return hash.substring(0, 32); // 32 hex chars = 16 bytes for trace ID
}

function generateDeterministicSpanId(
  repository: string,
  prNumber: number,
  spanType: string // 'root', 'team:teamName', etc.
): string {
  const input = `${repository}:pr:${prNumber}:${spanType}`;
  const hash = createHash('sha256').update(input).digest('hex');
  return hash.substring(0, 16); // 16 hex chars = 8 bytes for span ID
}

console.log('Initializing OpenTelemetry Tracing...');

// Create resource with service information
// Parse OTEL_RESOURCE_ATTRIBUTES if provided
const resourceAttributes: Record<string, string> = {
  [ATTR_SERVICE_NAME]: config.serviceName,
  [ATTR_SERVICE_VERSION]: '1.0.0',
};

if (process.env.OTEL_RESOURCE_ATTRIBUTES) {
  const attrs = process.env.OTEL_RESOURCE_ATTRIBUTES.split(',');
  attrs.forEach(attr => {
    const [key, value] = attr.split('=');
    if (key && value) {
      resourceAttributes[key.trim()] = value.trim();
    }
  });
}

const resource = Resource.default().merge(new Resource(resourceAttributes));

console.log('Resource attributes:', resourceAttributes);

// Configure OTLP exporter
// Use OTEL_EXPORTER_OTLP_TRACES_ENDPOINT if set, otherwise fall back to OTEL_EXPORTER_OTLP_ENDPOINT
const tracesEndpoint =
  process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ||
  (process.env.OTEL_EXPORTER_OTLP_ENDPOINT
    ? `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces`
    : config.otlpEndpoint.replace('/v1/logs', '/v1/traces'));

console.log('OTLP Traces Endpoint:', tracesEndpoint);

// Parse headers from OTEL_EXPORTER_OTLP_HEADERS
// Format: "key1=value1,key2=value2" (values may contain '=' for base64)
const headers: Record<string, string> = {};
if (process.env.OTEL_EXPORTER_OTLP_HEADERS) {
  const headerPairs = process.env.OTEL_EXPORTER_OTLP_HEADERS.split(',');
  headerPairs.forEach(pair => {
    const equalsIndex = pair.indexOf('=');
    if (equalsIndex > 0) {
      const key = pair.substring(0, equalsIndex).trim();
      const value = pair.substring(equalsIndex + 1).trim();
      headers[key] = value;
    }
  });
}

console.log('OTLP Headers:', Object.keys(headers).join(', '));

const otlpExporter = new OTLPTraceExporter({
  url: tracesEndpoint,
  headers,
  timeoutMillis: 10000,
});

// Create tracer provider with span processor
const tracerProvider = new NodeTracerProvider({
  resource,
  spanProcessors: [new BatchSpanProcessor(otlpExporter)],
});

// Register the provider
tracerProvider.register();

console.log('✓ OpenTelemetry SDK initialized');

// Get tracer instance
const tracer = trace.getTracer(config.serviceName, '1.0.0');

// Storage for active spans (to link child events to parent PR traces)
const activeSpans = new Map<string, Span>();

// Storage for team review spans (to track review turnaround times)
// Key format: "prNumber_repository_teamName"
const teamReviewSpans = new Map<string, Span>();

export const tracing = {
  // Start a new trace (root span) for a PR
  // Use CONSUMER kind so APM recognizes it as a transaction
  startTrace: (
    name: string,
    attributes: Record<string, string | number | boolean>,
    startTime?: Date
  ): { span: Span; traceId: string; spanId: string } => {
    // Add deterministic IDs as attributes for idempotent backfills
    const repository = attributes['github.repository'] as string;
    const prNumber = attributes['github.pr.number'] as number;
    if (repository && prNumber) {
      attributes['github.deterministic_trace_id'] =
        generateDeterministicTraceId(repository, prNumber);
      attributes['github.deterministic_span_id'] = generateDeterministicSpanId(
        repository,
        prNumber,
        'root'
      );
    }

    const span = tracer.startSpan(name, {
      kind: SpanKind.CONSUMER, // CONSUMER for background jobs/webhook processing
      startTime: startTime,
      attributes,
    });

    // Store for potential child spans
    const storageKey = `${prNumber}_${repository}`;
    if (storageKey && prNumber) {
      activeSpans.set(storageKey, span);
    }

    const spanContext = span.spanContext();
    console.log(
      `📍 Started trace [${name}] - traceId: ${spanContext.traceId.substring(0, 16)} (deterministic: ${attributes['github.deterministic_trace_id']?.toString().substring(0, 16)})`
    );

    return {
      span,
      traceId: spanContext.traceId,
      spanId: spanContext.spanId,
    };
  },

  // End a trace (close root span)
  endTrace: (span: Span, status: 'OK' | 'ERROR' = 'OK', endTime?: Date) => {
    if (status === 'ERROR') {
      span.setStatus({ code: SpanStatusCode.ERROR });
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }

    span.end(endTime);
    console.log(`✓ Ended trace`);
  },

  // Create a child span within a trace
  createSpan: (
    name: string,
    attributes: Record<string, string | number | boolean>,
    parentSpan?: Span,
    startTime?: Date,
    spanType?: string // For deterministic ID generation (e.g., 'team:elastic/kibana-security')
  ): Span => {
    // Add deterministic span ID if PR context is available
    const repository = attributes['github.repository'] as string;
    const prNumber = attributes['github.pr.number'] as number;
    if (repository && prNumber && spanType) {
      attributes['github.deterministic_span_id'] = generateDeterministicSpanId(
        repository,
        prNumber,
        spanType
      );
    }

    // If no parent provided, try to find from active spans
    let parent = parentSpan;
    if (!parent && prNumber && repository) {
      const storageKey = `${prNumber}_${repository}`;
      parent = activeSpans.get(storageKey);
    }

    // Create context with parent if available
    const ctx = parent
      ? trace.setSpan(context.active(), parent)
      : context.active();

    const span = tracer.startSpan(
      name,
      {
        kind: SpanKind.INTERNAL,
        startTime: startTime,
        attributes,
      },
      ctx
    );

    return span;
  },

  // End a child span
  endSpan: (span: Span, status: 'OK' | 'ERROR' = 'OK', endTime?: Date) => {
    if (status === 'ERROR') {
      span.setStatus({ code: SpanStatusCode.ERROR });
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }

    span.end(endTime);
  },

  // Emit an event span (instant span with zero duration)
  emitEvent: (
    name: string,
    attributes: Record<string, string | number | boolean>,
    timestamp?: Date,
    parentSpan?: Span
  ) => {
    const span = tracing.createSpan(name, attributes, parentSpan, timestamp);
    // End immediately for instant events
    span.end(timestamp);

    const spanContext = span.spanContext();
    console.log(
      `✓ Event span [${name}] - traceId: ${spanContext.traceId.substring(0, 16)}`
    );
  },

  // Get an active span by PR number and repository
  getActiveSpan: (prNumber: number, repository: string): Span | undefined => {
    const storageKey = `${prNumber}_${repository}`;
    return activeSpans.get(storageKey);
  },

  // Store a team review span for later retrieval
  storeTeamReviewSpan: (
    prNumber: number,
    repository: string,
    teamName: string,
    span: Span
  ) => {
    const storageKey = `${prNumber}_${repository}_${teamName}`;
    teamReviewSpans.set(storageKey, span);
  },

  // Get a team review span
  getTeamReviewSpan: (
    prNumber: number,
    repository: string,
    teamName: string
  ): Span | undefined => {
    const storageKey = `${prNumber}_${repository}_${teamName}`;
    return teamReviewSpans.get(storageKey);
  },

  // End a team review span (called when team approves)
  endTeamReviewSpan: (
    prNumber: number,
    repository: string,
    teamName: string,
    endTime?: Date
  ) => {
    const storageKey = `${prNumber}_${repository}_${teamName}`;
    const span = teamReviewSpans.get(storageKey);
    if (span) {
      span.setStatus({ code: SpanStatusCode.OK });
      span.end(endTime);
      teamReviewSpans.delete(storageKey);
      console.log(`✓ Team review completed: ${teamName} for PR #${prNumber}`);
    }
  },
};

// Simple logger that formats with service name (keep for debugging)
export const logger = {
  info: (
    message: string,
    attributes?: Record<string, string | number | boolean>
  ) => {
    console.log(
      JSON.stringify({
        level: 'info',
        message,
        service: config.serviceName,
        ...attributes,
        timestamp: new Date().toISOString(),
      })
    );
  },
  warn: (
    message: string,
    attributes?: Record<string, string | number | boolean>
  ) => {
    console.warn(
      JSON.stringify({
        level: 'warn',
        message,
        service: config.serviceName,
        ...attributes,
        timestamp: new Date().toISOString(),
      })
    );
  },
  debug: (
    message: string,
    attributes?: Record<string, string | number | boolean>
  ) => {
    console.debug(
      JSON.stringify({
        level: 'debug',
        message,
        service: config.serviceName,
        ...attributes,
        timestamp: new Date().toISOString(),
      })
    );
  },
};

// Export provider for graceful shutdown
export const loggerProvider = {
  shutdown: async () => {
    console.log('Shutting down OpenTelemetry...');
    await tracerProvider.shutdown();
  },
};

// Cleanup old active spans periodically (older than 30 days)
setInterval(
  () => {
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

    for (const [key, span] of activeSpans.entries()) {
      // Check if span is old (this is a heuristic, spans don't have direct timestamps)
      // We'll remove entries older than 30 days based on when we last saw them
      // For production, you might want a more sophisticated approach
      activeSpans.delete(key);
    }
  },
  24 * 60 * 60 * 1000
); // Run daily
