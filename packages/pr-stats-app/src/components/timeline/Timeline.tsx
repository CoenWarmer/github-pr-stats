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
import { getOrCreateTooltip } from './utils/rendering';
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

  const tooltipRef = useRef<d3.Selection<
    HTMLDivElement,
    unknown,
    HTMLElement,
    any
  > | null>(null);

  // Store callbacks in refs to avoid triggering effect when they change
  const onBuildDoubleClickRef = useRef(onBuildDoubleClick);
  const onRowClickRef = useRef(onRowClick);
  const onZoomRangeChangeRef = useRef(onZoomRangeChange);

  // Update refs when callbacks change (doesn't trigger effect)
  useEffect(() => {
    onBuildDoubleClickRef.current = onBuildDoubleClick;
    onRowClickRef.current = onRowClick;
    onZoomRangeChangeRef.current = onZoomRangeChange;
  }, [onBuildDoubleClick, onRowClick, onZoomRangeChange]);

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

    // Interrupt any ongoing transitions on the SVG before clearing
    svg.interrupt();

    // Reset transition state (interrupt callback might not always fire)
    isTransitioningRef.current = false;

    // Clear all child elements
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
      onZoomRangeChangeRef.current
    );

    // Track safety timeout for cleanup
    let safetyTimeout: NodeJS.Timeout | null = null;

    // Set initial zoom state
    if (zoomRange) {
      // Mark that we're transitioning
      isTransitioningRef.current = true;

      // Safety timeout to ensure transition state is reset even if callbacks don't fire
      safetyTimeout = setTimeout(() => {
        isTransitioningRef.current = false;
      }, 1000); // 750ms transition + 250ms buffer

      svg
        .transition()
        .duration(750)
        .ease(d3.easeCubicInOut)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .call(zoom.transform as any, initialTransform)
        .on('end', () => {
          // Mark transition as complete
          if (safetyTimeout) clearTimeout(safetyTimeout);
          isTransitioningRef.current = false;
        })
        .on('interrupt', () => {
          // Also reset if transition is interrupted
          if (safetyTimeout) clearTimeout(safetyTimeout);
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

    // Track if we're in dimmed mode - update based on current activeGroups
    isDimmedRef.current = activeGroups !== null;

    // Create or reuse tooltip
    const tooltip = getOrCreateTooltip(tooltipRef, colorMode);

    // Add event handlers
    addEventHandlers(
      rectGroups,
      tooltip,
      activeGroups,
      onBuildDoubleClickRef.current,
      isTransitioningRef
    );
    addEventHandlers(
      pointGroups,
      tooltip,
      activeGroups,
      onBuildDoubleClickRef.current,
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
      onRowClickRef.current
    );

    // Cleanup
    return () => {
      if (safetyTimeout) clearTimeout(safetyTimeout);
      // Don't remove tooltip - we reuse it across renders
      // Hide it instead
      if (tooltipRef.current) {
        tooltipRef.current.style('opacity', 0);
      }
      cleanupKeyboardHandlers();
      // Reset transition state on cleanup
      isTransitioningRef.current = false;
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
    // Callbacks are handled via refs to avoid re-renders
  ]);

  // Cleanup tooltip on component unmount
  useEffect(() => {
    return () => {
      if (tooltipRef.current) {
        tooltipRef.current.remove();
        tooltipRef.current = null;
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        overflowX: 'auto',
        overflowY: 'auto',
        borderRadius: '8px',
      }}
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
