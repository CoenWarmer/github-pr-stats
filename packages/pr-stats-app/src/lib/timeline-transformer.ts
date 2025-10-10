import {
  PullRequestStats,
  TimelineData,
  TimelineGroup,
  TimelineItem,
  AnyTimelineEvent,
} from './types';

// Event type to group mapping for cleaner organization
// Note: Order matters! More specific patterns should come before general ones
const EVENT_GROUPS = {
  admin: ['closed', 'merged', 'ready_for_review', 'draft', 'issue_'],
  dev: ['opened', 'commit', 'commits_pushed', 'head_ref_force_pushed'],
  discussion: ['comment_added', 'review_comment_added', 'issue_comment'], // Check before review to catch review_comment_added
  review: ['review_requested', 'review_dismissed', 'awaiting_review', 'review'], // 'review' last to avoid false matches
  ci: ['ci_', 'workflow', 'check_run', 'status'],
  released: ['released', 'time_to_release'],
} as const;

// Event type to content mapping for better display
const EVENT_CONTENT: Record<string, { emoji: string; text: string }> = {
  opened: { emoji: '🚀', text: 'PR Created' },
  closed: { emoji: '❌', text: 'Closed' },
  merged: { emoji: '✅', text: 'Merged' },
  ready_for_review: { emoji: '📋', text: 'Ready for Review' },
  draft: { emoji: '📝', text: 'Draft' },
  commit: { emoji: '📝', text: 'Commit' },
  commits_pushed: { emoji: '📝', text: 'Commits' },
  commits_added: { emoji: '➕', text: 'Commits Added' },
  review: { emoji: '🧑‍⚖️', text: 'Review' },
  comment_added: { emoji: '💬', text: 'Comment' },
  review_comment_added: { emoji: '💬', text: 'Review Comment' },
  issue_comment: { emoji: '💬', text: 'Comment' },
  awaiting_review: { emoji: '⏳', text: 'Awaiting Review' },
  team_review_requested: { emoji: '🙋', text: 'Team Review Requested' },
  issue_created: { emoji: '🎫', text: 'Issue Created' },
  issue_assigned: { emoji: '👷', text: 'Issue Assigned' },
  issue_unassigned: { emoji: '🫥', text: 'Issue Unassigned' },
  issue_closed: { emoji: '✅', text: 'Issue Closed' },
  issue_in_progress: { emoji: '🔄', text: 'Issue In Progress' },
  issue_iteration: { emoji: '📅', text: 'Iteration' },
  released: { emoji: '🚀', text: 'Released' },
  time_to_release: { emoji: '⏱️', text: 'Time to Release' },
};

/**
 * Determines which group an event belongs to based on its type
 */
function getEventGroup(eventType: string, event?: AnyTimelineEvent): string {
  // All CI events (both main builds and jobs) go to 'ci' group
  if (
    event &&
    (eventType.includes('ci_') || eventType === 'ci_run') &&
    event.workflow_name
  ) {
    return 'ci';
  }

  for (const [group, patterns] of Object.entries(EVENT_GROUPS)) {
    if (patterns.some(pattern => eventType.includes(pattern))) {
      return group;
    }
  }
  return 'dev'; // Default fallback
}

/**
 * Determines the color for timeline events based on type and status
 */
function createEventColor(event: AnyTimelineEvent): string {
  // Handle CI events with specific colors
  if (event.type.includes('ci_') || event.type === 'ci_run') {
    const conclusion = event.ci_conclusion;
    let color = 'primary';

    if (event.type === 'ci_completed' || event.type === 'ci_run') {
      if (conclusion === 'success') color = 'success';
      else if (conclusion === 'failure' || conclusion === 'error')
        color = 'danger';
      else if (conclusion === 'cancelled')
        color = 'warning'; // Yellow for cancelled
      else if (conclusion === 'skipped') color = 'default';
      else if (conclusion === 'neutral') color = 'warning';
      else color = 'primary'; // Default for completed
    } else if (event.type === 'ci_started') {
      color = 'hollow';
    } else {
      // Handle other CI states
      if (conclusion === 'failure' || conclusion === 'error') color = 'danger';
      else if (conclusion === 'success') color = 'success';
      else if (conclusion === 'cancelled') color = 'warning'; // Yellow for cancelled
    }

    return color;
  }

  // Handle review events
  if (event.type.includes('review')) {
    if (event.state === 'approved') return 'success';
    if (event.state === 'changes_requested') return 'danger';
    return 'warning'; // For commented reviews
  }

  // Handle admin events
  if (event.type === 'merged') return 'success';
  if (event.type === 'closed') return 'danger';

  // Handle release events
  if (event.type === 'released') return 'accent';

  // Handle iteration events
  if (event.type === 'issue_iteration') return 'primary';

  // Default color
  return 'primary';
}

