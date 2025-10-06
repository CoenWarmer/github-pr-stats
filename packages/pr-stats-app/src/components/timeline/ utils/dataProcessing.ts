import { TimelineData } from '@/lib/types';
import { ProcessedTimelineItem } from '../types';

/**
 * Process timeline data into a format suitable for D3 rendering
 */
export function processTimelineData(
  data: TimelineData,
  collapsedGroups: Set<string>
): ProcessedTimelineItem[] {
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

  // All items in the same row/group will be at level 0 (no vertical stacking)
  items.forEach(item => {
    item.level = 0;
  });

  return items;
}

/**
 * Calculate the time domain for the timeline
 */
export function calculateTimeDomain(
  processedData: ProcessedTimelineItem[]
): [number, number] {
  const times = processedData.flatMap(item => [item.startTime, item.endTime]);
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const oneDayInMs = 24 * 60 * 60 * 1000;

  return [minTime - oneDayInMs, maxTime + oneDayInMs];
}

/**
 * Calculate row heights based on group configuration
 */
export function calculateRowHeights(
  data: TimelineData,
  processedData: ProcessedTimelineItem[],
  collapsedGroups: Set<string>,
  config: {
    baseRowHeight: number;
    levelHeight: number;
    collapsedRowHeight: number;
  }
): number[] {
  const groupMaxLevels = new Map<string, number>();
  processedData.forEach(item => {
    const currentMax = groupMaxLevels.get(item.group) || 0;
    groupMaxLevels.set(item.group, Math.max(currentMax, item.level + 1));
  });

  return data.groups.map(group => {
    if (collapsedGroups.has(group.id)) {
      return config.collapsedRowHeight;
    }
    return (
      config.baseRowHeight +
      (groupMaxLevels.get(group.id) || 1) * config.levelHeight
    );
  });
}

/**
 * Compute pixel nudges for overlapping point-in-time items
 */
export function computeNudges(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scale: any,
  processedData: ProcessedTimelineItem[],
  minPixelGap: number
): Map<string, number> {
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
    if (x - lastX < minPixelGap) {
      const delta = minPixelGap - (x - lastX);
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
}
