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
      return `${baseContent.emoji} \`${shortSha}\` added`;
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
 * Transforms PR timeline events into dnd-timeline format
 */
export function transformToTimelineData(pr: PullRequestStats): TimelineData {
  // Create timeline groups (rows) - simplified and dynamic
  const groups: TimelineGroup[] = [
    { id: 'admin', content: '📋 Administrative', order: 1 },
    { id: 'dev', content: '👨‍💻 Development', order: 2 },
    { id: 'ci', content: '🔧 CI/CD', order: 3 },
    { id: 'review', content: '👀 Reviews', order: 4 },
    { id: 'discussion', content: '💬 Discussion', order: 5 },
  ];

  // Transform timeline events to timeline items
  const items: TimelineItem[] = pr.timeline
    .map((event, index) => {
      return {
        id: `event_${index}`,
        group: getEventGroup(event.type),
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
