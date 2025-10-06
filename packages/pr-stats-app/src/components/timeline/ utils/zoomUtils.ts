import * as d3 from 'd3';
import { ProcessedTimelineItem } from '../types';
import { MIN_TIME_RANGE } from '../constants';

/**
 * Calculate zoom transform to fit events in viewport
 */
export function calculateInitialZoom(
  processedData: ProcessedTimelineItem[],
  zoomRange: [Date, Date] | null,
  xScale: d3.ScaleTime<number, number>,
  availableWidth: number
): d3.ZoomTransform {
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

  if (timeRange < MIN_TIME_RANGE) {
    const midpoint = (minEventTime + maxEventTime) / 2;
    minEventTime = midpoint - MIN_TIME_RANGE / 2;
    maxEventTime = midpoint + MIN_TIME_RANGE / 2;
  }

  // Add small padding (5% on each side)
  const adjustedTimeRange = maxEventTime - minEventTime;
  const padding = adjustedTimeRange * 0.05;
  const paddedMin = minEventTime - padding;
  const paddedMax = maxEventTime + padding;

  // Calculate the scale factor needed to fit the events
  const eventWidth = xScale(paddedMax) - xScale(paddedMin);
  const initialScale = availableWidth / eventWidth;

  // Calculate the translation to center the events
  const initialTranslateX = -xScale(paddedMin) * initialScale;

  // Create initial zoom transform
  return d3.zoomIdentity.translate(initialTranslateX, 0).scale(initialScale);
}

/**
 * Calculate minimum scale to prevent zooming out beyond data range
 */
export function calculateMinScale(
  timeDomain: [number, number],
  xScale: d3.ScaleTime<number, number>,
  innerWidth: number
): number {
  const fullDataWidth = xScale(timeDomain[1]) - xScale(timeDomain[0]);
  return innerWidth / fullDataWidth;
}

/**
 * Calculate visibility settings based on zoom level
 */
export function calculateVisibility(visibleDays: number) {
  return {
    showHourGridLines: visibleDays < 7,
    showDaySeparators: visibleDays > 2,
    showHourAxis: visibleDays < 7,
    visibleDays,
  };
}

/**
 * Filter day ticks based on zoom level
 */
export function filterDayTicks(
  allDayTicks: Date[],
  visibleDays: number
): Date[] {
  if (visibleDays > 60) {
    return allDayTicks.filter((d, i) => i % 7 === 0);
  } else if (visibleDays > 30) {
    return allDayTicks.filter((d, i) => i % 3 === 0);
  } else if (visibleDays > 14) {
    return allDayTicks.filter((d, i) => i % 2 === 0);
  }
  return allDayTicks;
}
