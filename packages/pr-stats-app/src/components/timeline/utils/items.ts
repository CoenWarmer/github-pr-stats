import * as d3 from 'd3';
import React from 'react';
import { ProcessedTimelineItem } from '../types';
import {
  getEventColor,
  isItemHighlighted,
  getEmojiForItem,
  getDisplayText,
  buildTooltipHtml,
} from './rendering';

/**
 * Calculate Y position for a timeline item
 */
export function getItemY(
  item: ProcessedTimelineItem,
  rowHeights: number[],
  levelHeight: number,
  itemHeight: number = 24
): number {
  let y = 0;
  for (let i = 0; i < item.groupIndex; i++) {
    y += rowHeights[i];
  }

  // For CI group items (both main builds and jobs), position from top with stacking
  if (item.group === 'ci') {
    // Small top padding + level offset
    const topPadding = 5;
    return y + topPadding + item.level * levelHeight;
  }

  // For all other items, center vertically within the row
  const currentRowHeight = rowHeights[item.groupIndex] || 0;
  const centeredY = y + (currentRowHeight - itemHeight) / 2;
  return centeredY;
}

/**
 * Render duration events as rectangles with labels
 */
export function renderRectangleItems(
  fgGroup: d3.Selection<SVGGElement, unknown, null, undefined>,
  processedData: ProcessedTimelineItem[],
  xScale: d3.ScaleTime<number, number>,
  rowHeights: number[],
  levelHeight: number,
  rectHeight: number,
  activeGroups: string[] | null,
  colorMode: 'LIGHT' | 'DARK',
  selectedBuildId?: string | null
): d3.Selection<SVGGElement, ProcessedTimelineItem, SVGGElement, unknown> {
  const rectGroups = fgGroup
    .selectAll<SVGGElement, ProcessedTimelineItem>('.timeline-rect-group')
    .data(processedData.filter(d => !d.isPointInTime))
    .enter()
    .append('g')
    .attr('class', 'timeline-item timeline-rect-group')
    .style('cursor', 'pointer')
    .attr('opacity', d => (isItemHighlighted(d, activeGroups) ? 0.9 : 0.2));

  // Add invisible hit area for non-CI events (taller clickable area)
  const hitAreaHeight = 16; // Taller clickable area
  rectGroups
    .append('rect')
    .attr('class', 'timeline-rect-hit-area')
    .attr('x', d => xScale(d.startTime))
    .attr('y', d => {
      const isCiEvent =
        d.eventType === 'ci_run' ||
        d.eventType === 'ci_started' ||
        d.eventType === 'ci_completed';
      if (isCiEvent) {
        // CI events don't need a separate hit area
        return 0;
      }
      // Center the hit area around where the thin line will be
      const lineY = getItemY(d, rowHeights, levelHeight, rectHeight);
      return lineY - (hitAreaHeight - rectHeight) / 2;
    })
    .attr('width', d => Math.max(2, xScale(d.endTime) - xScale(d.startTime)))
    .attr('height', d => {
      const isCiEvent =
        d.eventType === 'ci_run' ||
        d.eventType === 'ci_started' ||
        d.eventType === 'ci_completed';
      // CI events don't use the hit area, non-CI events get the taller hit area
      return isCiEvent ? 0 : hitAreaHeight;
    })
    .attr('fill', 'transparent') // Invisible
    .attr('pointer-events', 'all'); // But still catches mouse events

  // Add visible rectangles
  rectGroups
    .append('rect')
    .attr('class', 'timeline-rect')
    .attr('x', d => xScale(d.startTime))
    .attr('y', d => {
      // CI events get fixed 24px height, others use rectHeight
      const height =
        d.eventType === 'ci_run' ||
        d.eventType === 'ci_started' ||
        d.eventType === 'ci_completed'
          ? 24
          : rectHeight;
      return getItemY(d, rowHeights, levelHeight, height);
    })
    .attr('width', d => Math.max(2, xScale(d.endTime) - xScale(d.startTime)))
    .attr('height', d => {
      // CI events get fixed 24px height, others use rectHeight
      if (
        d.eventType === 'ci_run' ||
        d.eventType === 'ci_started' ||
        d.eventType === 'ci_completed'
      ) {
        return 24;
      }
      return rectHeight;
    })
    .attr('rx', 3)
    .attr('ry', 3)
    .attr('fill', d => getEventColor(d))
    .attr('pointer-events', 'none'); // Disable pointer events on visual rect

  // Add text labels - use foreignObject for CI events to enable CSS truncation
  rectGroups.each(function (d) {
    const group = d3.select(this);
    const isCiEvent =
      d.eventType === 'ci_run' ||
      d.eventType === 'ci_started' ||
      d.eventType === 'ci_completed';

    if (isCiEvent) {
      // CI events: use foreignObject with CSS for text truncation
      const height = 24;
      const barWidth = Math.max(2, xScale(d.endTime) - xScale(d.startTime));
      const yPos = getItemY(d, rowHeights, levelHeight, height);

      // Check if this build has jobs (can be expanded)
      const hasJobs = d.buildkite_build_id && !d.workflow_name?.includes(' - ');
      const isExpanded = hasJobs && selectedBuildId === d.buildkite_build_id;

      group
        .append('foreignObject')
        .attr('x', xScale(d.startTime) + 5)
        .attr('y', yPos)
        .attr('width', Math.max(0, barWidth - (hasJobs ? 30 : 10))) // Leave space for arrow if expandable
        .attr('height', height)
        .append('xhtml:div')
        .style('width', '100%')
        .style('height', '100%')
        .style('display', 'flex')
        .style('align-items', 'center')
        .style('color', '#FFFFFF')
        .style('font-size', '13px')
        .style('white-space', 'nowrap')
        .style('overflow', 'hidden')
        .style('text-overflow', 'ellipsis')
        .style('pointer-events', 'none')
        .text(getDisplayText(d));

      // Add expand/collapse arrow for main builds with jobs
      if (hasJobs) {
        const arrowX = xScale(d.endTime) - 18; // Position near the right edge
        const arrowY = yPos + height / 2;

        // Add chevron arrow (pointing right if collapsed, down if expanded)
        const arrow = group
          .append('g')
          .attr('class', 'ci-build-arrow')
          .attr('transform', `translate(${arrowX}, ${arrowY})`)
          .style('pointer-events', 'none');

        if (isExpanded) {
          // Chevron down (expanded state) - V pointing down
          arrow
            .append('path')
            .attr('d', 'M -4 -2 L 0 2 L 4 -2')
            .attr('stroke', '#FFFFFF')
            .attr('stroke-width', 1.5)
            .attr('stroke-linecap', 'round')
            .attr('stroke-linejoin', 'round')
            .attr('fill', 'none')
            .attr('opacity', 0.9);
        } else {
          // Chevron right (collapsed state) - V pointing right
          arrow
            .append('path')
            .attr('d', 'M -2 -4 L 2 0 L -2 4')
            .attr('stroke', '#FFFFFF')
            .attr('stroke-width', 1.5)
            .attr('stroke-linecap', 'round')
            .attr('stroke-linejoin', 'round')
            .attr('fill', 'none')
            .attr('opacity', 0.9);
        }
      }
    } else {
      // Other events: use regular SVG text
      group
        .append('text')
        .attr('class', 'timeline-rect-label')
        .attr('x', xScale(d.endTime) + 20)
        .attr(
          'y',
          getItemY(d, rowHeights, levelHeight, rectHeight) + rectHeight / 2
        )
        .attr('dy', '0.35em')
        .attr('font-size', '13px')
        .attr('fill', colorMode === 'DARK' ? '#DFE5EF' : '#343741')
        .attr('pointer-events', 'none')
        .text(getDisplayText(d));
    }
  });

  return rectGroups;
}

