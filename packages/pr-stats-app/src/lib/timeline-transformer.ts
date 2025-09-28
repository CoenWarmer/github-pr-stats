import {
  PullRequestStats,
  TimelineData,
  TimelineGroup,
  TimelineItem,
  TimelineEvent,
} from './types';

// Event type to group mapping for cleaner organization
const EVENT_GROUPS = {
  admin: ['opened', 'closed', 'merged', 'ready_for_review', 'draft'],
  dev: ['commit', 'commits_pushed', 'head_ref_force_pushed'],
  review: ['review', 'review_requested', 'review_dismissed'],
  discussion: ['comment', 'issue_comment'],
  ci: ['ci_', 'workflow', 'check_run', 'status'],
} as const;

// Event type to content mapping for better display
const EVENT_CONTENT: Record<string, { emoji: string; text: string }> = {
  opened: { emoji: '🚀', text: 'PR Created' },
  closed: { emoji: '❌', text: 'Closed' },
  merged: { emoji: '✅', text: 'Merged' },
  ready_for_review: { emoji: '👀', text: 'Ready for Review' },
  draft: { emoji: '📝', text: 'Draft' },
  commit: { emoji: '📝', text: 'Commit' },
  commits_pushed: { emoji: '📝', text: 'Commits' },
  commits_added: { emoji: '📝', text: 'Commits Added' },
  review: { emoji: '👀', text: 'Review' },
  comment: { emoji: '💬', text: 'Comment' },
  issue_comment: { emoji: '💬', text: 'Comment' },
};

/**
 * Determines which group an event belongs to based on its type
 */
