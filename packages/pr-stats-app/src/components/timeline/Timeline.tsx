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
  filterCIItems,
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
import { createBrushSelection } from './utils/brush';
import { setupKeyboardHandlers } from './utils/interactions';

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
    const processed = processTimelineData(data, collapsedGroups);
    return filterCIItems(processed, selectedBuildId);
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

    // Setup keyboard event listeners for cursor change
    const cleanupKeyboardHandlers = setupKeyboardHandlers(svgRef.current);

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
    createBrushSelection(
      svg,
      margin,
      totalRowHeight,
      colorMode,
      xScale,
      onZoomRangeChange
    );

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
      cleanupKeyboardHandlers();
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