/**
 * Render point-in-time events as circles with emojis
 */
export function renderPointItems(
  fgGroup: d3.Selection<SVGGElement, unknown, null, undefined>,
  processedData: ProcessedTimelineItem[],
  xScale: d3.ScaleTime<number, number>,
  rowHeights: number[],
  levelHeight: number,
  pointRadius: number,
  nudgeById: Map<string, number>,
  activeGroups: string[] | null
): d3.Selection<SVGGElement, ProcessedTimelineItem, SVGGElement, unknown> {
  const circleHeight = pointRadius * 2;
  const pointGroups = fgGroup
    .selectAll<SVGGElement, ProcessedTimelineItem>('.timeline-point-group')
    .data(processedData.filter(d => d.isPointInTime))
    .enter()
    .append('g')
    .attr('class', 'timeline-item timeline-point-group')
    .style('cursor', 'pointer')
    .attr('opacity', d => (isItemHighlighted(d, activeGroups) ? 0.9 : 0.2))
    .attr(
      'transform',
      d =>
        `translate(${xScale(d.startTime) + (nudgeById.get(d.id) || 0)}, ${getItemY(d, rowHeights, levelHeight, circleHeight) + pointRadius})`
    );

  // Add circles
  pointGroups
    .append('circle')
    .attr('class', 'timeline-circle')
    .attr('r', pointRadius)
    .attr('fill', d => getEventColor(d));

  // Add emojis
  pointGroups
    .append('text')
    .attr('class', 'timeline-circle-emoji')
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'central')
    .attr('font-size', `${Math.max(10, pointRadius * 1.2)}px`)
    .attr('pointer-events', 'none')
    .text(d => getEmojiForItem(d));

  return pointGroups;
}