/**
 * Checks if there are any additional reviewers (not part of code owner teams)
 */
function hasAdditionalReviewers(pr: PullRequestStats): boolean {
  // Check if there are any reviewers with the 'additional_reviewers' team
  return pr.timeline.some(
    event =>
      event.type === 'review' &&
      event.reviewer &&
      event.reviewer_teams &&
      event.reviewer_teams.includes('additional_reviewers')
  );
}

/**
 * Gets the appropriate group/row for an event, considering code owners
 */
function getEventGroupForCodeOwners(
  eventType: string,
  event: AnyTimelineEvent
): string {
  // Handle review events
  if (eventType === 'review' && event.reviewer) {
    // If reviewer is part of code owner teams, route to specific team row
    if (event.reviewer_teams && event.reviewer_teams.length > 0) {
      const team = event.reviewer_teams[0];
      // Special case: 'additional_reviewers' doesn't get the 'reviewer_' prefix
      if (team === 'additional_reviewers') {
        return 'additional_reviewers';
      }
      // Use the first team (or we could implement more sophisticated logic)
      return `reviewer_${team}`;
    }
    // If reviewer is not part of any code owner teams, route to additional reviewers
    else {
      return 'additional_reviewers';
    }
  }

  // Handle awaiting review events - assign to the team that needs to review
  if (eventType === 'awaiting_review') {
    if (event.reviewer_teams && event.reviewer_teams.length > 0) {
      const team = event.reviewer_teams[0];
      // Special case: 'additional_reviewers' doesn't get the 'reviewer_' prefix
      if (team === 'additional_reviewers') {
        return 'additional_reviewers';
      }
      // Use the first team that needs to review
      return `reviewer_${team}`;
    }
    // If no specific team, route to additional reviewers
    else {
      return 'additional_reviewers';
    }
  }

  // Handle team review requested events - assign to the specific team
  if (eventType === 'team_review_requested' && event.requested_team) {
    return `reviewer_${event.requested_team}`;
  }

  // Use the original group logic for non-review events
  return getEventGroup(eventType, event);
}

/**
 * Transforms PR timeline events into dnd-timeline format
 */
