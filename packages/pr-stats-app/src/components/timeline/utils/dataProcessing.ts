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

  // Calculate levels (vertical stacking) for items within each group
  const groupItems = new Map<string, ProcessedTimelineItem[]>();

  // Group items by their group ID
  items.forEach(item => {
    if (!groupItems.has(item.group)) {
      groupItems.set(item.group, []);
    }
    groupItems.get(item.group)!.push(item);
  });

  // For each group, calculate levels based on time overlap
  groupItems.forEach((groupItemsList, groupId) => {
    // For CI group, enable vertical stacking for job items only
    if (groupId === 'ci') {
      // Separate main builds and jobs
      const jobItems = groupItemsList.filter(item =>
        item.workflow_name?.includes(' - ')
      );
      const mainBuildItems = groupItemsList.filter(
        item => !item.workflow_name?.includes(' - ')
      );

      // Main builds stay at level 0
      mainBuildItems.forEach(item => {
        item.level = 0;
      });

      // Jobs are stacked based on chronological order (earliest on top)
      jobItems.sort((a, b) => a.startTime - b.startTime);
      jobItems.forEach((item, index) => {
        item.level = index + 1; // Start at level 1 (level 0 is for main builds)
      });
    } else {
      // For all other groups, no vertical stacking (level 0)
      groupItemsList.forEach(item => {
        item.level = 0;
      });
    }
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
 * Filter CI items based on selected build and reassign levels for jobs
 */
export function filterCIItems(
  processedData: ProcessedTimelineItem[],
  selectedBuildId: string | null
): ProcessedTimelineItem[] {
  // Filter CI items based on whether a build is selected
  const filtered = processedData.filter(item => {
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
    const ciJobs = filtered.filter(
      item => item.group === 'ci' && item.workflow_name?.includes(' - ')
    );
    ciJobs.sort((a, b) => a.startTime - b.startTime);
    ciJobs.forEach((item, index) => {
      item.level = index + 1; // Start at level 1 (level 0 is for main builds)
    });
  }

  return filtered;
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
