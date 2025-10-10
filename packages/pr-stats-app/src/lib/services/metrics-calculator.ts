import { TimelineEvent, LinkedIssue, PullRequestStats } from '../types';
import { calculatePRComplexity, calculateDeliveryFriction } from '../utils';

export interface PRMetrics {
  backAndForthCount: number;
  commitCount: number;
  reviewCommentsCount: number;
  issueCommentsCount: number;
  totalTeamReviewTimeMs: number; // Shortest time from review request to first review
  buildStats: {
    total_builds: number;
    completed_builds: number;
    failed_builds: number;
    successful_builds: number;
    cancelled_builds: number;
    total_build_time_ms: number;
    wall_to_wall_build_time_ms: number;
    cumulative_build_time_ms: number;
  };
  runStartTime: string;
  runEndTime: string;
  complexity: number;
  deliveryFriction: number;
}

/**
 * Calculates all PR metrics from timeline events
 */
export function calculateMetricsFromTimeline(
  timeline: TimelineEvent[],
  pr: PullRequestStats,
  linkedIssues: LinkedIssue[]
): PRMetrics {
  // Calculate back-and-forth interactions
  let backAndForthCount = 0;
  let lastCommentAuthor = '';
  for (const event of timeline) {
    if (
      (event.type === 'comment_added' ||
        event.type === 'review_comment_added') &&
      'author' in event &&
      typeof event.author === 'string'
    ) {
      if (lastCommentAuthor && lastCommentAuthor !== event.author) {
        backAndForthCount++;
      }
      lastCommentAuthor = event.author;
    }
  }

  // Calculate commit count from timeline
  const commitCount = timeline.filter(
    event =>
      event.type === 'commits_added' ||
      event.type === 'commits_pushed' ||
      event.type === 'commit'
  ).length;

  // Calculate review comments count from timeline
  const reviewCommentsCount = timeline.filter(
    event => event.type === 'review_comment_added'
  ).length;

  // Calculate issue comments count from timeline
  const issueCommentsCount = timeline.filter(
    event => event.type === 'issue_comment'
  ).length;

  // Calculate time to first review (shortest waiting time from any review request)
  let timeToFirstReviewMs: number | null = null;

  // Find all review request events
  const reviewRequests = timeline.filter(
    event =>
      event.type === 'team_review_requested' ||
      event.type === 'review_requested'
  );

  for (const requestEvent of reviewRequests) {
    const requestTime = new Date(requestEvent.date).getTime();

    // Find the first review (any type) after this request
    const firstReview = timeline.find(
      e => e.type === 'review' && e.date > requestEvent.date
    );

    if (firstReview) {
      const waitingTime = new Date(firstReview.date).getTime() - requestTime;

      // Keep the shortest waiting time
      if (timeToFirstReviewMs === null || waitingTime < timeToFirstReviewMs) {
        timeToFirstReviewMs = waitingTime;
      }
    }
  }

  const totalTeamReviewTimeMs = timeToFirstReviewMs || 0;

  // Calculate build statistics
  // Include both ci_run and ci_started events
  const allCiBuilds = timeline.filter(
    event => event.type === 'ci_run' || event.type === 'ci_started'
  );

  // Separate main builds from job-level events
  // Main builds don't have " - " in workflow_name or don't have workflow_name with job suffix
  const mainBuilds = allCiBuilds.filter(
    event => !event.workflow_name || !event.workflow_name.includes(' - ')
  );
  const jobBuilds = allCiBuilds.filter(
    event => event.workflow_name && event.workflow_name.includes(' - ')
  );

  // For counting, only use completed main builds (ci_run with completed status)
  const completedMainBuilds = mainBuilds.filter(
    event => event.type === 'ci_run'
  );

  const totalBuilds = completedMainBuilds.length;
  const completedBuilds = completedMainBuilds.filter(
    event => event.ci_status === 'completed'
  ).length;
  const failedBuilds = completedMainBuilds.filter(
    event =>
      event.ci_conclusion === 'failure' || event.ci_conclusion === 'error'
  ).length;
  const successfulBuilds = completedMainBuilds.filter(
    event => event.ci_conclusion === 'success'
  ).length;
  const cancelledBuilds = completedMainBuilds.filter(
    event => event.ci_conclusion === 'cancelled'
  ).length;

  // Wall-to-wall time: sum of main build durations (actual time elapsed)
  // Only count completed main builds
  const wallToWallBuildTimeMs = completedMainBuilds.reduce(
    (sum, event) => sum + (event.duration_ms || 0),
    0
  );

  // Cumulative time: sum of all job durations (compute/cost time)
  // Only count completed jobs (ci_run, not ci_started)
  const completedJobs = jobBuilds.filter(event => event.type === 'ci_run');
  const cumulativeBuildTimeMs =
    completedJobs.length > 0
      ? completedJobs.reduce((sum, event) => sum + (event.duration_ms || 0), 0)
      : wallToWallBuildTimeMs;

  const buildStats = {
    total_builds: totalBuilds,
    completed_builds: completedBuilds,
    failed_builds: failedBuilds,
    successful_builds: successfulBuilds,
    cancelled_builds: cancelledBuilds,
    total_build_time_ms: wallToWallBuildTimeMs, // Keep as wall-to-wall for backwards compatibility
    wall_to_wall_build_time_ms: wallToWallBuildTimeMs,
    cumulative_build_time_ms: cumulativeBuildTimeMs,
  };

  // Calculate run time
  let runStartTime: string;
  if (linkedIssues && linkedIssues.length > 0) {
    const earliestIssueDate = linkedIssues
      .map(issue => new Date(issue.created_at))
      .sort((a, b) => a.getTime() - b.getTime())[0];
    runStartTime = earliestIssueDate.toISOString();
  } else {
    runStartTime = pr.created_at;
  }

  let runEndTime: string;
  if (linkedIssues && linkedIssues.length > 0) {
    const latestIssueClosed = linkedIssues
      .filter(issue => issue.closed_at)
      .map(issue => new Date(issue.closed_at!))
      .sort((a, b) => b.getTime() - a.getTime())[0];

    const prEndDate = pr.merged_at || pr.closed_at;
    const prEndTime = prEndDate ? new Date(prEndDate) : null;

    if (latestIssueClosed && prEndTime) {
      runEndTime =
        latestIssueClosed > prEndTime
          ? latestIssueClosed.toISOString()
          : prEndTime.toISOString();
    } else if (latestIssueClosed) {
      runEndTime = latestIssueClosed.toISOString();
    } else if (prEndTime) {
      runEndTime = prEndTime.toISOString();
    } else {
      runEndTime = new Date().toISOString();
    }
  } else {
    const prEndDate = pr.merged_at || pr.closed_at;
    runEndTime = prEndDate ? prEndDate : new Date().toISOString();
  }

  // Build temp PR stats for complexity calculation
  const tempPRStats = {
    additions: pr.additions || 0,
    deletions: pr.deletions || 0,
    changed_files: pr.changed_files || 0,
    commits: commitCount,
    reviews: {
      review_comments: reviewCommentsCount,
      requested_teams: pr.codeowners?.teams || [],
    },
    metrics: {
      turnaround_time_hours: pr.closed_at
        ? (new Date(pr.closed_at).getTime() -
            new Date(pr.created_at).getTime()) /
          (1000 * 60 * 60)
        : 0,
    },
  };

  const complexity = calculatePRComplexity(tempPRStats);

  // Calculate delivery friction
  const totalBuildMinutes =
    timeline
      .filter(event => event.type === 'ci_run')
      .reduce((sum, event) => sum + (event.duration_ms || 0), 0) /
    (1000 * 60);

  const totalWaitingMinutes =
    timeline
      .filter(event => event.type === 'awaiting_review')
      .reduce((sum, event) => sum + (event.duration_ms || 0), 0) /
    (1000 * 60);

  const deliveryFriction = calculateDeliveryFriction(
    tempPRStats,
    totalBuildMinutes,
    totalWaitingMinutes
  );

  return {
    backAndForthCount,
    commitCount,
    reviewCommentsCount,
    issueCommentsCount,
    totalTeamReviewTimeMs,
    buildStats,
    runStartTime,
    runEndTime,
    complexity,
    deliveryFriction,
  };
}