export function transformToTimelineData(pr: PullRequestStats): TimelineData {
  // Use pr.codeowners as the primary source of code owner teams
  const codeOwnerTeams = pr.codeowners?.teams || [];

  // Extract teams from team review request events in timeline
  const timelineRequestedTeams = pr.timeline
    .filter(event => event.type === 'team_review_requested')
    .map(event => event.requested_team)
    .filter((team): team is string => Boolean(team));

  // Combine all sources and deduplicate
  const allCodeOwnerTeams = [
    ...new Set([...codeOwnerTeams, ...timelineRequestedTeams]),
  ].sort();

  const codeOwners = allCodeOwnerTeams;
  const hasAdditionalReviewersFlag = hasAdditionalReviewers(pr);

  // Create timeline groups (rows) - with dynamic code owner team rows
  const groups: TimelineGroup[] = [
    { id: 'admin', content: '📋 Administrative', order: 1 },
    { id: 'dev', content: '👨‍💻 Development', order: 2 },
    // Add code owner team rows
    ...codeOwners.map((teamName, index) => ({
      id: `reviewer_${teamName}`,
      content: `👥 ${teamName}`,
      order: 3 + index,
    })),
    // Add additional reviewers row if there are any
    ...(hasAdditionalReviewersFlag || codeOwners.length === 0
      ? [
          {
            id: 'additional_reviewers',
            content: '👤 Additional reviewers',
            order: 3 + codeOwners.length,
          },
        ]
      : []),
    {
      id: 'discussion',
      content: '💬 Discussion',
      order: 4 + codeOwners.length + (hasAdditionalReviewersFlag ? 1 : 0),
    },
    { id: 'ci', content: '🔧 CI/CD', order: 5 },
    { id: 'released', content: '🚀 Released', order: 6 },
    {
      id: 'released_serverless',
      content: '🚀 Released (Serverless)',
      order: 7,
    },
  ];

  // Transform timeline events to timeline items
  const items: TimelineItem[] = pr.timeline
    .filter(event => !event.hidden_from_timeline) // Filter out hidden events
    .map((event, index) => {
      const base = {
        id: `event_${index}`,
        eventType: event.type, // Store the original event type
        start: event.date,
        end: event.end_date,
        group: getEventGroupForCodeOwners(event.type, event),
        content: '', // createEventContent(event),
        emoji: EVENT_CONTENT[event.type]?.emoji,
        title: event.title,
        url: event.url,
        color: createEventColor(event),
        isPointInTime: !event.end_date, // Track if this was originally a point-in-time event
        popoverContent: event.popoverContent,
      };

      if (
        event.type === 'comment_added' ||
        event.type === 'review_comment_added' ||
        event.type === 'issue_comment'
      ) {
        return {
          ...base,
          commentContent: event.comment_content,
          commentAuthor: event.comment_author,
        };
      }

      if (event.type === 'review') {
        return {
          ...base,
          reviewBody: event.review_body,
        };
      }

      // Pass commit data for commit events
      if (
        (event.type === 'commits_added' || event.type === 'commits_pushed') &&
        'commits' in event &&
        event.commits
      ) {
        return {
          ...base,
          commits: event.commits,
        };
      }

      // Pass CI/CD fields for CI events
      if (
        event.type === 'ci_run' ||
        event.type === 'ci_started' ||
        event.type === 'ci_completed'
      ) {
        return {
          ...base,
          ci_conclusion: event.ci_conclusion,
          ci_status: event.ci_status,
          buildkite_build_id: event.buildkite_build_id,
          buildkite_build_number: event.buildkite_build_number,
          buildkite_pipeline_slug: event.buildkite_pipeline_slug,
          workflow_name: event.workflow_name,
          ci_failure_reason: event.ci_failure_reason,
        };
      }

      return base;
    })
    .filter(
      item =>
        item.start !== null &&
        item.start !== undefined &&
        !isNaN(new Date(item.start).getTime())
    );

  // Awaiting review periods are now created in the backend (GitHubCollector)

  // Create team review duration items (from team review requested to first approval)
  const teamReviewDurations: TimelineItem[] = [];

  // Find all team review requested events
  const teamReviewRequests = pr.timeline.filter(
    event => event.type === 'team_review_requested'
  );

  for (const requestEvent of teamReviewRequests) {
    const teamName = requestEvent.requested_team;
    if (!teamName) continue;

    // Find the first approval from this team
    const firstApproval = pr.timeline.find(
      event =>
        event.type === 'review' &&
        event.state?.toLowerCase() === 'approved' &&
        event.reviewer_teams?.includes(teamName) &&
        new Date(event.date).getTime() > new Date(requestEvent.date).getTime()
    );

    if (firstApproval) {
      const durationMs =
        new Date(firstApproval.date).getTime() -
        new Date(requestEvent.date).getTime();
      const durationHours = durationMs / (1000 * 60 * 60);

      teamReviewDurations.push({
        id: `team_review_duration_${teamName}_${requestEvent.date}`,
        group: `reviewer_${teamName}`,
        start: requestEvent.date,
        end: firstApproval.date,
        content: `${durationHours.toFixed(1)}h`,
        emoji: '',
        title: `${durationHours.toFixed(1)}h`,
        className: 'team-review-duration',
        color: 'hollow', // Use a subtle color
        isPointInTime: false,
        eventType: 'team_review_requested', // Synthetic event based on team_review_requested
        popoverContent: `
          <strong>Team Review Duration</strong><br/>
          <strong>Team:</strong> ${teamName}<br/>
          <strong>Requested:</strong> ${new Date(requestEvent.date).toLocaleString()}<br/>
          <strong>Approved:</strong> ${new Date(firstApproval.date).toLocaleString()}<br/>
          <strong>Duration:</strong> ${durationHours.toFixed(1)}h
        `,
      });
    }
  }

  // Add team review durations to items
  items.push(...teamReviewDurations);

  // Sort all items chronologically by start time
  // For items with the same start time, prioritize awaiting review items first
  items.sort((a, b) => {
    const aTime = new Date(a.start).getTime();
    const bTime = new Date(b.start).getTime();

    if (aTime === bTime) {
      // If times are equal, prioritize awaiting review items to appear first
      const aIsAwaiting = a.content.includes('Awaiting Review');
      const bIsAwaiting = b.content.includes('Awaiting Review');

      if (aIsAwaiting && !bIsAwaiting) return -1;
      if (!aIsAwaiting && bIsAwaiting) return 1;
    }

    return aTime - bTime;
  });

  // Add PR lifecycle item if we have end date
  const prEnd = pr.closed_at || pr.merged_at;
  if (prEnd) {
    const prStart = new Date(pr.created_at);
    const prEndDate = new Date(prEnd);
    const durationHours = Math.round(
      (prEndDate.getTime() - prStart.getTime()) / (1000 * 60 * 60)
    );

    items.push({
      id: 'pr_lifecycle',
      group: 'dev',
      start: pr.created_at,
      end: prEnd,
      emoji: '📋',
      content: `${durationHours}h`,
      title: `${durationHours}h`,
      className: pr.merged_at ? 'merged' : 'closed',
      url: pr.timeline.find(event => event.type === 'opened')?.url,
      popoverContent: `
        <strong>📋 PR #${pr.id}: ${pr.title}</strong><br/>
        <strong>Created:</strong> ${new Date(pr.created_at).toLocaleString()}<br/>
        <strong>${pr.merged_at ? 'Merged' : 'Closed'}:</strong> ${new Date(prEnd).toLocaleString()}<br/>
        <strong>Duration:</strong> ${durationHours}h (${Math.round(durationHours / 24)}d)
      `,
    });
  }

  // Add PR merged point-in-time event if PR was merged
  if (pr.merged_at) {
    items.push({
      id: 'pr_merged',
      group: 'dev',
      start: pr.merged_at,
      emoji: '✅',
      content: `✅ PR Merged`,
      title: `PR #${pr.id} Merged\n${new Date(pr.merged_at).toLocaleString()}`,
      className: 'merged',
      isPointInTime: true,
      url: pr.timeline.find(event => event.type === 'merged')?.url,
      popoverContent: `
        <strong>✅ PR #${pr.id} Merged</strong><br/>
        ${new Date(pr.merged_at).toLocaleString()}
      `,
    });
  }

  // Add issue lifecycle items for linked issues (from creation to closure)
  if (pr.linked_issues && pr.linked_issues.length > 0) {
    for (const issue of pr.linked_issues) {
      // Only add lifecycle if the issue has been closed
      if (issue.closed_at && issue.created_at) {
        const issueStart = new Date(issue.created_at);
        const issueEnd = new Date(issue.closed_at);
        const durationHours = Math.round(
          (issueEnd.getTime() - issueStart.getTime()) / (1000 * 60 * 60)
        );
        const durationDays = Math.round(durationHours / 24);

        items.push({
          id: `issue_lifecycle_${issue.number}`,
          group: 'admin',
          start: issue.created_at,
          end: issue.closed_at,
          emoji: '🎫',
          content: `🎫 Issue #${issue.number}: ${issue.title}`,
          title: `${durationDays}d (${durationHours}h)`,
          className: 'closed',
          url: issue.url,
          popoverContent: `
            <strong>🎫 Issue #${issue.number}: ${issue.title}</strong><br/>
            <strong>Created:</strong> ${issueStart.toLocaleString()}<br/>
            <strong>Closed:</strong> ${issueEnd.toLocaleString()}<br/>
            <strong>Duration:</strong> ${durationDays}d (${durationHours}h)
          `,
        });
      }
    }
  }

  return { groups, items };
}
