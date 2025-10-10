/**
 * Transforms PR timeline data into OpenTelemetry-compliant format
 * Follows OTel CI/CD semantic conventions: https://opentelemetry.io/docs/specs/semconv/cicd/
 */

import { PullRequestStats, TimelineEvent } from './types';
import {
  OTelPRTimeline,
  OTelSpan,
  OTelAttributes,
  OTelStatus,
  OTelMetric,
} from './types-otel';
import { v4 as uuidv4 } from 'uuid';

export class OTelTransformer {
  private traceId: string;
  private prUrl: string;

  constructor(pr: PullRequestStats) {
    // Generate a unique trace ID for this PR
    this.traceId = this.generateTraceId(pr.url);
    this.prUrl = pr.url;
  }

  /**
   * Transform PR stats into OTel-compliant timeline
   */
  transform(pr: PullRequestStats): OTelPRTimeline {
    const spans: OTelSpan[] = [];

    // Create root span for the entire PR lifecycle
    const rootSpan = this.createPRLifecycleSpan(pr);
    spans.push(rootSpan);

    // Create spans for CI/CD builds
    const buildSpans = this.createBuildSpans(pr.timeline, rootSpan.span_id);
    spans.push(...buildSpans);

    // Create spans for reviews
    const reviewSpans = this.createReviewSpans(pr.timeline, rootSpan.span_id);
    spans.push(...reviewSpans);

    // Create spans for commits
    const commitSpans = this.createCommitSpans(pr.timeline, rootSpan.span_id);
    spans.push(...commitSpans);

    // Create metrics
    const metrics = this.createMetrics(pr);

    return {
      resource_spans: [
        {
          resource: {
            attributes: {
              'service.name': 'github-pr-stats',
              'service.version': '1.0.0',
              'deployment.environment': 'production',
            },
          },
          scope_spans: [
            {
              scope: {
                name: 'pr-timeline-collector',
                version: '1.0.0',
              },
              spans,
            },
          ],
        },
      ],
      metrics,
    };
  }

  /**
   * Create root span representing the entire PR lifecycle
   */
  private createPRLifecycleSpan(pr: PullRequestStats): OTelSpan {
    const startTime = new Date(pr.created_at).getTime() * 1000000; // Convert to nanoseconds
    const endTime = pr.closed_at
      ? new Date(pr.closed_at).getTime() * 1000000
      : Date.now() * 1000000;

    const [owner, repo] = this.extractOwnerRepo(pr.url);

    const attributes: OTelAttributes = {
      'cicd.pipeline.name': `${owner}/${repo} PR Pipeline`,
      'cicd.pipeline.run.id': pr.id.toString(),
      'cicd.pipeline.run.result': this.mapPRStateToResult(
        pr.state,
        pr.merged_at
      ),
      'vcs.repository.url.full': `https://github.com/${owner}/${repo}`,
      'vcs.repository.ref.name': 'pull-request',
      'vcs.repository.ref.revision': pr.headSha,
      'vcs.repository.ref.type': 'branch',
      'pr.number':
        typeof pr.id === 'number' ? pr.id : parseInt(pr.id as string),
      'pr.title': pr.title,
      'pr.author': pr.author,
      'pr.state': pr.merged_at
        ? 'merged'
        : (pr.state as 'open' | 'closed' | 'merged'),
    };

    return {
      trace_id: this.traceId,
      span_id: this.generateSpanId(),
      name: `PR #${pr.id}: ${pr.title}`,
      kind: 'SPAN_KIND_INTERNAL',
      start_time_unix_nano: startTime.toString(),
      end_time_unix_nano: endTime.toString(),
      attributes,
      status: this.getPRStatus(pr),
    };
  }