/**
 * Add event handlers (hover, click, double-click) to timeline items
 */
export function addEventHandlers(
  selection: d3.Selection<
    SVGGElement,
    ProcessedTimelineItem,
    SVGGElement,
    unknown
  >,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tooltip: d3.Selection<HTMLDivElement, unknown, HTMLElement, any>,
  activeGroups: string[] | null,
  onBuildDoubleClick?: (buildId: string) => void,
  isTransitioningRef?: React.MutableRefObject<boolean>
) {
  let clickTimer: NodeJS.Timeout | null = null;

  selection
    .on('mouseover', function (event, d) {
      event.stopPropagation(); // Prevent event from bubbling to zoom behavior

      // Don't show tooltip during transitions
      if (isTransitioningRef?.current) {
        return;
      }

      // Set opacity on child elements, not the group
      d3.select(this).select('.timeline-rect').attr('opacity', 1);
      d3.select(this).select('.timeline-circle').attr('opacity', 1);

      tooltip.transition().duration(200).style('opacity', 1);

      const tooltipHtml = buildTooltipHtml(d);

      tooltip
        .html(tooltipHtml)
        .style('left', event.pageX + 10 + 'px')
        .style('top', event.pageY - 10 + 'px');
    })
    .on('mouseout', function (event, d) {
      // Reset opacity based on whether item is highlighted
      const targetOpacity = isItemHighlighted(d, activeGroups) ? 0.9 : 0.2;
      d3.select(this).select('.timeline-rect').attr('opacity', targetOpacity);

      const circleOpacity = isItemHighlighted(d, activeGroups) ? 0.9 : 0.2;
      d3.select(this).select('.timeline-circle').attr('opacity', circleOpacity);

      d3.select(this).attr('stroke', 'none');

      tooltip.transition().duration(500).style('opacity', 0);
    })
    .on('click', function (event, d) {
      // Check if this is a CI build that can be double-clicked
      const isCIBuild =
        onBuildDoubleClick &&
        d.group === 'ci' &&
        (d.eventType === 'ci_run' ||
          d.eventType === 'ci_started' ||
          d.eventType === 'ci_completed') &&
        d.buildkite_build_id;

      // For CI builds, delay the click to allow double-click to intercept
      if (isCIBuild) {
        if (clickTimer) {
          clearTimeout(clickTimer);
          clickTimer = null;
        } else {
          clickTimer = setTimeout(() => {
            clickTimer = null;
            if (d.url) {
              window.open(d.url, '_blank');
            }
          }, 250); // Wait 250ms to see if it's a double-click
        }
      } else {
        // For non-CI builds, open URL immediately
        if (d.url) {
          window.open(d.url, '_blank');
        }
      }
    })
    .on('dblclick', function (event, d) {
      // Clear the single-click timer if it exists
      if (clickTimer) {
        clearTimeout(clickTimer);
        clickTimer = null;
      }

      // Handle double-click on CI/CD build events
      if (
        onBuildDoubleClick &&
        d.group === 'ci' &&
        (d.eventType === 'ci_run' ||
          d.eventType === 'ci_started' ||
          d.eventType === 'ci_completed') &&
        d.buildkite_build_id
      ) {
        event.stopPropagation(); // Prevent default double-click behavior
        event.preventDefault(); // Prevent any default action
        onBuildDoubleClick(d.buildkite_build_id);
      }
    });
}
