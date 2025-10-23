import type { BuildkiteBuildEvent, BuildkiteApiBuild } from '../types';
import { extractPRNumber } from '../github/helpers';
import { tracing } from '../otel';
import type { Span } from '@opentelemetry/api';

export async function handleBuildkiteBuildEvent(
  event: BuildkiteBuildEvent,
  parentPRSpan?: Span,
  repository?: string,
  explicitPRNumber?: number
): Promise<void> {
  const { build } = event;

  // Calculate build duration if finished
  let durationMs: number | undefined;
  if (build.started_at && build.finished_at) {
    durationMs =
      new Date(build.finished_at).getTime() -
      new Date(build.started_at).getTime();
  }

  // Use explicit PR number if provided, otherwise try to extract from message/branch
  const prNumber =
    explicitPRNumber ?? extractPRNumber(build.message, build.branch);

  const buildAttributes: Record<string, string | number | boolean> = {
    'event.type': 'buildkite.build',
    'event.source': 'buildkite',
    'buildkite.build.id': build.id,
    'buildkite.build.number': build.number,
    'buildkite.build.state': build.state,
    'buildkite.build.message': build.message,
    'buildkite.build.branch': build.branch,
    'buildkite.build.commit': build.commit,
    'buildkite.build.url': build.web_url,
    'buildkite.pipeline.name': build.pipeline.name,
    'buildkite.pipeline.slug': build.pipeline.slug,
    'buildkite.pipeline.repository': build.pipeline.repository,
    'buildkite.build.creator.name': build.creator.name,
    'buildkite.build.creator.email': build.creator.email,
    'buildkite.build.created_at': build.created_at,
    // Add build URL for easy navigation from APM
    url: build.web_url,
    'http.url': build.web_url,
  };

  if (build.started_at) {
    buildAttributes['buildkite.build.started_at'] = build.started_at;
  }

  if (build.finished_at) {
    buildAttributes['buildkite.build.finished_at'] = build.finished_at;
  }

  if (durationMs !== undefined) {
    buildAttributes['buildkite.build.duration_ms'] = durationMs;
    buildAttributes['buildkite.build.duration_seconds'] = Math.round(
      durationMs / 1000
    );
  }

  // Link to PR if found
  if (prNumber) {
    buildAttributes['github.pr.number'] = prNumber;
    buildAttributes['buildkite.build.pr_number'] = prNumber;
  } else if (build.pull_request && 'number' in build.pull_request) {
    buildAttributes['github.pr.number'] = build.pull_request.number;
    buildAttributes['buildkite.build.pr_number'] = build.pull_request.number;
  }

  // Add repository if provided (for linking)
  if (repository) {
    buildAttributes['github.repository'] = repository;
  }

  // Create a span for the build
  const startTime = new Date(build.started_at || build.created_at);
  const endTime = build.finished_at ? new Date(build.finished_at) : new Date();

  let span: Span;

  // If we have a parent PR span, make this build a child of the PR
  if (parentPRSpan && prNumber && repository) {
    console.log(
      `[Buildkite] Creating child span for build #${build.number} under PR #${prNumber}`
    );
    span = tracing.createSpan(
      `Buildkite: ${build.pipeline.name}`,
      buildAttributes,
      parentPRSpan,
      startTime,
      `build:${build.id}` // Deterministic span type
    );
  } else {
    // Otherwise create a standalone trace (for webhook events without PR context)
    console.log(
      `[Buildkite] Creating standalone trace for build #${build.number}`
    );
    const result = tracing.startTrace(
      `Build #${build.number}: ${build.pipeline.name}`,
      buildAttributes,
      startTime
    );
    span = result.span;
  }

  // Create child spans for individual jobs
  if (build.jobs && build.jobs.length > 0) {
    for (const job of build.jobs) {
      let jobDurationMs: number | undefined;
      if (job.started_at && job.finished_at) {
        jobDurationMs =
          new Date(job.finished_at).getTime() -
          new Date(job.started_at).getTime();
      }

      // Construct job URL - link directly to the job in the build
      const jobUrl = `${build.web_url}#${job.id}`;

      const jobAttributes: Record<string, string | number | boolean> = {
        'event.type': 'buildkite.job',
        'event.source': 'buildkite',
        'buildkite.build.id': build.id,
        'buildkite.build.number': build.number,
        'buildkite.job.id': job.id,
        'buildkite.job.name': job.name,
        'buildkite.job.state': job.state,
        // Add job URL for easy navigation from APM
        url: jobUrl,
        'http.url': jobUrl,
      };

      if (job.started_at) {
        jobAttributes['buildkite.job.started_at'] = job.started_at;
      }

      if (job.finished_at) {
        jobAttributes['buildkite.job.finished_at'] = job.finished_at;
      }

      if (jobDurationMs !== undefined) {
        jobAttributes['buildkite.job.duration_ms'] = jobDurationMs;
        jobAttributes['buildkite.job.duration_seconds'] = Math.round(
          jobDurationMs / 1000
        );
      }

      if (job.exit_status !== undefined) {
        jobAttributes['buildkite.job.exit_status'] = job.exit_status;
      }

      if (prNumber) {
        jobAttributes['github.pr.number'] = prNumber;
      }

      // Create child span for job
      const jobStartTime = job.started_at
        ? new Date(job.started_at)
        : startTime;
      const jobEndTime = job.finished_at
        ? new Date(job.finished_at)
        : new Date();

      const jobSpan = tracing.createSpan(
        `Job: ${job.name}`,
        jobAttributes,
        span,
        jobStartTime,
        `job:${job.id}` // Deterministic span type
      );

      const status = job.state === 'failed' ? 'ERROR' : 'OK';
      tracing.endSpan(jobSpan, status, jobEndTime);
    }
  }

  // End the build span
  const buildStatus =
    build.state === 'failed' || build.state === 'canceled' ? 'ERROR' : 'OK';

  // If this is a child span, end it as a child; otherwise end it as a trace
  if (parentPRSpan) {
    tracing.endSpan(span, buildStatus, endTime);
  } else {
    tracing.endTrace(span, buildStatus, endTime);
  }
}

/**
 * Process a Buildkite build from the API (for backfills/linking to PRs)
 */
export async function processBuildkiteBuild(
  build: BuildkiteApiBuild,
  parentPRSpan?: Span,
  repository?: string,
  prNumber?: number
): Promise<void> {
  // Convert API build to event format
  // Note: BuildkiteApiBuild.pull_request doesn't have 'number' field,
  // so we add it manually if provided
  const eventBuild = {
    ...build,
    pull_request: build.pull_request
      ? {
          ...build.pull_request,
          number: prNumber ?? 0, // Add PR number if available
        }
      : undefined,
  };

  const event: BuildkiteBuildEvent = {
    event: 'build.finished',
    build: eventBuild,
  };

  await handleBuildkiteBuildEvent(event, parentPRSpan, repository, prNumber);
}