function getEventGroup(eventType: string): string {
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
function createEventContent(event: TimelineEvent): string {
  const baseContent = EVENT_CONTENT[event.type];

  // Handle CI events first (before checking baseContent)
  if (
    (event.type.includes('ci_') || event.type === 'ci_run') &&
    event.workflow_name
  ) {
    return `${event.workflow_name}`;
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
function createEventTitle(event: TimelineEvent): string {
  const lines = [event.type, new Date(event.date).toLocaleString()];

  if (event.reviewer) lines.push(`Reviewer: ${event.reviewer}`);
  if (event.state) lines.push(`State: ${event.state}`);
  if (event.commit_count) lines.push(`Commits: ${event.commit_count}`);
  if (event.comment_author) lines.push(`Author: ${event.comment_author}`);
  if (event.workflow_name) lines.push(`Workflow: ${event.workflow_name}`);
  if (event.ci_conclusion || event.ci_status) {
    lines.push(`Status: ${event.ci_conclusion || event.ci_status}`);
  }
  if (event.build_url) {
    lines.push(`Build: ${event.build_url}`);
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

  return lines.join('\n');
}

/**
 * Creates CSS class names for styling timeline events
 */
function createEventClassName(event: TimelineEvent): string {
  const group = getEventGroup(event.type);
  const classes = [group];

  // Add specific styling classes
  if (event.type === 'merged') classes.push('merged');
  if (event.type === 'closed') classes.push('closed');
  if (event.state) classes.push(`review-${event.state.toLowerCase()}`);
  if (event.ci_conclusion) classes.push(`ci-${event.ci_conclusion}`);
  if (event.ci_status) classes.push(`ci-${event.ci_status}`);
  if (event.comment_url) classes.push('clickable');

  return classes.join(' ');
}

/**
 * Determines the color for timeline events based on type and status
 */
function createEventColor(event: TimelineEvent): string {
  // Handle CI events with specific colors
  if (event.type.includes('ci_') || event.type === 'ci_run') {
    const conclusion = event.ci_conclusion;
    let color = 'primary';

    if (event.type === 'ci_completed' || event.type === 'ci_run') {
      if (conclusion === 'success') color = 'success';
      else if (conclusion === 'failure' || conclusion === 'error')
        color = 'danger';
      else if (conclusion === 'skipped' || conclusion === 'cancelled')
        color = 'default';
      else if (conclusion === 'neutral') color = 'warning';
      else color = 'primary'; // Default for completed
    } else if (event.type === 'ci_started') {
      color = 'hollow';
    } else {
      // Handle other CI states
      if (conclusion === 'failure' || conclusion === 'error') color = 'danger';
      else if (conclusion === 'success') color = 'success';
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

  // Default color
  return 'primary';
}

/**
 * Creates awaiting review timeline items based on PR events
 */
function createAwaitingReviewItems(pr: PullRequestStats): TimelineItem[] {
  const awaitingItems: TimelineItem[] = [];

  // Sort timeline events by date
  const sortedEvents = [...pr.timeline].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  let reviewPeriodStart: Date | null = null;
  let reviewPeriodCount = 0;

  // Determine when PR becomes ready for review
  const readyForReviewDate = findReadyForReviewDate(pr, sortedEvents);
  if (readyForReviewDate) {
    reviewPeriodStart = readyForReviewDate;
  }

  // Process events to find review periods
  for (const event of sortedEvents) {
    const eventDate = new Date(event.date);

    // If we're in a review period and get a review from a code owner team member
    if (reviewPeriodStart && isCodeOwnerReview(event)) {
      // End the current review period
      const durationHours = Math.round(
        (eventDate.getTime() - reviewPeriodStart.getTime()) / (1000 * 60 * 60)
      );

      // Assign to the first team of the reviewer
      const targetTeam = event.reviewer_teams?.[0] || 'unknown'; // We know this exists because isCodeOwnerReview returned true

      // End the awaiting period 1 second before the review to ensure proper ordering
      const awaitingEndTime = new Date(eventDate.getTime() - 1000);

      awaitingItems.push({
        id: `awaiting_review_${reviewPeriodCount}`,
        group: `reviewer_${targetTeam}`,
        start: reviewPeriodStart.toISOString(),
        end: awaitingEndTime.toISOString(),
        content: `⏳ Awaiting Review`,
        title: `Awaiting Review\nDuration: ${durationHours}h\nTeam: ${targetTeam}\nReviewer: ${event.reviewer || 'Unknown'}`,
        color: 'warning',
      });

      reviewPeriodStart = null;
      reviewPeriodCount++;
    }

    // Start a new review period after commits are pushed (if not already in one)
    if (
      !reviewPeriodStart &&
      (event.type === 'commits_pushed' || event.type === 'commits_added')
    ) {
      reviewPeriodStart = eventDate;
    }

    // Start review period when PR becomes ready for review
    if (!reviewPeriodStart && event.type === 'ready_for_review') {
      reviewPeriodStart = eventDate;
    }
  }

  // If there's an ongoing review period at the end, close it with PR closure/merge
  // For ongoing periods, we'll assign to the first available code owner or create a general review row
  if (reviewPeriodStart) {
    const prEndDate = pr.closed_at || pr.merged_at;
    if (prEndDate) {
      const endDate = new Date(prEndDate);
      const durationHours = Math.round(
        (endDate.getTime() - reviewPeriodStart.getTime()) / (1000 * 60 * 60)
      );

      // Try to find the specific team that was requested for review during this period
      const reviewPeriodStartTime = reviewPeriodStart.getTime();
      const prEndTime = endDate.getTime();

      // Look for team review requests during this review period
      const teamRequestsInPeriod = pr.timeline
        .filter(event => event.type === 'team_review_requested')
        .filter(event => {
          const eventTime = new Date(event.date).getTime();
          return eventTime >= reviewPeriodStartTime && eventTime <= prEndTime;
        })
        .sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
        ); // Most recent first

      // Use the most recent team request in this period, or fall back to code owner teams
      const codeOwnerTeams = extractCodeOwners(pr);
      let targetTeam: string;

      if (
        teamRequestsInPeriod.length > 0 &&
        teamRequestsInPeriod[0].requested_team
      ) {
        targetTeam = teamRequestsInPeriod[0].requested_team;
      } else if (codeOwnerTeams.length > 0) {
        targetTeam = codeOwnerTeams[0];
      } else {
        targetTeam = 'discussion';
      }

      const targetGroup =
        targetTeam === 'discussion' ? 'discussion' : `reviewer_${targetTeam}`;

      awaitingItems.push({
        id: `awaiting_review_${reviewPeriodCount}`,
        group: targetGroup,
        start: reviewPeriodStart.toISOString(),
        end: prEndDate,
        content: `⏳ Awaiting Re-review`,
        title: `Awaiting Re-review (after changes)\nDuration: ${durationHours}h\nTeam: ${targetTeam}\nEnded: PR ${pr.merged_at ? 'merged' : 'closed'}`,
        color: 'warning',
      });
    }
  }

  return awaitingItems;
}

/**
 * Finds when the PR became ready for review
 */
function findReadyForReviewDate(
  pr: PullRequestStats,
  sortedEvents: TimelineEvent[]
): Date | null {
  // Look for explicit ready_for_review event
  const readyEvent = sortedEvents.find(
    event => event.type === 'ready_for_review'
  );
  if (readyEvent) {
    return new Date(readyEvent.date);
  }

  // If no explicit ready event, assume ready when created (if not draft)
  // or when first commits are pushed
  const firstCommitEvent = sortedEvents.find(
    event => event.type === 'commits_pushed' || event.type === 'commits_added'
  );

  if (firstCommitEvent) {
    return new Date(firstCommitEvent.date);
  }

  // Fallback to PR creation date
  return new Date(pr.created_at);
}

/**
 * Checks if an event is a review from a code owner team member
 */
function isCodeOwnerReview(event: TimelineEvent): boolean {
  if (event.type !== 'review') {
    return false;
  }

  // Only reviewers who are part of code owner teams can end awaiting review periods
  if (event.reviewer_teams && event.reviewer_teams.length > 0) {
    return true;
  }

  return false;
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
  event: TimelineEvent
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

  // Use the original group logic for non-review events
  return getEventGroup(eventType);
}

/**
 * Transforms PR timeline events into dnd-timeline format
 */
export function transformToTimelineData(pr: PullRequestStats): TimelineData {
  // Use requested teams as the primary source of code owner teams
  const requestedTeams = pr.requested_teams || [];

  // Also extract teams from actual reviews (in case there are teams not in requested_teams)
  const reviewerTeams = extractCodeOwners(pr);

  // Extract teams from team review request events in timeline
  const timelineRequestedTeams = pr.timeline
    .filter(event => event.type === 'team_review_requested')
    .map(event => event.requested_team)
    .filter((team): team is string => Boolean(team));

  // Combine all sources and deduplicate
  const allCodeOwnerTeams = [
    ...new Set([
      ...requestedTeams,
      ...reviewerTeams,
      ...timelineRequestedTeams,
    ]),
  ].sort();

  const codeOwners = allCodeOwnerTeams;
  const hasAdditionalReviewersFlag = hasAdditionalReviewers(pr);

  // Create timeline groups (rows) - with dynamic code owner team rows
  const groups: TimelineGroup[] = [
    { id: 'admin', content: '📋 Administrative', order: 1 },
    { id: 'dev', content: '👨‍💻 Development', order: 2 },
    { id: 'ci', content: '🔧 CI/CD', order: 3 },
    // Add code owner team rows
    ...codeOwners.map((teamName, index) => ({
      id: `reviewer_${teamName}`,
      content: `👥 ${teamName}`,
      order: 4 + index,
    })),
    // Add additional reviewers row if there are any
    ...(hasAdditionalReviewersFlag
      ? [
          {
            id: 'additional_reviewers',
            content: '👤 Additional reviewers',
            order: 4 + codeOwners.length,
          },
        ]
      : []),
    {
      id: 'discussion',
      content: '💬 Discussion',
      order: 4 + codeOwners.length + (hasAdditionalReviewersFlag ? 1 : 0),
    },
  ];

  // Transform timeline events to timeline items
  const items: TimelineItem[] = pr.timeline
    .map((event, index) => {
      return {
        id: `event_${index}`,
        group: getEventGroupForCodeOwners(event.type, event),
        start: event.date,
        end: event.end_date,
        content: createEventContent(event),
        title: createEventTitle(event),
        className: createEventClassName(event),
        githubUrl: event.comment_url || event.build_url,
        color: createEventColor(event),
        isPointInTime: !event.end_date, // Track if this was originally a point-in-time event
      };
    })
    .filter(
      item =>
        item.start !== null &&
        item.start !== undefined &&
        !isNaN(new Date(item.start).getTime())
    )
    .filter(item => !item.content.includes('PR Created')); // Remove PR Created events

  // Add awaiting review periods
  const awaitingReviewItems = createAwaitingReviewItems(pr);
  items.push(...awaitingReviewItems);

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
      group: 'admin',
      start: pr.created_at,
      end: prEnd,
      content: `📋 PR #${pr.id}: ${pr.title}`,
      title: `PR Lifecycle\n${pr.title}\nDuration: ${durationHours}h`,
      className: pr.merged_at ? 'merged' : 'closed',
    });
  }

  return { groups, items };
}
