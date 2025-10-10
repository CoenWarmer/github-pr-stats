/**
 * OpenTelemetry-compliant CI/CD timeline structures
 * Based on: https://github.com/open-telemetry/semantic-conventions/tree/main/model/cicd
 * Spec: https://opentelemetry.io/docs/specs/semconv/cicd/cicd-metrics/
 */

export interface OTelSpan {
  // Core span fields
  trace_id: string; // Unique identifier for the entire PR flow
  span_id: string; // Unique identifier for this specific span
  parent_span_id?: string; // Parent span ID for nested operations
  name: string; // Human-readable name of the operation
  kind: 'SPAN_KIND_INTERNAL' | 'SPAN_KIND_CLIENT' | 'SPAN_KIND_SERVER';
  start_time_unix_nano: string; // Start time in nanoseconds since epoch
  end_time_unix_nano: string; // End time in nanoseconds since epoch
  attributes: OTelAttributes;
  events?: OTelEvent[];
  status: OTelStatus;
}

export interface OTelAttributes {
  // CI/CD Pipeline attributes (required)
  'cicd.pipeline.name'?: string; // e.g., "kibana / pull request"
  'cicd.pipeline.run.id'?: string; // e.g., PR number or build ID
  'cicd.pipeline.run.result'?: 'success' | 'failure' | 'cancelled' | 'skipped';

  // CI/CD Task attributes
  'cicd.pipeline.task.name'?: string; // e.g., "lint", "test", "build"
  'cicd.pipeline.task.type'?: 'build' | 'test' | 'deploy';
  'cicd.pipeline.task.run.id'?: string; // Job/task run identifier

  // VCS (Version Control System) attributes
  'vcs.repository.url.full'?: string; // e.g., "https://github.com/elastic/kibana"
  'vcs.repository.ref.name'?: string; // Branch name
  'vcs.repository.ref.revision'?: string; // Commit SHA
  'vcs.repository.ref.type'?: 'branch' | 'tag';

  // PR-specific attributes (custom, but following OTel naming conventions)
  'pr.number'?: number;
  'pr.title'?: string;
  'pr.author'?: string;
  'pr.state'?: 'open' | 'closed' | 'merged';
  'pr.review.state'?: 'approved' | 'changes_requested' | 'commented';
  'pr.review.author'?: string;

  // Build system specific (Buildkite in our case)
  'cicd.build_system.name'?: 'buildkite' | 'github_actions';
  'buildkite.build.id'?: string;
  'buildkite.build.number'?: number;
  'buildkite.pipeline.slug'?: string;

  // Additional metadata
  [key: string]: string | number | boolean | undefined;
}

export interface OTelEvent {
  time_unix_nano: string;
  name: string;
  attributes?: Record<string, string | number | boolean>;
}

export interface OTelStatus {
  code: 'STATUS_CODE_UNSET' | 'STATUS_CODE_OK' | 'STATUS_CODE_ERROR';
  message?: string;
}

export interface OTelMetric {
  name: string;
  description: string;
  unit: string;
  data: OTelMetricData;
}

export interface OTelMetricData {
  data_points: OTelDataPoint[];
}

export interface OTelDataPoint {
  attributes: OTelAttributes;
  start_time_unix_nano: string;
  time_unix_nano: string;
  value: number;
}

/**
 * OTel-compliant timeline for a Pull Request
 * Contains spans representing the entire PR lifecycle
 */
export interface OTelPRTimeline {
  resource_spans: OTelResourceSpan[];
  metrics?: OTelMetric[];
}

export interface OTelResourceSpan {
  resource: {
    attributes: {
      'service.name': string;
      'service.version'?: string;
      'deployment.environment'?: string;
    };
  };
  scope_spans: OTelScopeSpan[];
}

export interface OTelScopeSpan {
  scope: {
    name: string;
    version?: string;
  };
  spans: OTelSpan[];
}

/**
 * Mapping guide from our timeline events to OTel spans:
 *
 * TimelineEvent type -> OTel span mapping:
 * - ci_run, ci_started, ci_completed -> cicd.pipeline.task span
 * - commits_added, commits_pushed -> vcs.commit event
 * - review -> pr.review span
 * - merged, closed -> pr.lifecycle event
 * - released -> deployment span
 * - awaiting_review -> pr.review.wait span
 */
