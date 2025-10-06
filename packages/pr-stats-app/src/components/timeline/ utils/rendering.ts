import * as d3 from 'd3';
import { euiPaletteColorBlindBehindText } from '@elastic/eui';
import { ProcessedTimelineItem } from '../types';
import { formatDuration } from '@/lib/utils';

/**
 * Get color for a timeline event based on its type
 * Directly maps event types to colors from the palette
 */
export function getEventColor(d: ProcessedTimelineItem): string {
  const palette = euiPaletteColorBlindBehindText({ sortBy: 'natural' });
  const eventType = d.eventType;

  if (!eventType) return palette[6]; // Red #F6726A

  switch (eventType) {
    // Commit events
    case 'commit':
    case 'commits_added':
    case 'commits_pushed':
    case 'head_ref_force_pushed':
      return palette[0]; // Teal #A6EDEA

    // Review events
    case 'review':
    case 'review_requested':
    case 'review_dismissed':
    case 'awaiting_review':
    case 'team_review_requested':
      return palette[1]; // Cyan #16C5C0

    // Comment events
    case 'comment_added':
    case 'review_comment_added':
      return palette[2]; // Light Blue #BFDBFF

    // CI events (with success/failure/warning overrides for ci_run)
    case 'ci_started':
    case 'ci_completed':
      return palette[3]; // Blue #61A2FF

    case 'ci_run':
      // Use success/failure colors if available
      if (d.color === 'success') return '#00BFB3'; // EUI success green
      if (d.color === 'danger') return '#BD271E'; // EUI danger red
      if (d.color === 'warning') return '#F5A700'; // EUI warning yellow/orange
      return palette[3]; // Blue #61A2FF (default)

    // Discussion events
    case 'issue_comment':
      return palette[4]; // Pink #EE72A6

    // Release events
    case 'released':
      return palette[5]; // Light Pink #FFC7DB

    // Issue/Iteration events
    case 'issue_created':
    case 'issue_assigned':
    case 'issue_unassigned':
    case 'issue_closed':
    case 'issue_in_progress':
    case 'issue_iteration':
      return palette[7]; // Light Coral #FFC9C2

    // PR lifecycle events (fallback)
    case 'opened':
    case 'closed':
    case 'merged':
    case 'ready_for_review':
    case 'draft':
    case 'opened_draft':
    default:
      return palette[6]; // Red #F6726A
  }
}

/**
 * Determine if an item should be highlighted based on active group filter
 */
export function isItemHighlighted(
  d: ProcessedTimelineItem,
  activeGroups: string[] | null
): boolean {
  // If no active groups filter is set (null), highlight everything
  if (activeGroups === null) return true;

  // If activeGroups is an array (even empty), only highlight items in those groups
  return activeGroups.includes(d.group);
}

/**
 * Get the emoji for a timeline item
 */
export function getEmojiForItem(d: ProcessedTimelineItem): string {
  return d.emoji;
}

/**
 * Get text to display for a rectangle item
 */
export function getDisplayText(d: ProcessedTimelineItem): string {
  // Use content first (clean text), then title as fallback
  let displayText = d.content;
  if (!displayText && d.title) {
    // Extract the first line or clean up the title
    displayText = d.title.split('\n')[0].trim();
    // If it starts with "awaiting_review", replace with something cleaner
    if (displayText.startsWith('awaiting_review')) {
      displayText = 'Awaiting Review';
    }
  }

  // Clean up the display text
  if (displayText && displayText.includes('⏳')) {
    displayText = displayText.split('⏳')[1]?.trim() || displayText;
  }

  if (!displayText) {
    displayText = 'Event';
  }

  return displayText;
}

/**
 * Build tooltip HTML for a timeline item
 */
export function buildTooltipHtml(d: ProcessedTimelineItem): string {
  let tooltipHtml = `
    <strong>${d.content}</strong><br/>
    ${new Date(d.startTime).toLocaleString()}<br/>
    ${d.end ? `<strong>End:</strong> ${new Date(d.endTime).toLocaleString()}<br/>` : ''}
    ${d.duration > 0 ? `<strong>Duration:</strong> ${formatDuration(d.duration)}<br/>` : ''}`;

  // Add comment content for discussion items
  if (d.group === 'discussion' && d.commentContent) {
    // Truncate long comments
    const maxLength = 300;
    const truncated =
      d.commentContent.length > maxLength
        ? d.commentContent.substring(0, maxLength) + '...'
        : d.commentContent;
    tooltipHtml += `<br/><br/><strong>Comment:</strong><br/><em>${truncated}</em>`;
  }

  // Add review body for code owner review items
  if (d.group.startsWith('reviewer_') && d.reviewBody) {
    // Truncate long review bodies
    const maxLength = 300;
    const truncated =
      d.reviewBody.length > maxLength
        ? d.reviewBody.substring(0, maxLength) + '...'
        : d.reviewBody;
    tooltipHtml += `<br/><br/><strong>Review:</strong><br/><em>${truncated}</em>`;
  }

  return tooltipHtml;
}

/**
 * Create or update a tooltip element
 */
export function createTooltip(
  colorMode: 'LIGHT' | 'DARK'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): d3.Selection<HTMLDivElement, unknown, HTMLElement, any> {
  return d3
    .select('body')
    .append('div')
    .attr('class', 'd3-tooltip')
    .style('opacity', 0)
    .style('position', 'absolute')
    .style('background', colorMode === 'DARK' ? '#333' : '#fff')
    .style('border', `1px solid ${colorMode === 'DARK' ? '#555' : '#ddd'}`)
    .style('border-radius', '4px')
    .style('line-height', '20px')
    .style('padding', '8px')
    .style('font-size', '14px')
    .style('color', colorMode === 'DARK' ? '#fff' : '#000')
    .style('box-shadow', '0 2px 4px rgba(0,0,0,0.1)')
    .style('pointer-events', 'none')
    .style('z-index', '1000');
}
