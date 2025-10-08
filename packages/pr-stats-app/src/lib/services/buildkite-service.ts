import { TimelineEvent, BuildkiteBuild, BuildkiteJob } from '../types';
import { logger } from '../logger';

/**
 * Service for interacting with Buildkite API and creating CI events
 */
export class BuildkiteService {
  private buildkiteToken?: string;
  private buildkiteOrgSlug?: string;

  constructor(buildkiteToken?: string, buildkiteOrgSlug?: string) {
    this.buildkiteToken = buildkiteToken;
    this.buildkiteOrgSlug = buildkiteOrgSlug;
  }

  /**
   * Fetch all Buildkite builds for a specific commit SHA
   */
  async getBuildkiteBuildsForCommit(
    commitSha: string
  ): Promise<BuildkiteBuild[]> {
    if (!this.buildkiteToken || !this.buildkiteOrgSlug) {
      logger.debug('Buildkite integration not configured');
      return [];
    }

    try {
      // Fetch all builds for the organization, filtered by commit
      const apiUrl = `https://api.buildkite.com/v2/organizations/${this.buildkiteOrgSlug}/builds?commit=${commitSha}&per_page=100`;

      const response = await fetch(apiUrl, {
        headers: {
          Authorization: `Bearer ${this.buildkiteToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        logger.warn(
          `Buildkite API error: ${response.status} ${response.statusText}`,
          { apiUrl, commitSha }
        );
        return [];
      }

      const builds: BuildkiteBuild[] = await response.json();

      logger.debug(
        `Found ${builds.length} Buildkite builds for commit ${commitSha.substring(0, 8)}`,
        {
          commitSha: commitSha.substring(0, 8),
          buildCount: builds.length,
          pipelines: builds.map(b => b.pipeline.name),
        }
      );

      return builds;
    } catch (error) {
      logger.warn('Error fetching Buildkite builds for commit', {
        error: error instanceof Error ? error.message : String(error),
        commitSha: commitSha.substring(0, 8),
      });
      return [];
    }
  }

  /**
   * Fetch Buildkite build information from a Buildkite URL (legacy method for backward compatibility)
   */
  async getBuildkiteBuild(buildUrl: string): Promise<BuildkiteBuild | null> {
    if (!this.buildkiteToken || !this.buildkiteOrgSlug) {
      logger.debug('Buildkite integration not configured');
      return null;
    }

    try {
      // Extract pipeline slug and build number from URL
      // Example: https://buildkite.com/elastic/kibana-pull-request/builds/339958
      const pipelineSlug = this.extractBuildkitePipelineSlug(buildUrl);
      const buildNumber = this.extractBuildkiteBuildNumber(buildUrl);

      if (!pipelineSlug || !buildNumber) {
        logger.warn(
          'Could not extract pipeline slug or build number from URL',
          {
            buildUrl,
            pipelineSlug,
            buildNumber,
          }
        );
        return null;
      }

      // Fetch the specific build using the API
      const apiUrl = `https://api.buildkite.com/v2/organizations/${this.buildkiteOrgSlug}/pipelines/${pipelineSlug}/builds/${buildNumber}`;

      const response = await fetch(apiUrl, {
        headers: {
          Authorization: `Bearer ${this.buildkiteToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        logger.warn(
          `Buildkite API error: ${response.status} ${response.statusText}`,
          { apiUrl }
        );
        return null;
      }

      const build: BuildkiteBuild = await response.json();

      logger.debug(
        `Found Buildkite build ${build.number} for pipeline ${build.pipeline.slug}`,
        {
          buildId: build.id,
          state: build.state,
          pipelineName: build.pipeline.name,
        }
      );

      return build;
    } catch (error) {
      logger.warn('Error fetching Buildkite build', {
        error: error instanceof Error ? error.message : String(error),
        buildUrl,
      });
      return null;
    }
  }

  /**
   * Extract Buildkite pipeline slug from a Buildkite URL
   */
  private extractBuildkitePipelineSlug(url: string): string | null {
    // Example: https://buildkite.com/elastic/kibana-pull-request/builds/339958
    const match = url.match(/buildkite\.com\/[^\/]+\/([^\/]+)\/builds/);
    return match ? match[1] : null;
  }

  /**
   * Extract Buildkite build number from a Buildkite URL
   */
  private extractBuildkiteBuildNumber(url: string): string | null {
    // Example: https://buildkite.com/elastic/kibana-pull-request/builds/339958
    const match = url.match(/builds\/(\d+)/);
    return match ? match[1] : null;
  }

  /**
   * Format duration in milliseconds to a human-readable string
   */
  private formatDuration(durationMs: number): string {
    const hours = Math.floor(durationMs / (1000 * 60 * 60));
    const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }

  /**
   * Create enriched CI events from Buildkite build data
   */
  createCIEventsFromBuildkiteBuild(
    build: BuildkiteBuild,
    options: { includeJobs?: boolean; hideJobsFromTimeline?: boolean } = {}
  ): TimelineEvent[] {
    const events: TimelineEvent[] = [];

    // Calculate duration for the main build
    const startTime = build.started_at || build.created_at;
    const endTime = build.finished_at;
    let durationMs = 0;

    if (startTime && endTime) {
      durationMs = new Date(endTime).getTime() - new Date(startTime).getTime();
    }

    // Determine failure reason if build failed
    let failureReason: string | undefined;
    if (build.state === 'failed' || build.state === 'canceled') {
      const failedJobs = build.jobs?.filter(
        job =>
          job.state === 'failed' ||
          job.state === 'broken' ||
          job.state === 'timed_out' ||
          job.state === 'canceled'
      );

      if (failedJobs && failedJobs.length > 0) {
        const reasons: string[] = [];
        for (const job of failedJobs) {
          if (job.name) {
            if (job.state === 'timed_out') {
              reasons.push(`${job.name}: Timed out`);
            } else if (
              job.exit_status !== null &&
              job.exit_status !== undefined
            ) {
              reasons.push(`${job.name}: Exit code ${job.exit_status}`);
            } else {
              reasons.push(`${job.name}: ${job.state}`);
            }
          }
        }
        if (reasons.length > 0) {
          failureReason = reasons.slice(0, 5).join(', '); // Limit to first 5 failures
          if (reasons.length > 5) {
            failureReason += `, and ${reasons.length - 5} more...`;
          }
        }
      } else if (build.state === 'canceled') {
        failureReason = 'Build was canceled';
      }
    }

    // Build popover content
    let popoverContent = `
      <strong>${build.pipeline.name}</strong><br/>
      ${new Date(startTime).toLocaleString()}<br/>
      ${endTime ? `<strong>End:</strong> ${new Date(endTime).toLocaleString()}<br/>` : ''}
      ${durationMs > 0 ? `<strong>Duration:</strong> ${this.formatDuration(durationMs)}<br/>` : ''}
    `;

    if (build.number) {
      popoverContent += `<br/><strong>Build #:</strong> ${build.number}`;
    }
    if (build.pipeline.slug) {
      popoverContent += `<br/><strong>Pipeline:</strong> ${build.pipeline.slug}`;
    }
    popoverContent += `<br/><strong>Status:</strong> ${build.state === 'running' ? 'started' : 'completed'}`;
    popoverContent += `<br/><strong>Conclusion:</strong> ${this.mapBuildkiteStateToCIConclusion(build.state)}`;

    if (failureReason) {
      popoverContent += `<br/><br/><strong>Failure Reason:</strong><br/><em>${failureReason}</em>`;
    }

    const conclusion = this.mapBuildkiteStateToCIConclusion(build.state);

    const conclusionEmojiMap = {
      success: '✅',
      failure: '❌',
      cancelled: '✖️',
      skipped: '⚠️',
      neutral: '❌',
      in_progress: '🏃‍♀️',
      action_required: '⚠️',
    };

    // Create main build event
    const buildEvent: TimelineEvent = {
      type: build.state === 'running' ? 'ci_started' : 'ci_run',
      date: startTime,
      title: `${conclusionEmojiMap[conclusion as keyof typeof conclusionEmojiMap]} ${build.pipeline.name} (${build.number})`,
      end_date: endTime || undefined,
      workflow_name: build.pipeline.name,
      ci_conclusion: conclusion,
      ci_status: build.state === 'running' ? 'started' : 'completed',
      url: build.web_url,
      buildkite_build_id: build.id,
      buildkite_build_number: build.number,
      buildkite_pipeline_slug: build.pipeline.slug,
      ci_failure_reason: failureReason,
      popoverContent: popoverContent,
      // Add duration information
      duration_ms: durationMs,
      duration_minutes: Math.round(durationMs / (1000 * 60)),
      duration_hours: Math.round((durationMs / (1000 * 60 * 60)) * 100) / 100, // 2 decimal places
    };

    events.push(buildEvent);

    // Optionally create events for individual jobs if needed
    const { includeJobs = true, hideJobsFromTimeline = true } = options;

    if (includeJobs && build.jobs && build.jobs.length > 0) {
      for (const job of build.jobs) {
        if (job.type === 'script' && job.name) {
          // Calculate duration for individual job
          const jobStartTime = job.started_at || job.created_at;
          const jobEndTime = job.finished_at;
          let jobDurationMs = 0;

          if (jobStartTime && jobEndTime) {
            jobDurationMs =
              new Date(jobEndTime).getTime() - new Date(jobStartTime).getTime();
          }

          // Build job popover content
          let jobPopoverContent = `
            <strong>${build.pipeline.name} - ${job.name}</strong><br/>
            ${new Date(jobStartTime).toLocaleString()}<br/>
            ${jobEndTime ? `<strong>End:</strong> ${new Date(jobEndTime).toLocaleString()}<br/>` : ''}
            ${jobDurationMs > 0 ? `<strong>Duration:</strong> ${this.formatDuration(jobDurationMs)}<br/>` : ''}
          `;

          if (build.number) {
            jobPopoverContent += `<br/><strong>Build #:</strong> ${build.number}`;
          }
          if (build.pipeline.slug) {
            jobPopoverContent += `<br/><strong>Pipeline:</strong> ${build.pipeline.slug}`;
          }
          jobPopoverContent += `<br/><strong>Status:</strong> ${job.state === 'running' ? 'started' : 'completed'}`;
          jobPopoverContent += `<br/><strong>Conclusion:</strong> ${this.mapBuildkiteStateToCIConclusion(job.state)}`;

          // Add job-specific failure info
          if (
            (job.state === 'failed' ||
              job.state === 'broken' ||
              job.state === 'timed_out') &&
            job.exit_status !== null &&
            job.exit_status !== undefined
          ) {
            jobPopoverContent += `<br/><br/><strong>Exit Code:</strong> ${job.exit_status}`;
          } else if (job.state === 'timed_out') {
            jobPopoverContent += `<br/><br/><strong>Failure Reason:</strong><br/><em>Job timed out</em>`;
          }

          const jobEvent: TimelineEvent = {
            type: job.state === 'running' ? 'ci_started' : 'ci_run',
            date: jobStartTime,
            title: `${job.name} ${durationMs > 0 ? `(${this.formatDuration(durationMs)})` : ''}`,
            end_date: jobEndTime || undefined,
            workflow_name: `${build.pipeline.name} - ${job.name}`,
            ci_conclusion: this.mapBuildkiteStateToCIConclusion(job.state),
            ci_status: job.state === 'running' ? 'started' : 'completed',
            url: job.web_url,
            buildkite_build_id: build.id,
            buildkite_build_number: build.number,
            buildkite_pipeline_slug: build.pipeline.slug,
            popoverContent: jobPopoverContent,
            // Add job duration information
            duration_ms: jobDurationMs,
            duration_minutes: Math.round(jobDurationMs / (1000 * 60)),
            duration_hours:
              Math.round((jobDurationMs / (1000 * 60 * 60)) * 100) / 100,
            // Hide job events from timeline display (but keep in cache)
            hidden_from_timeline: hideJobsFromTimeline,
          };

          events.push(jobEvent);
        }
      }
    }

    logger.debug(`Created ${events.length} CI events from Buildkite build`, {
      buildId: build.id,
      pipelineName: build.pipeline.name,
      state: build.state,
      jobCount: build.jobs?.length || 0,
    });

    return events;
  }

  /**
   * Map Buildkite build/job state to GitHub CI conclusion
   */
  private mapBuildkiteStateToCIConclusion(
    state: BuildkiteBuild['state'] | BuildkiteJob['state']
  ): string {
    switch (state) {
      case 'passed':
        return 'success';
      case 'failed':
      case 'broken': // Job-specific
      case 'timed_out': // Job-specific
        return 'failure';
      case 'canceled':
      case 'canceling': // Build-specific
        return 'cancelled';
      case 'blocked':
        return 'action_required';
      case 'skipped':
      case 'not_run': // Build-specific
        return 'skipped';
      case 'waiting':
      case 'pending':
      case 'running':
      case 'scheduled': // Build-specific
        return 'in_progress';
      default:
        return 'neutral';
    }
  }
}
