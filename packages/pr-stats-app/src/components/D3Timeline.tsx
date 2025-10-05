'use client';

import React, { useRef, useEffect, useMemo } from 'react';
import * as d3 from 'd3';
import { TimelineData, TimelineItem } from '@/lib/types';
import { formatDuration } from '@/lib/utils';
import { useEuiTheme, euiPaletteColorBlindBehindText } from '@elastic/eui';

interface D3TimelineProps {
  data: TimelineData;
  width?: number;
  height?: number;
  zoomRange?: [Date, Date] | null;
  activeGroups?: string[] | null;
}

interface ProcessedTimelineItem extends TimelineItem {
  startTime: number;
  endTime: number;
  duration: number;
  level: number;
  groupIndex: number;
}

export default function D3Timeline({
  data,
  width = 1000,
  height = 600,
  zoomRange = null,
  activeGroups = null,
}: D3TimelineProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { colorMode } = useEuiTheme();
  const [containerWidth, setContainerWidth] = React.useState(width);
  const [collapsedGroups, setCollapsedGroups] = React.useState<Set<string>>(
    new Set(data.groups.filter(g => g.collapsed).map(g => g.id))
  );
  const isDimmedRef = useRef<boolean>(false);

  // Measure container width for responsive behavior
  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setContainerWidth(rect.width);
      }
    };

    // Initial measurement
    updateWidth();

    // Set up resize observer
    const resizeObserver = new ResizeObserver(updateWidth);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // Process timeline data
  const processedData = useMemo(() => {
    // Filter out items from collapsed groups
    const visibleItems = data.items.filter(
      item => !collapsedGroups.has(item.group)
    );

    const items: ProcessedTimelineItem[] = visibleItems.map(item => {
      const startTime = new Date(item.start).getTime();
      const endTime = item.end
        ? new Date(item.end).getTime()
        : item.isPointInTime
          ? startTime // Point-in-time events have no duration
          : startTime + 30 * 60 * 1000; // 30 minutes default for duration events

      const groupIndex = data.groups.findIndex(g => g.id === item.group);
      // Fallback to 0 if group not found to prevent positioning issues
      const safeGroupIndex = groupIndex === -1 ? 0 : groupIndex;

      return {
        ...item,
        startTime,
        endTime,
        duration: endTime - startTime,
        level: 0, // Will be calculated for collision detection
        groupIndex: safeGroupIndex,
      };
    });

    // Sort items by start time for collision detection
    items.sort((a, b) => a.startTime - b.startTime);

    // Calculate levels to avoid overlaps within each group
    // Strategy: Duration items (rectangles) on top levels, point-in-time items (circles) on bottom levels
    const groupDurationLevels: Map<
      string,
      Array<{ endTime: number }>
    > = new Map();
    const groupPointLevels: Map<string, Array<{ endTime: number }>> = new Map();

    // First pass: assign levels to duration items (rectangles)
    items
      .filter(item => !item.isPointInTime)
      .forEach(item => {
        if (!groupDurationLevels.has(item.group)) {
          groupDurationLevels.set(item.group, []);
        }

        const levels = groupDurationLevels.get(item.group)!;
        let level = 0;

        // Find the first level where this item doesn't overlap
        while (
          level < levels.length &&
          levels[level].endTime > item.startTime
        ) {
          level++;
        }

        // Assign this level to the item
        item.level = level;

        // Update or create the level
        if (level >= levels.length) {
          levels.push({ endTime: item.endTime });
        } else {
          levels[level].endTime = item.endTime;
        }
      });

    // Second pass: assign levels to point-in-time items (circles), starting after duration items
    items
      .filter(item => item.isPointInTime)
      .forEach(item => {
        if (!groupPointLevels.has(item.group)) {
          groupPointLevels.set(item.group, []);
        }

        const pointLevels = groupPointLevels.get(item.group)!;
        const durationLevelCount =
          groupDurationLevels.get(item.group)?.length || 0;
        let level = 0;

        // Find the first level where this item doesn't overlap
        while (
          level < pointLevels.length &&
          pointLevels[level].endTime > item.startTime
        ) {
          level++;
        }

        // Assign this level to the item, offset by the number of duration levels
        // Add a 10px gap between duration and point-in-time items for visual separation
        // (10px / 25px levelHeight = 0.4 levels)
        const gap = durationLevelCount > 0 ? 0.4 : 0;
        item.level = durationLevelCount + gap + level;

        // Update or create the level
        if (level >= pointLevels.length) {
          pointLevels.push({ endTime: item.endTime });
        } else {
          pointLevels[level].endTime = item.endTime;
        }
      });

    return items;
  }, [data, collapsedGroups]);

  // Calculate time domain
  const timeDomain = useMemo(() => {
    const times = processedData.flatMap(item => [item.startTime, item.endTime]);
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const oneDayInMs = 24 * 60 * 60 * 1000; // 1 day in milliseconds

    return [minTime - oneDayInMs, maxTime + oneDayInMs];
  }, [processedData]);

  // Color mapping for different event types using EUI palette
  const eventTypeColors = useMemo(() => {
    const palette = euiPaletteColorBlindBehindText({ sortBy: 'natural' });

    return {
      commit: palette[0], // Blue
      review: palette[1], // Orange
      comment: palette[2], // Green
      ci: palette[3], // Red
      discussion: palette[4], // Purple
      release: palette[5], // Brown
      iteration: palette[7], // Teal
      other: palette[6], // Pink
    };
  }, []);

  // Color scale for different event types
  const colorScale = useMemo(() => {
    const eventTypes = Array.from(
      new Set(
        processedData.map(item => {
          if (item.className?.includes('commit')) return 'commit';
          if (item.className?.includes('review')) return 'review';
          if (item.className?.includes('comment')) return 'comment';
          if (item.className?.includes('ci')) return 'ci';
          if (item.className?.includes('discussion')) return 'discussion';
          if (item.className?.includes('release')) return 'release';
          if (item.className?.includes('iteration')) return 'iteration';
          return 'other';
        })
      )
    );

    return d3
      .scaleOrdinal<string>()
      .domain(eventTypes)
      .range(
        eventTypes.map(
          type => eventTypeColors[type as keyof typeof eventTypeColors]
        )
      );
  }, [processedData, eventTypeColors]);

  useEffect(() => {
    if (!svgRef.current || processedData.length === 0) return;

    // Use container width for responsive behavior
    const actualWidth = containerWidth > 0 ? containerWidth : width;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove(); // Clear previous render

    // Set up dimensions and margins (increased top for day and hour axes)
    const margin = { top: 100, right: 40, bottom: 40, left: 200 };
    const innerWidth = actualWidth - margin.left - margin.right;

    // Calculate row height based on maximum levels in each group
    const groupMaxLevels = new Map<string, number>();
    processedData.forEach(item => {
      const currentMax = groupMaxLevels.get(item.group) || 0;
      groupMaxLevels.set(item.group, Math.max(currentMax, item.level + 1));
    });

    const baseRowHeight = 17;
    const levelHeight = 25;
    const collapsedRowHeight = 30; // Height for collapsed rows (just the label)
    const rowHeights = data.groups.map(group => {
      if (collapsedGroups.has(group.id)) {
        return collapsedRowHeight;
      }
      return baseRowHeight + (groupMaxLevels.get(group.id) || 1) * levelHeight;
    });
    const totalRowHeight = rowHeights.reduce((sum, height) => sum + height, 0);

    // Update SVG dimensions
    svg.attr('width', actualWidth);
    const requiredHeight = totalRowHeight + margin.top + margin.bottom;
    if (requiredHeight > height) {
      svg.attr('height', requiredHeight);
    }

    // Create scales
    const xScale = d3
      .scaleTime()
      .domain(timeDomain as [Date, Date])
      .range([0, innerWidth]);

    // Point-in-time marker sizing and spacing
    const POINT_RADIUS = 12; // px (was 6)
    // Ensure a minimal pixel gap between close items (point-in-time vs others)
    const MIN_PIXEL_GAP = POINT_RADIUS * 2; // keep at least one diameter apart
    const computeNudges = (scale: any) => {
      const nudgeById = new Map<string, number>();
      const lastXByRow = new Map<string, number>();

      // Sort by x position to process left to right
      const itemsByX = [...processedData].sort(
        (a, b) => scale(a.startTime) - scale(b.startTime)
      );

      for (const item of itemsByX) {
        const key = `${item.groupIndex}-${item.level}`;
        const x = scale(item.startTime);
        const lastX = lastXByRow.get(key) ?? -Infinity;

        // Only nudge point-in-time items; rectangles stay anchored at time
        if (x - lastX < MIN_PIXEL_GAP) {
          const delta = MIN_PIXEL_GAP - (x - lastX);
          if (item.isPointInTime) {
            nudgeById.set(item.id, (nudgeById.get(item.id) || 0) + delta);
            lastXByRow.set(key, x + delta);
          } else {
            // Non point-in-time: do not move; update lastX so following dots can nudge
            lastXByRow.set(key, x);
          }
        } else {
          lastXByRow.set(key, item.isPointInTime ? x : x);
        }
      }

      return nudgeById;
    };

    // Create main group
    const g = svg
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Create a background group for grid lines (always behind timeline items)
    const bgGroup = g.append('g').attr('class', 'background-layer');

    // Create a foreground group for timeline items (always in front)
    const fgGroup = g.append('g').attr('class', 'foreground-layer');

    // Calculate initial zoom to fit all events (or zoom range if provided)
    let minEventTime: number;
    let maxEventTime: number;

    if (zoomRange) {
      // Use provided zoom range
      minEventTime = zoomRange[0].getTime();
      maxEventTime = zoomRange[1].getTime();
    } else {
      // Calculate from all events
      const eventTimes = processedData.flatMap(item => [
        item.startTime,
        item.endTime,
      ]);
      minEventTime = Math.min(...eventTimes);
      maxEventTime = Math.max(...eventTimes);
    }

    // Ensure minimum time range to prevent zoom issues
    const timeRange = maxEventTime - minEventTime;
    const minTimeRange = 60 * 60 * 1000; // 1 hour minimum

    if (timeRange < minTimeRange) {
      const midpoint = (minEventTime + maxEventTime) / 2;
      minEventTime = midpoint - minTimeRange / 2;
      maxEventTime = midpoint + minTimeRange / 2;
    }

    // Add small padding (5% on each side)
    const adjustedTimeRange = maxEventTime - minEventTime;
    const padding = adjustedTimeRange * 0.05;
    const paddedMin = minEventTime - padding;
    const paddedMax = maxEventTime + padding;

    // Calculate the scale factor needed to fit the events
    // Account for the actual available width (total width minus left margin for row labels)
    const availableWidth = actualWidth - margin.left - margin.right;
    const eventWidth = xScale(paddedMax) - xScale(paddedMin);
    const initialScale = availableWidth / eventWidth;

    // Calculate the translation to center the events
    const initialTranslateX = -xScale(paddedMin) * initialScale;

    // Create initial zoom transform
    const initialTransform = d3.zoomIdentity
      .translate(initialTranslateX, 0)
      .scale(initialScale);

    // Create the initially transformed scale for rendering
    const transformedXScale = initialTransform.rescaleX(xScale);

    // Now compute nudges with the transformed scale
    let nudgeById = computeNudges(transformedXScale);

    // Calculate minimum scale to prevent zooming out beyond the full data range
    // The minimum scale should show the entire timeDomain within the viewport
    const fullDataWidth = xScale(timeDomain[1]) - xScale(timeDomain[0]);
    const minScale = innerWidth / fullDataWidth;

    // Create zoom behavior with bounds
    // Set extent to match the SVG viewport and restrict panning to data range
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([minScale * 0.9, 100]) // Allow zooming out to 90% of full view for some padding
      .extent([
        [0, 0],
        [innerWidth, totalRowHeight],
      ])
      .translateExtent([
        [xScale(timeDomain[0]), 0],
        [xScale(timeDomain[1]), totalRowHeight],
      ])
      .on('start', event => {
        // Reset opacity when user starts interacting
        if (isDimmedRef.current && event.sourceEvent) {
          isDimmedRef.current = false;
          // Reset all items to full opacity
          g.selectAll('.timeline-rect').attr('opacity', 0.9);
          g.selectAll('.timeline-circle').attr('opacity', 0.9);
        }
      })
      .on('zoom', event => {
        const { transform } = event;

        // Update x scale with zoom transform
        const newXScale = transform.rescaleX(xScale);

        // Update timeline items - handle rectangles and point groups
        g.selectAll<SVGElement, ProcessedTimelineItem>('.timeline-item').each(
          function (d) {
            const element = d3.select(this);
            if (d.isPointInTime) {
              // Recompute nudges at current zoom
              nudgeById = computeNudges(newXScale);
              // Move grouped point marker via transform (circle + emoji)
              element.attr(
                'transform',
                `translate(${newXScale(d.startTime) + (nudgeById.get(d.id) || 0)}, ${getItemY(d) + 10})`
              );
            } else {
              // Update grouped rectangles
              element
                .select('rect')
                .attr('x', newXScale(d.startTime))
                .attr('width', d =>
                  Math.max(2, newXScale(d.endTime) - newXScale(d.startTime))
                );
              // Update text labels in groups
              const newWidth = Math.max(
                2,
                newXScale(d.endTime) - newXScale(d.startTime)
              );
              const newMaxChars = Math.floor((newWidth - 10) / 6); // Approximate chars that fit

              // Recalculate display text based on new width
              let displayText = d.content;
              if (!displayText && d.title) {
                displayText = d.title.split('\n')[0].trim();
              }

              if (!displayText) {
                displayText = 'Event';
              }

              const finalText =
                displayText.length > newMaxChars
                  ? displayText.substring(0, newMaxChars - 3) + '...'
                  : displayText;

              element
                .select('text')
                .attr('x', newXScale(d.startTime) + 5)
                .text(finalText);
            }
          }
        );

        // Calculate the visible time range in milliseconds
        const domain = newXScale.domain();
        const visibleTimeRange = domain[1].getTime() - domain[0].getTime();
        const oneDayMs = 24 * 60 * 60 * 1000;
        const visibleDays = visibleTimeRange / oneDayMs;

        // Only show hour grid lines when zoomed in enough (< 7 days visible)
        const showHourGridLines = visibleDays < 7;

        // Update hour grid lines with proper data join (in background group)
        const newHourTicks = showHourGridLines
          ? newXScale.ticks(d3.timeHour.every(6))
          : [];
        const hourGridLines = bgGroup
          .selectAll('.hour-grid-line')
          .data(newHourTicks);

        // Remove old lines
        hourGridLines.exit().remove();

        // Add new lines and update existing ones
        hourGridLines
          .enter()
          .append('line')
          .attr('class', 'hour-grid-line')
          .attr('y1', 0)
          .attr('y2', totalRowHeight)
          .attr('stroke', colorMode === 'DARK' ? '#222' : '#eee')
          .attr('stroke-width', 1)
          .attr('opacity', 0.6)
          .merge(hourGridLines)
          .attr('x1', d => newXScale(d))
          .attr('x2', d => newXScale(d));

        // Only show day separators if we're showing more than 2 days
        // At high zoom (less than 2 days visible), hide them to reduce clutter
        const showDaySeparators = visibleTimeRange > oneDayMs * 2;

        // Generate day ticks from the full data range (not just visible domain)
        // This ensures consistent tick positions when panning
        const allNewDayTicks = showDaySeparators
          ? d3.timeDay.range(
              d3.timeDay.floor(new Date(timeDomain[0])),
              d3.timeDay.ceil(new Date(timeDomain[1]))
            )
          : [];

        // Filter based on zoom level first
        let filteredDayTicks = allNewDayTicks;
        if (visibleDays > 60) {
          filteredDayTicks = allNewDayTicks.filter((d, i) => i % 7 === 0);
        } else if (visibleDays > 30) {
          filteredDayTicks = allNewDayTicks.filter((d, i) => i % 3 === 0);
        } else if (visibleDays > 14) {
          filteredDayTicks = allNewDayTicks.filter((d, i) => i % 2 === 0);
        }

        // Then filter to only show ticks within the visible domain
        const newDayTicks = filteredDayTicks.filter(
          d =>
            d.getTime() >= domain[0].getTime() &&
            d.getTime() <= domain[1].getTime()
        );

        // Update existing day separators (in background group)
        const daySeps = bgGroup.selectAll('.day-separator').data(newDayTicks);

        // Remove extra separators
        daySeps.exit().remove();

        // Add new separators
        daySeps
          .enter()
          .append('line')
          .attr('class', 'day-separator')
          .attr('y1', -20)
          .attr('y2', totalRowHeight)
          .attr('stroke', colorMode === 'DARK' ? '#444' : '#ddd')
          .attr('stroke-width', 1)
          .attr('opacity', 0.7)
          .merge(daySeps)
          .attr('x1', d => newXScale(d))
          .attr('x2', d => newXScale(d));

        // Update day axis with adaptive tick spacing based on zoom level
        // Use the same filtered day ticks as for separators
        const displayDayTicks = newDayTicks;

        const newDayAxis = d3
          .axisTop(newXScale)
          .tickValues(displayDayTicks)
          .tickFormat(d3.timeFormat('%a %m/%d') as any)
          .tickSize(5);

        g.select('.day-axis').call(newDayAxis as any);
        g.select('.day-axis')
          .selectAll('text')
          .attr('fill', colorMode === 'DARK' ? '#fff' : '#000')
          .attr('font-size', '12px')
          .attr('font-weight', 'bold');

        // Update hour axis - only show when zoomed in enough (< 7 days visible)
        const showHourAxis = visibleDays < 7;

        if (showHourAxis) {
          const newHourAxis = d3
            .axisTop(newXScale)
            .ticks(d3.timeHour.every(4))
            .tickFormat(d3.timeFormat('%H:%M') as any)
            .tickSize(5);

          g.select('.hour-axis')
            .style('opacity', 1)
            .call(newHourAxis as any);
          g.select('.hour-axis')
            .selectAll('text')
            .attr('fill', colorMode === 'DARK' ? '#ccc' : '#666')
            .attr('font-size', '10px');
        } else {
          // Hide hour axis when zoomed out
          g.select('.hour-axis').style('opacity', 0);
        }
      });

    // Apply zoom behavior to SVG
    svg.call(zoom);

    // Set the initial zoom state
    if (zoomRange) {
      // Animate to the zoom range with a transition
      svg
        .transition()
        .duration(750)
        .ease(d3.easeCubicInOut)
        .call(zoom.transform as any, initialTransform);
    } else {
      // Set the internal zoom state without triggering the zoom event
      // This ensures the first drag doesn't cause a jump
      // We use property instead of call(zoom.transform) to avoid triggering zoom events
      svg.property('__zoom', initialTransform);
    }

    // Calculate initial visible time range for adaptive display
    const initialDomain = transformedXScale.domain();
    const initialVisibleTimeRange =
      initialDomain[1].getTime() - initialDomain[0].getTime();
    const oneDayMs = 24 * 60 * 60 * 1000;
    const initialVisibleDays = initialVisibleTimeRange / oneDayMs;

    // Only show hour grid lines when zoomed in enough (< 7 days visible)
    const showInitialHourGridLines = initialVisibleDays < 7;

    // Add subtle hour grid lines (in background group) - only if zoomed in enough
    if (showInitialHourGridLines) {
      const hourTicks = transformedXScale.ticks(d3.timeHour.every(6)); // Every 6 hours
      bgGroup
        .selectAll('.hour-grid-line')
        .data(hourTicks)
        .enter()
        .append('line')
        .attr('class', 'hour-grid-line')
        .attr('x1', d => transformedXScale(d))
        .attr('x2', d => transformedXScale(d))
        .attr('y1', 0)
        .attr('y2', totalRowHeight)
        .attr('stroke', colorMode === 'DARK' ? '#222' : '#eee')
        .attr('stroke-width', 1)
        .attr('opacity', 0.6);
    }

    // Calculate day ticks for day separator lines using the visible domain
    const showInitialDaySeparators = initialVisibleTimeRange > oneDayMs * 2;

    const allDayTicks = showInitialDaySeparators
      ? d3.timeDay.range(
          d3.timeDay.floor(new Date(initialDomain[0])),
          d3.timeDay.ceil(new Date(initialDomain[1]))
        )
      : [];

    // Filter day separators based on zoom level
    let dayTicks = allDayTicks;
    if (initialVisibleDays > 60) {
      dayTicks = allDayTicks.filter((d, i) => i % 7 === 0);
    } else if (initialVisibleDays > 30) {
      dayTicks = allDayTicks.filter((d, i) => i % 3 === 0);
    } else if (initialVisibleDays > 14) {
      dayTicks = allDayTicks.filter((d, i) => i % 2 === 0);
    }

    // Calculate y positions for items
    const getItemY = (item: ProcessedTimelineItem) => {
      let y = 0;
      for (let i = 0; i < item.groupIndex; i++) {
        y += rowHeights[i];
      }
      return y + 10 + item.level * levelHeight;
    };

    // Add timeline items - use circles for point-in-time events, rectangles for duration events
    const getEventColor = (d: ProcessedTimelineItem) => {
      // For CI items, use success/failure colors if available
      if (d.className?.includes('ci')) {
        if (d.color === 'success') {
          return '#00BFB3'; // EUI success green
        } else if (d.color === 'danger') {
          return '#BD271E'; // EUI danger red
        } else if (d.color === 'warning') {
          return '#F5A700'; // EUI warning yellow/orange
        }
        // Fall through to default CI color for other cases
      }

      const eventType = d.className?.includes('commit')
        ? 'commit'
        : d.className?.includes('review')
          ? 'review'
          : d.className?.includes('comment')
            ? 'comment'
            : d.className?.includes('ci')
              ? 'ci'
              : d.className?.includes('discussion')
                ? 'discussion'
                : d.className?.includes('release')
                  ? 'release'
                  : d.className?.includes('iteration')
                    ? 'iteration'
                    : 'other';
      return eventTypeColors[eventType as keyof typeof eventTypeColors];
    };

    // Helper function to determine if an item should be highlighted
    const isItemHighlighted = (d: ProcessedTimelineItem): boolean => {
      // If no active groups filter is set (null), highlight everything
      if (activeGroups === null) return true;

      // If activeGroups is an array (even empty), only highlight items in those groups
      return activeGroups.includes(d.group);
    };

    // Add day separator lines (extend through timeline) - in background group
    bgGroup
      .selectAll('.day-separator')
      .data(dayTicks)
      .enter()
      .append('line')
      .attr('class', 'day-separator')
      .attr('x1', d => transformedXScale(d))
      .attr('x2', d => transformedXScale(d))
      .attr('y1', -20)
      .attr('y2', totalRowHeight)
      .attr('stroke', colorMode === 'DARK' ? '#444' : '#ddd')
      .attr('stroke-width', 1)
      .attr('opacity', 0.7);

    // Create grouped rectangles with text labels for duration events (in foreground group)
    const rectGroups = fgGroup
      .selectAll<SVGGElement, ProcessedTimelineItem>('.timeline-rect-group')
      .data(processedData.filter(d => !d.isPointInTime))
      .enter()
      .append('g')
      .attr('class', 'timeline-item timeline-rect-group')
      .style('cursor', 'pointer')
      .attr('opacity', d => (isItemHighlighted(d) ? 0.9 : 0.2));

    // Add rectangles to the groups
    rectGroups
      .append('rect')
      .attr('class', 'timeline-rect')
      .attr('x', d => transformedXScale(d.startTime))
      .attr('y', d => getItemY(d))
      .attr('width', d =>
        Math.max(
          2,
          transformedXScale(d.endTime) - transformedXScale(d.startTime)
        )
      )
      .attr('height', 24)
      .attr('rx', 3)
      .attr('ry', 3)
      .attr('fill', getEventColor);

    // Add text labels to the groups
    rectGroups
      .append('text')
      .attr('class', 'timeline-rect-label')
      .attr('x', d => transformedXScale(d.startTime) + 5) // 5px padding from left edge
      .attr('y', d => getItemY(d) + 15) // Center vertically in the rectangle
      .attr('font-size', '13px')
      .attr('fill', '#fff')
      .attr('pointer-events', 'none')
      .text(d => {
        const width = Math.max(
          2,
          transformedXScale(d.endTime) - transformedXScale(d.startTime)
        );
        const maxChars = Math.floor((width - 10) / 6); // Approximate chars that fit (6px per char)

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

        return displayText.length > maxChars
          ? displayText.substring(0, maxChars - 3) + '...'
          : displayText;
      });

    // Create grouped point-in-time markers (circle + emoji) (in foreground group)
    const pointGroups = fgGroup
      .selectAll<SVGGElement, ProcessedTimelineItem>('.timeline-point-group')
      .data(processedData.filter(d => d.isPointInTime))
      .enter()
      .append('g')
      .attr('class', 'timeline-item timeline-point-group')
      .style('cursor', 'pointer')
      .attr('opacity', d => (isItemHighlighted(d) ? 0.9 : 0.2))
      .attr(
        'transform',
        d =>
          `translate(${transformedXScale(d.startTime) + (nudgeById.get(d.id) || 0)}, ${getItemY(d) + 10})`
      );

    pointGroups
      .append('circle')
      .attr('class', 'timeline-circle')
      .attr('r', POINT_RADIUS)
      .attr('fill', getEventColor);

    // Track if we're in dimmed mode (when activeGroups is not null)
    if (activeGroups !== null) {
      isDimmedRef.current = true;
    }

    const getEmojiForItem = (d: ProcessedTimelineItem) => {
      return d.emoji;
    };

    pointGroups
      .append('text')
      .attr('class', 'timeline-circle-emoji')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('font-size', `${Math.max(10, POINT_RADIUS * 1.2)}px`)
      .attr('pointer-events', 'none')
      .text(d => getEmojiForItem(d));

    // Add event handlers to both selections separately

    // Add tooltip
    const tooltip = d3
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

    // Add hover effects and tooltips to both selections
    const addEventHandlers = (selection: any) => {
      selection
        .on('mouseover', function (event, d) {
          // Set opacity on child elements, not the group
          d3.select(this).select('.timeline-rect').attr('opacity', 1);
          d3.select(this).select('.timeline-circle').attr('opacity', 1);

          tooltip.transition().duration(200).style('opacity', 1);

          // Build tooltip content
          let tooltipHtml = `
          <strong>${d.content}</strong><br/>
          <strong>Start:</strong> ${new Date(d.startTime).toLocaleString()}<br/>
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

          tooltip
            .html(tooltipHtml)
            .style('left', event.pageX + 10 + 'px')
            .style('top', event.pageY - 10 + 'px');
        })
        .on('mouseout', function (event, d) {
          // Reset opacity based on whether item is highlighted
          const targetOpacity = isItemHighlighted(d) ? 0.9 : 0.2;
          d3.select(this)
            .select('.timeline-rect')
            .attr('opacity', targetOpacity);

          const circleOpacity = isItemHighlighted(d) ? 0.9 : 0.2;
          d3.select(this)
            .select('.timeline-circle')
            .attr('opacity', circleOpacity);

          d3.select(this).attr('stroke', 'none');

          tooltip.transition().duration(500).style('opacity', 0);
        })
        .on('click', function (event, d) {
          console.log('clicked', d);
          if (d.url) {
            window.open(d.url, '_blank');
          }
        });
    };

    addEventHandlers(rectGroups);
    addEventHandlers(pointGroups);

    // Add dual-level time axis with adaptive display

    // Use the same filtered day ticks for axis labels as for separators
    const displayDayTicks = dayTicks;

    const dayAxis = d3
      .axisTop(transformedXScale)
      .tickValues(displayDayTicks)
      .tickFormat(d3.timeFormat('%a %m/%d') as any)
      .tickSize(5);

    const dayAxisGroup = g
      .append('g')
      .attr('class', 'day-axis')
      .attr('transform', `translate(0, -20)`)
      .call(dayAxis as any);

    dayAxisGroup
      .selectAll('text')
      .attr('fill', colorMode === 'DARK' ? '#fff' : '#000')
      .attr('font-size', '12px')
      .attr('font-weight', 'bold');

    dayAxisGroup
      .selectAll('line')
      .attr('stroke', colorMode === 'DARK' ? '#666' : '#999');

    dayAxisGroup
      .select('.domain')
      .attr('stroke', colorMode === 'DARK' ? '#666' : '#999')
      .attr('opacity', 0);

    // Top axis - Hours/Time (underneath day axis) - only show when zoomed in
    const showInitialHourAxis = initialVisibleDays < 7;

    if (showInitialHourAxis) {
      const hourAxis = d3
        .axisTop(transformedXScale)
        .ticks(d3.timeHour.every(4)) // Every 4 hours
        .tickFormat(d3.timeFormat('%H:%M') as any)
        .tickSize(5);

      const hourAxisGroup = g
        .append('g')
        .attr('class', 'hour-axis')
        .attr('transform', `translate(0, -5)`)
        .call(hourAxis as any);

      hourAxisGroup
        .selectAll('text')
        .attr('fill', colorMode === 'DARK' ? '#ccc' : '#666')
        .attr('font-size', '10px');

      hourAxisGroup
        .selectAll('line')
        .attr('stroke', colorMode === 'DARK' ? '#555' : '#aaa');

      hourAxisGroup
        .select('.domain')
        .attr('stroke', colorMode === 'DARK' ? '#555' : '#aaa');
    } else {
      // Create empty hour axis group for zoom handler to update
      g.append('g')
        .attr('class', 'hour-axis')
        .attr('transform', `translate(0, -5)`)
        .style('opacity', 0);
    }

    // Add group labels and separators (rendered last to appear on top)
    let currentY = 0;
    data.groups.forEach((group, i) => {
      const rowHeight = rowHeights[i];

      // Group separator line
      if (i > 0) {
        g.append('line')
          .attr('x1', -margin.left)
          .attr('x2', innerWidth)
          .attr('y1', currentY)
          .attr('y2', currentY)
          .attr('stroke', colorMode === 'DARK' ? '#444' : '#ccc')
          .attr('stroke-width', 1);
      }

      // Add background rectangle behind the text - full row height
      const bgRect = g
        .append('rect')
        .attr('x', -margin.left)
        .attr('y', currentY)
        .attr('width', margin.left)
        .attr('height', rowHeight)
        .attr('fill', colorMode === 'DARK' ? '#0f1419' : '#fafafa')
        .attr('stroke', colorMode === 'DARK' ? '#444' : '#ddd')
        .attr('stroke-width', 1)
        .attr('opacity', 1);

      // Group label text (rendered after background)
      const labelText = g
        .append('text')
        .attr('x', -15)
        .attr('y', currentY + rowHeight / 2)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'end')
        .attr('font-size', '14px')
        .attr('fill', colorMode === 'DARK' ? '#fff' : '#000')
        .text(group.content);

      // Add collapse/expand indicator for collapsible groups
      if (group.collapsed !== undefined) {
        const isCollapsed = collapsedGroups.has(group.id);
        g.append('text')
          .attr('x', -margin.left + 5)
          .attr('y', currentY + rowHeight / 2)
          .attr('dy', '0.35em')
          .attr('text-anchor', 'start')
          .attr('font-size', '12px')
          .attr('fill', colorMode === 'DARK' ? '#999' : '#666')
          .style('cursor', 'pointer')
          .text(isCollapsed ? '▶' : '▼');

        // Make the background and label clickable for collapsible groups
        bgRect.style('cursor', 'pointer');
        labelText.style('cursor', 'pointer');

        const toggleCollapse = () => {
          setCollapsedGroups(prev => {
            const next = new Set(prev);
            if (next.has(group.id)) {
              next.delete(group.id);
            } else {
              next.add(group.id);
            }
            return next;
          });
        };

        bgRect.on('click', toggleCollapse);
        labelText.on('click', toggleCollapse);
      }

      currentY += rowHeight;
    });

    // Cleanup tooltip on component unmount
    return () => {
      d3.select('.d3-tooltip').remove();
    };
  }, [
    data,
    processedData,
    timeDomain,
    colorScale,
    containerWidth,
    width,
    height,
    colorMode,
    eventTypeColors,
    collapsedGroups,
    zoomRange,
    activeGroups,
  ]);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', overflowX: 'auto', overflowY: 'auto' }}
    >
      <svg
        ref={svgRef}
        width={containerWidth > 0 ? containerWidth : width}
        height={height}
        style={{
          display: 'block',
          background: colorMode === 'DARK' ? '#07101F' : '#fafafa',
        }}
      />
    </div>
  );
}