  /**
   * Create spans for CI/CD builds
   */
  private createBuildSpans(
    timeline: TimelineEvent[],
    parentSpanId: string
  ): OTelSpan[] {
    const spans: OTelSpan[] = [];

    const buildEvents = timeline.filter(
      event =>
        event.type === 'ci_run' ||
        event.type === 'ci_started' ||
        event.type === 'ci_completed'
    );

    for (const event of buildEvents) {
      const startTime = new Date(event.date).getTime() * 1000000;
      const endTime = event.end_date
        ? new Date(event.end_date).getTime() * 1000000
        : startTime;

      const attributes: OTelAttributes = {
        'cicd.pipeline.task.name': event.workflow_name || 'Unknown Build',
        'cicd.pipeline.task.type': 'build',
        'cicd.pipeline.task.run.id': event.buildkite_build_id,
        'cicd.build_system.name': event.buildkite_build_id
          ? 'buildkite'
          : 'github_actions',
      };

      if (event.buildkite_build_id) {
        attributes['buildkite.build.id'] = event.buildkite_build_id;
      }
      if (event.buildkite_build_number) {
        attributes['buildkite.build.number'] = event.buildkite_build_number;
      }
      if (event.buildkite_pipeline_slug) {
        attributes['buildkite.pipeline.slug'] = event.buildkite_pipeline_slug;
      }
      if (event.ci_conclusion) {
        attributes['cicd.pipeline.run.result'] = event.ci_conclusion as
          | 'success'
          | 'failure'
          | 'cancelled'
          | 'skipped';
      }

      spans.push({
        trace_id: this.traceId,
        span_id: this.generateSpanId(),
        parent_span_id: parentSpanId,
        name: event.title,
        kind: 'SPAN_KIND_INTERNAL',
        start_time_unix_nano: startTime.toString(),
        end_time_unix_nano: endTime.toString(),
        attributes,
        status: this.getCIStatus(event.ci_conclusion),
      });
    }

    return spans;
  }

  /**
   * Create spans for code reviews
   */
  private createReviewSpans(
    timeline: TimelineEvent[],
    parentSpanId: string
  ): OTelSpan[] {
    const spans: OTelSpan[] = [];

    const reviewEvents = timeline.filter(event => event.type === 'review');

    for (const event of reviewEvents) {
      const timestamp = new Date(event.date).getTime() * 1000000;

      const attributes: OTelAttributes = {
        'pr.review.state': (event.state || 'commented') as
          | 'approved'
          | 'changes_requested'
          | 'commented',
        'pr.review.author': event.reviewer || 'unknown',
      };

      // Reviews are point-in-time events in OTel terms
      spans.push({
        trace_id: this.traceId,
        span_id: this.generateSpanId(),
        parent_span_id: parentSpanId,
        name: `Review: ${event.state || 'commented'}`,
        kind: 'SPAN_KIND_INTERNAL',
        start_time_unix_nano: timestamp.toString(),
        end_time_unix_nano: timestamp.toString(), // Point-in-time
        attributes,
        status: this.getReviewStatus(event.state),
      });
    }

    return spans;
  }

  /**
   * Create spans for commits
   */
  private createCommitSpans(
    timeline: TimelineEvent[],
    parentSpanId: string
  ): OTelSpan[] {
    const spans: OTelSpan[] = [];

    const commitEvents = timeline.filter(
      event =>
        event.type === 'commits_added' ||
        event.type === 'commits_pushed' ||
        event.type === 'commit'
    );

    for (const event of commitEvents) {
      const timestamp = new Date(event.date).getTime() * 1000000;

      const attributes: OTelAttributes = {
        'vcs.operation': event.type.replace('_', '.'),
      };

      if ('commits' in event && Array.isArray(event.commits)) {
        attributes['vcs.commit.count'] = event.commits.length;
      }

      spans.push({
        trace_id: this.traceId,
        span_id: this.generateSpanId(),
        parent_span_id: parentSpanId,
        name: event.title,
        kind: 'SPAN_KIND_INTERNAL',
        start_time_unix_nano: timestamp.toString(),
        end_time_unix_nano: timestamp.toString(),
        attributes,
        status: { code: 'STATUS_CODE_OK' },
      });
    }

    return spans;
  }

