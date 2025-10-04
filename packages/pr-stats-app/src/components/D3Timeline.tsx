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
}: D3TimelineProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { colorMode } = useEuiTheme();
  const [containerWidth, setContainerWidth] = React.useState(width);
  const [collapsedGroups, setCollapsedGroups] = React.useState<Set<string>>(
    new Set(data.groups.filter(g => g.collapsed).map(g => g.id))
  );

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

  console.log('Processed data:', processedData);
  console.log('Available groups:', data.groups);
  console.log(
    'Items with undefined group:',
    processedData.filter(
      item => data.groups.findIndex(g => g.id === item.group) === -1
    )
  );

  // Calculate time domain
  const timeDomain = useMemo(() => {
    const times = processedData.flatMap(item => [item.startTime, item.endTime]);
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const oneDayInMs = 24 * 60 * 60 * 1000; // 1 day in milliseconds

    console.log('Time domain calculation:', {
      minTime: new Date(minTime).toISOString(),
      maxTime: new Date(maxTime).toISOString(),
      paddedMin: new Date(minTime - oneDayInMs).toISOString(),
      paddedMax: new Date(maxTime + oneDayInMs).toISOString(),
    });

    return [minTime - oneDayInMs, maxTime + oneDayInMs];
  }, [processedData]);

  console.log('Time domain:', timeDomain);

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

    // Calculate initial zoom to fit all events (before creating zoom behavior)
    const eventTimes = processedData.flatMap(item => [
      item.startTime,
      item.endTime,
    ]);
    const minEventTime = Math.min(...eventTimes);
    const maxEventTime = Math.max(...eventTimes);

    // Add small padding (5% on each side)
    const timeRange = maxEventTime - minEventTime;
    const padding = timeRange * 0.05;
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

    // Create zoom behavior with bounds
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 100])
      .translateExtent([
        [xScale(timeDomain[0]) - innerWidth, -Infinity],
        [xScale(timeDomain[1]) + innerWidth, Infinity],
      ])
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

        // Update existing hour grid lines instead of recreating them
        const newHourTicks = newXScale.ticks(d3.timeHour.every(6));
        g.selectAll('.hour-grid-line')
          .data(newHourTicks)
          .attr('x1', d => newXScale(d))
          .attr('x2', d => newXScale(d));

        // Update day separator lines with new day ticks
        const newDayTicks = d3.timeDay.range(
          d3.timeDay.floor(new Date(newXScale.domain()[0])),
          d3.timeDay.ceil(new Date(newXScale.domain()[1]))
        );

        // Update existing day separators instead of recreating them
        g.selectAll('.day-separator')
          .data(newDayTicks)
          .attr('x1', d => newXScale(d))
          .attr('x2', d => newXScale(d));

        // Update day axis

        const newDayAxis = d3
          .axisTop(newXScale)
          .tickValues(newDayTicks)
          .tickFormat(d3.timeFormat('%a %m/%d'))
          .tickSize(5);

        g.select('.day-axis').call(newDayAxis);
        g.select('.day-axis')
          .selectAll('text')
          .attr('fill', colorMode === 'DARK' ? '#fff' : '#000')
          .attr('font-size', '12px')
          .attr('font-weight', 'bold');

        // Update hour axis
        const newHourAxis = d3
          .axisTop(newXScale)
          .ticks(d3.timeHour.every(4))
          .tickFormat(d3.timeFormat('%H:%M'))
          .tickSize(5);

        g.select('.hour-axis').call(newHourAxis);
        g.select('.hour-axis')
          .selectAll('text')
          .attr('fill', colorMode === 'DARK' ? '#ccc' : '#666')
          .attr('font-size', '10px');
      });

    // Apply zoom behavior to SVG
    // Note: We've already rendered with transformedXScale, so we need to tell zoom
    // that we're starting from the initialTransform position
    svg.call(zoom);

    // Set the internal zoom state without triggering the zoom event
    // This ensures the first drag doesn't cause a jump
    svg.property('__zoom', initialTransform);

    // Add background for better contrast
    g.append('rect')
      .attr('width', innerWidth)
      .attr('height', totalRowHeight)
      .attr('fill', colorMode === 'DARK' ? '#1a1a1a' : '#ffffff')
      .attr('opacity', 0.1);

    // Add subtle hour grid lines
    const hourTicks = transformedXScale.ticks(d3.timeHour.every(6)); // Every 6 hours
    g.selectAll('.hour-grid-line')
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
      .attr('opacity', 0.3);

    // Calculate day ticks for day separator lines (needed early for rendering order)
    const localStart = new Date(timeDomain[0]);
    const localEnd = new Date(timeDomain[1]);
    const dayTicks = d3.timeDay.range(
      d3.timeDay.floor(localStart),
      d3.timeDay.ceil(localEnd)
    );

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
                  : 'other';
      return eventTypeColors[eventType as keyof typeof eventTypeColors];
    };

    // Add day separator lines (extend through timeline) - after dayTicks is defined, before timeline items
    g.selectAll('.day-separator')
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

    // Create grouped rectangles with text labels for duration events
    const rectGroups = g
      .selectAll<SVGGElement, ProcessedTimelineItem>('.timeline-rect-group')
      .data(processedData.filter(d => !d.isPointInTime))
      .enter()
      .append('g')
      .attr('class', 'timeline-item timeline-rect-group')
      .style('cursor', 'pointer');

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
      .attr('fill', getEventColor)
      .attr('opacity', 0.8);

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

        // Debug: log all rectangle items to see what we're working with
        console.log('Debug rectangle item:', {
          title: d.title,
          content: d.content,
          className: d.className,
          isPointInTime: d.isPointInTime,
        });

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

    // Create grouped point-in-time markers (circle + emoji)
    const pointGroups = g
      .selectAll<SVGGElement, ProcessedTimelineItem>('.timeline-point-group')
      .data(processedData.filter(d => d.isPointInTime))
      .enter()
      .append('g')
      .attr('class', 'timeline-item timeline-point-group')
      .style('cursor', 'pointer')
      .attr(
        'transform',
        d =>
          `translate(${transformedXScale(d.startTime) + (nudgeById.get(d.id) || 0)}, ${getItemY(d) + 10})`
      );

    pointGroups
      .append('circle')
      .attr('class', 'timeline-circle')
      .attr('r', POINT_RADIUS)
      .attr('fill', getEventColor)
      .attr('stroke', '#ffffff')
      .attr('stroke-width', 2)
      .attr('opacity', 0.8);

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
          d3.select(this).attr('opacity', 1);

          tooltip.transition().duration(200).style('opacity', 1);

          const tooltipContent = `
          <strong>${d.content}</strong><br/>
          <strong>Start:</strong> ${new Date(d.startTime).toLocaleString()}<br/>
          ${d.end ? `<strong>End:</strong> ${new Date(d.endTime).toLocaleString()}<br/>` : ''}
          ${d.duration > 0 ? `<strong>Duration:</strong> ${formatDuration(d.duration)}<br/>` : ''}
          <strong>Group:</strong> ${data.groups.find(g => g.id === d.group)?.content}
        `;

          tooltip
            .html(tooltipContent)
            .style('left', event.pageX + 10 + 'px')
            .style('top', event.pageY - 10 + 'px');
        })
        .on('mouseout', function () {
          d3.select(this).attr('opacity', 0.8).attr('stroke', 'none');

          tooltip.transition().duration(500).style('opacity', 0);
        })
        .on('click', function (event, d) {
          if (d.githubUrl) {
            window.open(d.githubUrl, '_blank');
          } else if (d.slackUrl) {
            window.open(d.slackUrl, '_blank');
          }
        });
    };

    addEventHandlers(rectGroups);
    addEventHandlers(pointGroups);

    // Add dual-level time axis

    const dayAxis = d3
      .axisTop(transformedXScale)
      .tickValues(dayTicks)
      .tickFormat(d3.timeFormat('%a %m/%d'))
      .tickSize(5);

    const dayAxisGroup = g
      .append('g')
      .attr('class', 'day-axis')
      .attr('transform', `translate(0, -20)`)
      .call(dayAxis);

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

    // Top axis - Hours/Time (underneath day axis)
    const hourAxis = d3
      .axisTop(transformedXScale)
      .ticks(d3.timeHour.every(4)) // Every 4 hours
      .tickFormat(d3.timeFormat('%H:%M'))
      .tickSize(5);

    const hourAxisGroup = g
      .append('g')
      .attr('class', 'hour-axis')
      .attr('transform', `translate(0, -5)`)
      .call(hourAxis);

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
          background: colorMode === 'DARK' ? '#0f1419' : '#fafafa',
        }}
      />
    </div>
  );
}
