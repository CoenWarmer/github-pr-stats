'use client';

import React, { useRef, useEffect, useMemo } from 'react';
import * as d3 from 'd3';
import { useEuiTheme } from '@elastic/eui';

import { D3TimelineProps } from './types';
import { TIMELINE_CONFIG, ONE_DAY_MS } from './constants';
import {
  processTimelineData,
  calculateTimeDomain,
  calculateRowHeights,
  computeNudges,
} from './utils/dataProcessing';
import {
  calculateInitialZoom,
  calculateMinScale,
  calculateVisibility,
} from './utils/zoomUtils';
import { createTooltip } from './utils/rendering';
import {
  renderDayAxis,
  renderHourAxis,
  calculateInitialDayTicks,
} from './utils/axes';
import { renderHourGridLines, renderDaySeparators } from './utils/gridLines';
import {
  renderRectangleItems,
  renderPointItems,
  addEventHandlers,
} from './utils/items';
import { renderGroupLabels } from './utils/groupLabels';
import { createZoomBehavior } from './utils/zoom';

export default function D3Timeline({
  data,
  width = 1000,
  height = 600,
  zoomRange = null,
  activeGroups = null,
  selectedBuildId = null,
  onBuildDoubleClick,
  onRowClick,
  onZoomRangeChange,
}: D3TimelineProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { colorMode } = useEuiTheme();
  const [containerWidth, setContainerWidth] = React.useState(width);
  const [collapsedGroups, setCollapsedGroups] = React.useState<Set<string>>(
    new Set(data.groups.filter(g => g.collapsed).map(g => g.id))
  );
  const isDimmedRef = useRef<boolean>(false);
  const isTransitioningRef = useRef<boolean>(false);
  const brushSelectionRef = useRef<{
    start: number | null;
    current: number | null;
  }>({ start: null, current: null });

  // Measure container width for responsive behavior
  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setContainerWidth(rect.width);
      }
    };

    updateWidth();

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
    let processed = processTimelineData(data, collapsedGroups);

    // Filter CI items based on whether a build is selected
    processed = processed.filter(item => {
      // Keep all items that are not in the CI group
      if (item.group !== 'ci') return true;

      // For CI group items, check if it's a job (has ' - ' in workflow_name)
      const isJob = item.workflow_name?.includes(' - ');

      // Always keep ALL main builds (not jobs), regardless of selectedBuildId
      if (!isJob) {
        return true;
      }

      // For job items:
      // - If a build is selected, only show jobs for that build
      // - If no build is selected, hide all job items
      if (selectedBuildId) {
        return item.buildkite_build_id === selectedBuildId;
      } else {
        return false; // Hide jobs when no build is selected
      }
    });

    // If a build is selected, reassign levels to CI jobs so they stack correctly
    // (levels 1, 2, 3... instead of having gaps from filtered-out items)
    if (selectedBuildId) {
      const ciJobs = processed.filter(
        item => item.group === 'ci' && item.workflow_name?.includes(' - ')
      );
      ciJobs.sort((a, b) => a.startTime - b.startTime);
      ciJobs.forEach((item, index) => {
        item.level = index + 1; // Start at level 1 (level 0 is for main builds)
      });
    }

    return processed;
  }, [data, collapsedGroups, selectedBuildId]);

  // Calculate time domain
  const timeDomain = useMemo(
    () => calculateTimeDomain(processedData),
    [processedData]
  );

  useEffect(() => {
    if (!svgRef.current || processedData.length === 0) return;

    const actualWidth = containerWidth > 0 ? containerWidth : width;

    const svg = d3.select(svgRef.current);

    // Add keyboard event listeners for cursor change
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && svgRef.current) {
        svgRef.current.style.cursor = 'zoom-in';
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (!e.altKey && svgRef.current) {
        svgRef.current.style.cursor = 'default';
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    // Also handle blur to reset cursor when window loses focus
    window.addEventListener('blur', () => {
      if (svgRef.current) svgRef.current.style.cursor = 'default';
    });
    svg.selectAll('*').remove();

    const { margin } = TIMELINE_CONFIG;
    const innerWidth = actualWidth - margin.left - margin.right;

    // Calculate row heights
    const rowHeights = calculateRowHeights(
      data,
      processedData,
      collapsedGroups,
      {
        baseRowHeight: TIMELINE_CONFIG.baseRowHeight,
        levelHeight: TIMELINE_CONFIG.levelHeight,
        collapsedRowHeight: TIMELINE_CONFIG.collapsedRowHeight,
      }
    );
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
      .domain([new Date(timeDomain[0]), new Date(timeDomain[1])])
      .range([0, innerWidth]);

    // Create main group
    const g = svg
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Create background and foreground groups for z-ordering
    const bgGroup = g.append('g').attr('class', 'background-layer');
    const fgGroup = g.append('g').attr('class', 'foreground-layer');

    // Calculate initial zoom
    const initialTransform = calculateInitialZoom(
      processedData,
      zoomRange,
      xScale,
      actualWidth - margin.left - margin.right
    );

    const transformedXScale = initialTransform.rescaleX(xScale);

    // Compute nudges for point-in-time items
    const nudgeById = computeNudges(
      transformedXScale,
      processedData,
      TIMELINE_CONFIG.minPixelGap
    );

    // Calculate minimum scale and create zoom behavior
    const minScale = calculateMinScale(timeDomain, xScale, innerWidth);

    const zoom = createZoomBehavior(
      xScale,
      timeDomain,
      innerWidth,
      totalRowHeight,
      minScale,
      g,
      bgGroup,
      processedData,
      rowHeights,
      isDimmedRef,
      colorMode
    );

    // Apply zoom behavior
    svg.call(zoom);

    // Add brush selection overlay
    const brushGroup = svg.append('g').attr('class', 'brush-selection');
    const brushRect = brushGroup
      .append('rect')
      .attr('class', 'brush-rect')
      .attr(
        'fill',
        colorMode === 'DARK'
          ? 'rgba(100, 150, 255, 0.2)'
          : 'rgba(0, 100, 255, 0.2)'
      )
      .attr(
        'stroke',
        colorMode === 'DARK' ? 'rgb(100, 150, 255)' : 'rgb(0, 100, 255)'
      )
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '5,5')
      .style('display', 'none');

    // Add mouse handlers for brush selection (only when Command/Meta is held)
    let brushStartX: number | null = null;

    svg.on('mousedown', (event: MouseEvent) => {
      if (event.metaKey) {
        event.preventDefault();
        const [x] = d3.pointer(event);
        brushStartX = x;
        brushSelectionRef.current = { start: x, current: x };
        brushRect
          .style('display', null)
          .attr('x', x)
          .attr('y', margin.top)
          .attr('width', 0)
          .attr('height', totalRowHeight);
      }
    });

    svg.on('mousemove', (event: MouseEvent) => {
      if (brushStartX !== null && event.metaKey) {
        const [x] = d3.pointer(event);
        brushSelectionRef.current.current = x;
        const rectX = Math.min(brushStartX, x);
        const rectWidth = Math.abs(x - brushStartX);
        brushRect.attr('x', rectX).attr('width', rectWidth);
      }
    });

    svg.on('mouseup', (event: MouseEvent) => {
      if (brushStartX !== null && event.metaKey) {
        const [x] = d3.pointer(event);
        const startX = Math.min(brushStartX, x) - margin.left;
        const endX = Math.max(brushStartX, x) - margin.left;

        // Use the CURRENT zoom transform for accurate inversion
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const currentTransform = d3.zoomTransform(svg.node() as any);
        const currentXScale = currentTransform.rescaleX(xScale);

        // Convert pixel coordinates to time values using current scale
        const startTime = currentXScale.invert(startX);
        const endTime = currentXScale.invert(endX);

        // Only zoom if selection is significant (> 20 pixels)
        if (Math.abs(endX - startX) > 20 && onZoomRangeChange) {
          onZoomRangeChange([startTime, endTime]);
        }

        // Reset brush
        brushStartX = null;
        brushSelectionRef.current = { start: null, current: null };
        brushRect.style('display', 'none');
      }
    });

    // Hide brush if Ctrl is released while dragging
    svg.on('mouseleave', () => {
      if (brushStartX !== null) {
        brushStartX = null;
        brushSelectionRef.current = { start: null, current: null };
        brushRect.style('display', 'none');
      }
    });

    // Set initial zoom state
    if (zoomRange) {
      // Mark that we're transitioning
      isTransitioningRef.current = true;

      svg
        .transition()
        .duration(750)
        .ease(d3.easeCubicInOut)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .call(zoom.transform as any, initialTransform)
        .on('end', () => {
          // Mark transition as complete
          isTransitioningRef.current = false;
        });
    } else {
      svg.property('__zoom', initialTransform);
      isTransitioningRef.current = false;
    }

    // Calculate initial visibility settings
    const initialDomain = transformedXScale.domain();
    const initialVisibleTimeRange =
      initialDomain[1].getTime() - initialDomain[0].getTime();
    const initialVisibleDays = initialVisibleTimeRange / ONE_DAY_MS;
    const initialVisibility = calculateVisibility(initialVisibleDays);

    // Render hour grid lines
    if (initialVisibility.showHourGridLines) {
      renderHourGridLines(
        bgGroup,
        transformedXScale,
        totalRowHeight,
        colorMode
      );
    }

    // Calculate and render day ticks and separators
    const dayTicks = calculateInitialDayTicks(
      initialDomain as [Date, Date],
      initialVisibleDays
    );

    if (initialVisibility.showDaySeparators) {
      renderDaySeparators(
        bgGroup,
        transformedXScale,
        dayTicks,
        totalRowHeight,
        colorMode
      );
    }

    // Render timeline items
    const rectGroups = renderRectangleItems(
      fgGroup,
      processedData,
      transformedXScale,
      rowHeights,
      TIMELINE_CONFIG.levelHeight,
      TIMELINE_CONFIG.rectHeight,
      activeGroups,
      colorMode
    );

    const pointGroups = renderPointItems(
      fgGroup,
      processedData,
      transformedXScale,
      rowHeights,
      TIMELINE_CONFIG.levelHeight,
      TIMELINE_CONFIG.pointRadius,
      nudgeById,
      activeGroups
    );

    // Track if we're in dimmed mode
    if (activeGroups !== null) {
      isDimmedRef.current = true;
    }

    // Create tooltip
    const tooltip = createTooltip(colorMode);

    // Add event handlers
    addEventHandlers(
      rectGroups,
      tooltip,
      activeGroups,
      onBuildDoubleClick,
      isTransitioningRef
    );
    addEventHandlers(
      pointGroups,
      tooltip,
      activeGroups,
      onBuildDoubleClick,
      isTransitioningRef
    );

    // Render axes
    renderDayAxis(g, transformedXScale, dayTicks, colorMode);
    renderHourAxis(
      g,
      transformedXScale,
      initialVisibility.showHourAxis,
      colorMode
    );

    // Render group labels
    renderGroupLabels(
      g,
      data,
      rowHeights,
      collapsedGroups,
      setCollapsedGroups,
      margin,
      innerWidth,
      colorMode,
      onRowClick
    );

    // Cleanup
    return () => {
      d3.select('.d3-tooltip').remove();
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [
    data,
    processedData,
    timeDomain,
    containerWidth,
    width,
    height,
    colorMode,
    collapsedGroups,
    zoomRange,
    activeGroups,
    onBuildDoubleClick,
    onRowClick,
    onZoomRangeChange,
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
