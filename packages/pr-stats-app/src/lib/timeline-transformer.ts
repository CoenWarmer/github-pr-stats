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
  ci_jobs: [], // CI jobs will be identified by workflow_name pattern
  released: ['released'],
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
};

/**
 * Determines which group an event belongs to based on its type
 */
function getEventGroup(eventType: string, event?: AnyTimelineEvent): string {
  // Check if this is a CI job (has workflow_name with a hyphen separator after the pipeline name)
  if (
    event &&
    (eventType.includes('ci_') || eventType === 'ci_run') &&
    event.workflow_name
  ) {
    // CI jobs have format "pipeline - job name" (e.g., "kibana / pull request - Pre-Build")
    if (event.workflow_name.includes(' - ')) {
      return 'ci_jobs';
    }
  }

  for (const [group, patterns] of Object.entries(EVENT_GROUPS)) {
    if (patterns.some(pattern => eventType.includes(pattern))) {
      return group;
    }
  }
  return 'dev'; // Default fallback
}

/**
 * Creates display content for a timeline event
 */
function createEventContent(event: AnyTimelineEvent): string {
  const baseContent = EVENT_CONTENT[event.type];

  // Handle CI events first (before checking baseContent)
  if (
    (event.type.includes('ci_') || event.type === 'ci_run') &&
    event.workflow_name
  ) {
    // Add emoji based on CI conclusion
    let emoji = '';
    if (event.ci_conclusion === 'success') {
      emoji = '✅ ';
    } else if (event.ci_conclusion === 'failure') {
      emoji = '❌ ';
    } else if (event.ci_conclusion === 'cancelled') {
      emoji = '🟡 ';
    }
    return `${emoji}${event.workflow_name}`;
  }

  // Handle awaiting review events with team information
  if (event.type === 'awaiting_review') {
    const teamName = event.reviewer_teams?.[0];
    if (teamName) {
      return event.workflow_name?.includes('Re-review')
        ? `⏳ Awaiting Re-review`
        : `⏳ Awaiting Review`;
    }
    return `⏳ Awaiting Review`;
  }

  // Handle iteration events with iteration title (check BEFORE generic issue_ handler)
  if (event.type === 'issue_iteration' && event.workflow_name) {
    // workflow_name contains the iteration title
    return `📅 ${event.workflow_name}`;
  }

  // Handle issue events with specific information
  if (event.type.startsWith('issue_')) {
    const baseContent = EVENT_CONTENT[event.type];
    if (baseContent) {
      if (event.issue_title && event.issue_number) {
        return `${baseContent.emoji} ${baseContent.text}: #${event.issue_number} ${event.issue_title}`;
      } else if (event.issue_number) {
        return `${baseContent.emoji} ${baseContent.text}: #${event.issue_number}`;
      }
      return `${baseContent.emoji} ${baseContent.text}`;
    }
  }

  // Handle release events with tag name
  if (event.type === 'released' && event.release_tag) {
    return `🚀 ${event.release_tag}`;
  }

  if (baseContent) {
    // Handle specific event types with custom formatting
    if (event.type === 'commits_pushed' && event.commit_count) {
      return `${baseContent.emoji} ${event.commit_count} commit${event.commit_count > 1 ? 's' : ''}`;
    }

    if (
      event.type === 'commits_added' &&
      event.commits &&
      event.commits.length > 0
    ) {
      // Show the first commit's SHA (shortened to 7 characters)
      const firstCommit = event.commits[0];
      const shortSha = firstCommit.sha.substring(0, 7);
      return `${baseContent.emoji} ${shortSha} added`;
    }

    if (event.type === 'review' && event.reviewer && event.state) {
      return `${baseContent.emoji} ${event.reviewer} - ${event.state}`;
    }

    if (event.type.includes('comment') && event.comment_author) {
      return `${baseContent.emoji} ${event.comment_author}`;
    }

    return `${baseContent.emoji} ${baseContent.text}`;
  }

  // Fallback for unknown event types
  return event.type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

/**
 * Creates a detailed title/tooltip for a timeline event
 */
function createEventTitle(event: AnyTimelineEvent): string {
  const lines = [event.type, new Date(event.date).toLocaleString()];

  if (event.reviewer) lines.push(`Reviewer: ${event.reviewer}`);
  if (event.state) lines.push(`State: ${event.state}`);
  if (event.commit_count) lines.push(`Commits: ${event.commit_count}`);
  if (event.comment_author) lines.push(`Author: ${event.comment_author}`);
  if (event.workflow_name) lines.push(`Workflow: ${event.workflow_name}`);
  if (event.ci_conclusion || event.ci_status) {
    lines.push(`Status: ${event.ci_conclusion || event.ci_status}`);
  }
  if (event.url && (event.type.includes('ci_') || event.type === 'ci_run')) {
    lines.push(`Build: ${event.url}`);
  }
  if (event.time_to_review_hours) {
    lines.push(`Review time: ${event.time_to_review_hours.toFixed(1)}h`);
  }
  if (event.comment_content) {
    const preview = event.comment_content.substring(0, 100);
    lines.push(
      `Content: ${preview}${event.comment_content.length > 100 ? '...' : ''}`
    );
  }
  if (event.release_tag) {
    lines.push(`Release: ${event.release_tag}`);
  }
  if (event.url && event.type === 'released') {
    lines.push(`URL: ${event.url}`);
  }
  if (event.type === 'issue_iteration') {
    if (event.workflow_name) lines.push(`Iteration: ${event.workflow_name}`);
    if (event.comment_content) lines.push(`Project: ${event.comment_content}`);
    if (event.issue_number) lines.push(`Issue: #${event.issue_number}`);
  }

  return lines.join('\n');
}

/**
 * Creates CSS class names for styling timeline events
 */
function createEventClassName(event: AnyTimelineEvent): string {
  const group = getEventGroup(event.type);
  const classes = [group];

  // Add specific styling classes
  // Generic type tags to help downstream renderers (e.g., D3) with coloring
  if (event.type.includes('review')) classes.push('review');
  if (event.type.includes('commit')) classes.push('commit');
  if (event.type.includes('comment')) classes.push('comment');
  if (event.type.startsWith('issue_')) classes.push('discussion');
  if (event.type.includes('ci_') || event.type === 'ci_run') classes.push('ci');
  if (event.type === 'merged') classes.push('merged');
  if (event.type === 'closed') classes.push('closed');
  if (event.state) classes.push(`review-${event.state.toLowerCase()}`);
  if (event.ci_conclusion) classes.push(`ci-${event.ci_conclusion}`);
  if (event.ci_status) classes.push(`ci-${event.ci_status}`);
  if (event.url) classes.push('clickable');
  if (event.type === 'released') classes.push('released');
  if (event.type === 'issue_iteration') classes.push('iteration');

  return classes.join(' ');
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
 * Extracts all code owner teams from the PR timeline
 */
function extractCodeOwners(pr: PullRequestStats): string[] {
  const codeOwnerTeams = new Set<string>();

  // Extract teams from review events
  pr.timeline.forEach(event => {
    if (event.type === 'review') {
      if (event.reviewer_teams && event.reviewer_teams.length > 0) {
        // Add all teams for this reviewer
        event.reviewer_teams.forEach(team => {
          codeOwnerTeams.add(team);
        });
      }
    }
  });

  const result = Array.from(codeOwnerTeams).sort();

  // Only return actual teams - no fallback to individual reviewers
  return result;
}

/**
 * Checks if there are any additional reviewers (not part of code owner teams)
 */
function hasAdditionalReviewers(pr: PullRequestStats): boolean {
  // Check if there are any reviewers who are not part of code owner teams
  return pr.timeline.some(
    event =>
      event.type === 'review' &&
      event.reviewer &&
      (!event.reviewer_teams || event.reviewer_teams.length === 0)
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
      // Use the first team (or we could implement more sophisticated logic)
      return `reviewer_${event.reviewer_teams[0]}`;
    }
    // If reviewer is not part of any code owner teams, route to additional reviewers
    else {
      return 'additional_reviewers';
    }
  }

  // Handle awaiting review events - assign to the team that needs to review
  if (eventType === 'awaiting_review') {
    if (event.reviewer_teams && event.reviewer_teams.length > 0) {
      // Use the first team that needs to review
      return `reviewer_${event.reviewer_teams[0]}`;
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

  // Also extract teams from actual reviews (in case there are teams not in codeowners)
  const reviewerTeams = extractCodeOwners(pr);

  // Extract teams from requested_teams
  const requestedTeams = pr.reviews.requested_teams || [];

  // Extract teams from team review request events in timeline
  const timelineRequestedTeams = pr.timeline
    .filter(event => event.type === 'team_review_requested')
    .map(event => event.requested_team)
    .filter((team): team is string => Boolean(team));

  // Combine all sources and deduplicate
  const allCodeOwnerTeams = [
    ...new Set([
      ...codeOwnerTeams,
      ...reviewerTeams,
      ...requestedTeams,
      ...timelineRequestedTeams,
    ]),
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
    ...(hasAdditionalReviewersFlag
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
    { id: 'ci_jobs', content: '⚙️ CI Jobs', order: 6, collapsed: true },
    { id: 'released', content: '🚀 Released', order: 7 },
  ];

  // Transform timeline events to timeline items
  const items: TimelineItem[] = pr.timeline
    .filter(event => !event.hidden_from_timeline) // Filter out hidden events
    .map((event, index) => {
      const base = {
        id: `event_${index}`,
        group: getEventGroupForCodeOwners(event.type, event),
        start: event.date,
        end: event.end_date,
        content: createEventContent(event),
        emoji: EVENT_CONTENT[event.type]?.emoji,
        title: createEventTitle(event),
        className: createEventClassName(event),
        url: event.url,
        color: createEventColor(event),
        isPointInTime: !event.end_date, // Track if this was originally a point-in-time event
        eventType: event.type, // Store the original event type
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
        title: `Team Review Duration\nTeam: ${teamName}\nRequested: ${new Date(requestEvent.date).toLocaleString()}\nApproved: ${new Date(firstApproval.date).toLocaleString()}\nDuration: ${durationHours.toFixed(1)}h`,
        className: 'team-review-duration',
        color: 'hollow', // Use a subtle color
        isPointInTime: false,
        eventType: 'team_review_requested', // Synthetic event based on team_review_requested
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
      content: `📋 PR #${pr.id}: ${pr.title}`,
      title: `PR Lifecycle\n${pr.title}\nDuration: ${durationHours}h`,
      className: pr.merged_at ? 'merged' : 'closed',
      url: pr.timeline.find(event => event.type === 'opened')?.url,
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
          title: `Issue Lifecycle\n#${issue.number}: ${issue.title}\nDuration: ${durationDays}d (${durationHours}h)`,
          className: 'closed',
          url: issue.url,
        });
      }
    }
  }

  return { groups, items };
}