  /**
   * Create OTel metrics from PR stats
   */
  private createMetrics(pr: PullRequestStats): OTelMetric[] {
    const metrics: OTelMetric[] = [];

    // Pipeline run duration
    if (pr.created_at && pr.closed_at) {
      const durationSec =
        (new Date(pr.closed_at).getTime() - new Date(pr.created_at).getTime()) /
        1000;

      metrics.push({
        name: 'cicd.pipeline.run.duration',
        description: 'Duration of PR pipeline run',
        unit: 's',
        data: {
          data_points: [
            {
              attributes: {
                'cicd.pipeline.name': `PR #${pr.id}`,
                'cicd.pipeline.run.result': this.mapPRStateToResult(
                  pr.state,
                  pr.merged_at
                ),
              },
              start_time_unix_nano: (
                new Date(pr.created_at).getTime() * 1000000
              ).toString(),
              time_unix_nano: (
                new Date(pr.closed_at).getTime() * 1000000
              ).toString(),
              value: durationSec,
            },
          ],
        },
      });
    }

    // Build time metrics
    if (pr.build_stats.wall_to_wall_build_time_ms) {
      metrics.push({
        name: 'cicd.build.duration',
        description: 'Wall-to-wall build duration',
        unit: 's',
        data: {
          data_points: [
            {
              attributes: {
                'cicd.pipeline.name': `PR #${pr.id}`,
                'build.type': 'wall_to_wall',
              },
              start_time_unix_nano: (
                new Date(pr.created_at).getTime() * 1000000
              ).toString(),
              time_unix_nano: (Date.now() * 1000000).toString(),
              value: pr.build_stats.wall_to_wall_build_time_ms / 1000,
            },
          ],
        },
      });
    }

    if (pr.build_stats.cumulative_build_time_ms) {
      metrics.push({
        name: 'cicd.build.duration',
        description: 'Cumulative build duration (all parallel jobs)',
        unit: 's',
        data: {
          data_points: [
            {
              attributes: {
                'cicd.pipeline.name': `PR #${pr.id}`,
                'build.type': 'cumulative',
              },
              start_time_unix_nano: (
                new Date(pr.created_at).getTime() * 1000000
              ).toString(),
              time_unix_nano: (Date.now() * 1000000).toString(),
              value: pr.build_stats.cumulative_build_time_ms / 1000,
            },
          ],
        },
      });
    }

    return metrics;
  }

  // Helper methods

  private generateTraceId(prUrl: string): string {
    // Generate deterministic trace ID from PR URL
    return Buffer.from(prUrl).toString('hex').substring(0, 32);
  }

  private generateSpanId(): string {
    return uuidv4().replace(/-/g, '').substring(0, 16);
  }

  private extractOwnerRepo(url: string): [string, string] {
    const match = url.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    return match ? [match[1], match[2]] : ['unknown', 'unknown'];
  }

  private mapPRStateToResult(
    state: string,
    mergedAt: string | null
  ): 'success' | 'failure' | 'cancelled' {
    if (mergedAt) return 'success';
    if (state === 'closed') return 'cancelled';
    return 'success';
  }

  private getPRStatus(pr: PullRequestStats): OTelStatus {
    if (pr.merged_at) {
      return { code: 'STATUS_CODE_OK', message: 'PR merged successfully' };
    }
    if (pr.closed_at) {
      return {
        code: 'STATUS_CODE_ERROR',
        message: 'PR closed without merging',
      };
    }
    return { code: 'STATUS_CODE_UNSET' };
  }

  private getCIStatus(conclusion?: string): OTelStatus {
    switch (conclusion) {
      case 'success':
        return { code: 'STATUS_CODE_OK' };
      case 'failure':
      case 'error':
        return { code: 'STATUS_CODE_ERROR', message: `Build ${conclusion}` };
      default:
        return { code: 'STATUS_CODE_UNSET' };
    }
  }

  private getReviewStatus(state?: string): OTelStatus {
    switch (state) {
      case 'approved':
        return { code: 'STATUS_CODE_OK' };
      case 'changes_requested':
        return { code: 'STATUS_CODE_ERROR', message: 'Changes requested' };
      default:
        return { code: 'STATUS_CODE_OK' };
    }
  }
}

/**
 * Convenience function to transform PR stats to OTel format
 */
export function transformToOTel(pr: PullRequestStats): OTelPRTimeline {
  const transformer = new OTelTransformer(pr);
  return transformer.transform(pr);
}
