import { TimelineEvent, LinkedIssue, PullRequestStats } from '../types';
import { calculatePRComplexity, calculateDeliveryFriction } from '../utils';

export interface PRMetrics {
  backAndForthCount: number;
  commitCount: number;
  reviewCommentsCount: number;
  issueCommentsCount: number;
  totalTeamReviewTimeMs: number;
  buildStats: {
    total_builds: number;
    completed_builds: number;
    failed_builds: number;
    successful_builds: number;
    total_build_time_ms: number;
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

  // Calculate total team review time
  let totalTeamReviewTimeMs = 0;
  for (const event of timeline) {
    if (
      event.type === 'team_review_requested' &&
      'requested_team' in event &&
      typeof event.requested_team === 'string'
    ) {
      const requestTime = new Date(event.date).getTime();
      const teamName = event.requested_team;
      const firstApproval = timeline.find(
        e =>
          e.type === 'review' &&
          e.date > event.date &&
          'state' in e &&
          e.state?.toLowerCase() === 'approved' &&
          'reviewer_teams' in e &&
          Array.isArray(e.reviewer_teams) &&
          e.reviewer_teams.includes(teamName)
      );

      if (firstApproval) {
        const durationMs = new Date(firstApproval.date).getTime() - requestTime;
        totalTeamReviewTimeMs += durationMs;
      }
    }
  }

  // Calculate build statistics
  const allCiBuilds = timeline.filter(event => event.type === 'ci_run');
  const totalBuilds = allCiBuilds.length;
  const completedBuilds = allCiBuilds.filter(
    event => event.ci_status === 'completed'
  ).length;
  const failedBuilds = allCiBuilds.filter(
    event =>
      event.ci_conclusion === 'failure' || event.ci_conclusion === 'error'
  ).length;
  const successfulBuilds = allCiBuilds.filter(
    event => event.ci_conclusion === 'success'
  ).length;
  const totalBuildTimeMs = allCiBuilds.reduce(
    (sum, event) => sum + (event.duration_ms || 0),
    0
  );

  const buildStats = {
    total_builds: totalBuilds,
    completed_builds: completedBuilds,
    failed_builds: failedBuilds,
    successful_builds: successfulBuilds,
    total_build_time_ms: totalBuildTimeMs,
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
