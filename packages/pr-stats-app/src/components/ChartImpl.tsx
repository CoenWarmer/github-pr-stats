'use client';

import React, {
  useMemo,
  useState,
  useEffect,
  useCallback,
  useRef,
} from 'react';
import { TimelineData } from '@/lib/types';
import { EuiBadge, EuiButtonGroup } from '@elastic/eui';

// Define our own types since we're not using dnd-timeline's hooks
interface Range {
  start: number;
  end: number;
}

interface RowDefinition {
  id: string;
}

interface TimelineProps {
  data: TimelineData;
  options?: Record<string, unknown>;
}

interface ItemDefinition {
  id: string;
  rowId: string;
  span: {
    start: number;
    end: number;
  };
}

type TimelineItemType = ItemDefinition & {
  content: string;
  githubUrl?: string;
  slackUrl?: string;
  color?: string;
};

function TimelineItemWithLevel({
  item,
  onClick,
  level,
  leftPixels,
  widthPixels,
}: {
  item: TimelineItemType;
  onClick: (item: TimelineItemType) => void;
  level: number;
  leftPixels: number;
  widthPixels: number;
}) {
  const topPosition = 10 + level * 35; // 10px top margin + 35px per level

  return (
    <div
      style={{
        position: 'absolute',
        left: '0',
        top: `${topPosition}px`,
        width: `${widthPixels}px`,
        height: '30px',
        transform: `translateX(${leftPixels}px)`,
        zIndex: 1,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
      }}
      onClick={() => onClick(item)}
    >
      <EuiBadge
        color={item.color || 'primary'}
        style={{
          maxWidth: '100%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {item.content}
      </EuiBadge>
    </div>
  );
}

function TimelineRow({
  row,
  items,
  onItemClick,
  timelineRange,
  zoomLevel,
  containerWidth,
}: {
  row: RowDefinition & { title: string };
  items: TimelineItemType[];
  onItemClick: (item: { githubUrl?: string; slackUrl?: string }) => void;
  timelineRange: Range;
  zoomLevel?: number;
  containerWidth: number;
}) {
  // Calculate collision-free positions for overlapping items
  const itemsWithLevels = useMemo(() => {
    const totalDuration = timelineRange.end - timelineRange.start;
    const timelineWidth = containerWidth - 150;

    // Safety check for invalid timelineRange
    if (
      !isFinite(totalDuration) ||
      totalDuration <= 0 ||
      !isFinite(timelineWidth) ||
      timelineWidth <= 0
    ) {
      console.warn(
        'Invalid timelineRange or containerWidth, returning empty items'
      );
      return { items: [], rowHeight: 60 };
    }

    // Calculate positions and sort by start time
    const itemsWithPositions = items
      .map(item => {
        const itemStart = item.span.start - timelineRange.start;
        const leftPercent = (itemStart / totalDuration) * 100;
        const leftPixels = (leftPercent / 100) * timelineWidth;
        const itemDuration = item.span.end - item.span.start;
        const widthPercent = (itemDuration / totalDuration) * 100;
        const widthPixels = Math.max(20, (widthPercent / 100) * timelineWidth); // Minimum 20px width

        return {
          ...item,
          leftPixels,
          widthPixels,
          startTime: item.span.start,
          endTime: item.span.end,
          level: 0, // Will be calculated below
        };
      })
      .sort((a, b) => a.startTime - b.startTime);

    // Assign levels to avoid overlaps
    const levels: Array<{ endTime: number }> = [];

    itemsWithPositions.forEach(item => {
      // Find the first level where this item doesn't overlap
      let level = 0;
      while (level < levels.length && levels[level].endTime > item.startTime) {
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

    const maxLevel = Math.max(0, ...itemsWithPositions.map(item => item.level));
    const rowHeight = Math.max(60, (maxLevel + 1) * 35 + 25); // 35px per level + 25px padding

    return { items: itemsWithPositions, rowHeight };
  }, [items, timelineRange, containerWidth]);

  return (
    <div
      style={{
        display: 'flex',
        width: '100%',
        minHeight: `${itemsWithLevels.rowHeight}px`,
        borderBottom: '1px solid #e5e7eb',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          width: '150px',
        }}
      >
        <span>{row.title}</span>
      </div>
      <div
        style={{
          position: 'relative',
          flex: 1,
          height: `${itemsWithLevels.rowHeight}px`,
          overflow: 'hidden',
        }}
        className="timeline-row-content"
      >
        {/* Grid lines are now rendered once for the entire timeline */}

        {itemsWithLevels.items.map(item => (
          <TimelineItemWithLevel
            key={item.id}
            item={item}
            onClick={onItemClick}
            level={item.level}
            leftPixels={item.leftPixels}
            widthPixels={item.widthPixels}
          />
        ))}
      </div>
    </div>
  );
}

function TimeAxisRow({
  timelineRange,
  zoomLevel,
  containerWidth,
}: {
  timelineRange: Range;
  zoomLevel?: number;
  containerWidth: number;
}) {
  // Generate time markers
  const markers = useMemo(() => {
    const totalDuration = timelineRange.end - timelineRange.start;

    // Determine appropriate interval based on duration and zoom level
    let intervalMs: number;
    let formatOptions: Intl.DateTimeFormatOptions;

    if (zoomLevel && zoomLevel >= 30) {
      // High zoom - show hourly markers with time
      intervalMs = 60 * 60 * 1000; // 1 hour
      formatOptions = {
        hour: '2-digit',
        minute: '2-digit',
        month: 'short',
        day: 'numeric',
        hour12: false,
      };
    } else if (totalDuration < 24 * 60 * 60 * 1000) {
      // Less than 24 hours - show every 2 hours
      intervalMs = 2 * 60 * 60 * 1000;
      formatOptions = {
        hour: '2-digit',
        minute: '2-digit',
        month: 'short',
        day: 'numeric',
      };
    } else if (totalDuration < 7 * 24 * 60 * 60 * 1000) {
      // Less than 7 days - show every 12 hours
      intervalMs = 12 * 60 * 60 * 1000;
      formatOptions = {
        hour: '2-digit',
        month: 'short',
        day: 'numeric',
      };
    } else {
      // More than 7 days - show daily
      intervalMs = 24 * 60 * 60 * 1000;
      formatOptions = {
        month: 'short',
        day: 'numeric',
      };
    }

    const timeMarkers = [];

    // Expand the time range to generate markers well outside the visible area
    const expandedDuration = totalDuration * 3; // 3x the visible duration
    const expandedStart = timelineRange.start - expandedDuration;
    const expandedEnd = timelineRange.end + expandedDuration;

    let currentTime = Math.ceil(expandedStart / intervalMs) * intervalMs;

    while (currentTime <= expandedEnd) {
      const leftPercent =
        ((currentTime - timelineRange.start) / totalDuration) * 100;
      // Include markers that are well outside the visible area for smooth scrolling
      if (leftPercent >= -300 && leftPercent <= 400) {
        timeMarkers.push({
          time: currentTime,
          leftPercent: leftPercent, // Don't clamp - let markers scroll naturally
          label: new Date(currentTime).toLocaleDateString(
            'en-US',
            formatOptions
          ),
        });
      }
      currentTime += intervalMs;
    }

    return timeMarkers;
  }, [timelineRange, zoomLevel]);

  return (
    <div
      style={{
        display: 'flex',
        width: '100%',
        minHeight: '40px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          width: '150px',
        }}
      ></div>
      <div
        style={{
          position: 'relative',
          flex: 1,
          height: '40px',
          overflowX: 'hidden', // Allow horizontal overflow for time markers
          overflowY: 'hidden', // Keep vertical clipping
        }}
      >
        {/* Grid lines are now rendered once for the entire timeline */}

        {markers.map((marker, index) => {
          // Calculate pixel position for translateX (subtract 150px for sidebar)
          const timelineWidth = containerWidth - 150;
          const leftPixels = (marker.leftPercent / 100) * timelineWidth;

          return (
            <div
              key={index}
              style={{
                position: 'absolute',
                left: '0',
                top: '0',
                height: '100%',
                paddingLeft: '4px',
                display: 'flex',
                alignItems: 'center',
                transform: `translateX(${leftPixels}px)`,
              }}
            >
              <span>{marker.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GlobalVerticalGridLines({
  timelineRange,
  zoomLevel,
  containerWidth,
}: {
  timelineRange: Range;
  zoomLevel?: number;
  containerWidth: number;
}) {
  const gridLines = useMemo(() => {
    const totalDuration = timelineRange.end - timelineRange.start;

    // Determine appropriate interval based on duration and zoom level
    let intervalMs: number;
    let showMinorLines = false;
    let minorIntervalMs = 0;

    if (zoomLevel && zoomLevel >= 50) {
      // Ultra high zoom - show hourly grid lines + 5-minute minor lines
      intervalMs = 60 * 60 * 1000; // 1 hour
      minorIntervalMs = 5 * 60 * 1000; // 5 minutes
      showMinorLines = true;
    } else if (zoomLevel && zoomLevel >= 30) {
      // High zoom - show hourly grid lines + 15-minute minor lines
      intervalMs = 60 * 60 * 1000; // 1 hour
      minorIntervalMs = 15 * 60 * 1000; // 15 minutes
      showMinorLines = true;
    } else if (totalDuration < 24 * 60 * 60 * 1000) {
      // Less than 24 hours - show every 2 hours
      intervalMs = 2 * 60 * 60 * 1000;
    } else if (totalDuration < 7 * 24 * 60 * 60 * 1000) {
      // Less than 7 days - show every 12 hours
      intervalMs = 12 * 60 * 60 * 1000;
    } else {
      // More than 7 days - show daily
      intervalMs = 24 * 60 * 60 * 1000;
    }

    const gridLines = [];

    // Generate expanded time range for grid lines
    const expandedDuration = totalDuration * 3;
    const expandedStart = timelineRange.start - expandedDuration;
    const expandedEnd = timelineRange.end + expandedDuration;

    let currentTime = Math.ceil(expandedStart / intervalMs) * intervalMs;

    // Add major grid lines (hours/days)
    while (currentTime <= expandedEnd) {
      const leftPercent =
        ((currentTime - timelineRange.start) / totalDuration) * 100;
      // Include lines that are well outside the visible area for smooth panning
      if (leftPercent >= -300 && leftPercent <= 400) {
        gridLines.push({
          leftPercent,
          isMajor: true,
        });
      }
      currentTime += intervalMs;
    }

    // Add minor grid lines (15-minute or 5-minute intervals) when zoomed in
    if (showMinorLines && minorIntervalMs > 0) {
      let minorCurrentTime =
        Math.ceil(expandedStart / minorIntervalMs) * minorIntervalMs;

      while (minorCurrentTime <= expandedEnd) {
        const leftPercent =
          ((minorCurrentTime - timelineRange.start) / totalDuration) * 100;

        // Only add if it's not already a major line (not on the hour)
        const isOnHour = minorCurrentTime % (60 * 60 * 1000) === 0;

        if (!isOnHour && leftPercent >= -300 && leftPercent <= 400) {
          gridLines.push({
            leftPercent,
            isMajor: false,
          });
        }
        minorCurrentTime += minorIntervalMs;
      }
    }

    return gridLines;
  }, [timelineRange, zoomLevel]);

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: '150px', // Start after the row labels
        right: 0,
        pointerEvents: 'none',
        zIndex: 0, // Behind timeline items
      }}
    >
      {gridLines.map((line, index) => {
        // Calculate pixel position for translateX
        const timelineWidth = containerWidth - 150;
        const leftPixels = (line.leftPercent / 100) * timelineWidth;

        return (
          <div
            key={index}
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: '0',
              width: '1px',
              backgroundColor: line.isMajor ? '#d1d5db' : '#e5e7eb',
              opacity: line.isMajor ? 0.7 : 0.4,
              pointerEvents: 'none',
              transform: `translateX(${leftPixels}px)`,
            }}
          />
        );
      })}
    </div>
  );
}

export default function Chart({ data }: TimelineProps) {
  // Calculate the full time range from the data
  const fullRange = useMemo(() => {
    const times = data.items
      .filter(item => item.start) // Only include items with start times
      .flatMap(item => {
        const startTime = new Date(item.start).getTime();
        const endTime = item.end
          ? new Date(item.end).getTime()
          : new Date(item.start).getTime() + 30 * 60 * 1000;

        return [startTime, endTime];
      })
      .filter(time => isFinite(time)); // Filter out any NaN times

    if (times.length === 0) {
      console.warn('No valid timestamps found in data');
      const now = Date.now();
      return { start: now - 24 * 60 * 60 * 1000, end: now };
    }

    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);

    // Add 5 days padding (5 * 24 * 60 * 60 * 1000 milliseconds)
    const fiveDaysInMs = 5 * 24 * 60 * 60 * 1000;

    return {
      start: minTime - fiveDaysInMs,
      end: maxTime + fiveDaysInMs,
    };
  }, [data]);

  const [timelineRange, setTimelineRange] = useState<Range>(fullRange);
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{
    x: number;
    y: number;
    timelineStart: number;
    timelineEnd: number;
    scrollTop: number;
  } | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>(800); // Default width
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollableRef = useRef<HTMLDivElement>(null);

  // Measure container width
  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        const width = containerRef.current.getBoundingClientRect().width;
        setContainerWidth(width);
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

  // Calculate the optimal initial range (events + small padding)
  const initialRange = useMemo(() => {
    const times = data.items
      .filter(item => item.start) // Only include items with start times
      .flatMap(item => [
        new Date(item.start).getTime(),
        item.end
          ? new Date(item.end).getTime()
          : new Date(item.start).getTime() + 30 * 60 * 1000,
      ])
      .filter(time => isFinite(time)); // Filter out any NaN times

    if (times.length === 0) {
      return fullRange;
    }

    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);

    // Add 12 hours padding on each side for the initial view (much less than 5 days)
    const twelvehours = 12 * 60 * 60 * 1000;

    return {
      start: Math.max(fullRange.start, minTime - twelvehours),
      end: Math.min(fullRange.end, maxTime + twelvehours),
    };
  }, [data, fullRange]);

  // Update range when data changes - zoom to fit events initially
  useEffect(() => {
    setTimelineRange(initialRange);

    // Calculate the zoom level based on how much we're zoomed in compared to full range
    const fullDuration = fullRange.end - fullRange.start;
    const initialDuration = initialRange.end - initialRange.start;
    const calculatedZoomLevel = fullDuration / initialDuration;

    setZoomLevel(calculatedZoomLevel);
  }, [fullRange, initialRange]);

  // Zoom functionality
  const handleZoom = useCallback(
    (zoomFactor: number, centerPercent: number = 0.5) => {
      // Check zoom limits before applying
      const newZoomLevel = zoomLevel * zoomFactor;
      const clampedZoomLevel = Math.max(0.1, Math.min(100, newZoomLevel));

      // If we're at the limits, don't zoom further
      if (clampedZoomLevel === zoomLevel) {
        return;
      }

      // Use the actual zoom factor based on clamped zoom level
      const actualZoomFactor = clampedZoomLevel / zoomLevel;

      const currentDuration = timelineRange.end - timelineRange.start;
      const newDuration = currentDuration / actualZoomFactor;

      // Calculate the center point
      const centerTime = timelineRange.start + currentDuration * centerPercent;

      // Calculate new start and end times
      const newStart = centerTime - newDuration * centerPercent;
      const newEnd = centerTime + newDuration * (1 - centerPercent);

      // Clamp to full range bounds
      const clampedStart = Math.max(fullRange.start, newStart);
      const clampedEnd = Math.min(fullRange.end, newEnd);

      setTimelineRange({ start: clampedStart, end: clampedEnd });
      setZoomLevel(clampedZoomLevel);
    },
    [timelineRange, fullRange, zoomLevel]
  );

  const handlePan = useCallback(
    (direction: 'left' | 'right', panPercent: number = 0.2) => {
      const currentDuration = timelineRange.end - timelineRange.start;
      const panAmount = currentDuration * panPercent;

      let newStart = timelineRange.start;
      let newEnd = timelineRange.end;

      if (direction === 'left') {
        newStart = Math.max(fullRange.start, timelineRange.start - panAmount);
        newEnd = newStart + currentDuration;
      } else {
        newEnd = Math.min(fullRange.end, timelineRange.end + panAmount);
        newStart = newEnd - currentDuration;
      }

      // Ensure we don't go beyond bounds
      if (newStart < fullRange.start) {
        newStart = fullRange.start;
        newEnd = Math.min(fullRange.end, newStart + currentDuration);
      }
      if (newEnd > fullRange.end) {
        newEnd = fullRange.end;
        newStart = Math.max(fullRange.start, newEnd - currentDuration);
      }

      setTimelineRange({ start: newStart, end: newEnd });
    },
    [timelineRange, fullRange]
  );

  const resetZoom = useCallback(() => {
    setTimelineRange(initialRange);

    // Calculate the zoom level for the initial range
    const fullDuration = fullRange.end - fullRange.start;
    const initialDuration = initialRange.end - initialRange.start;
    const calculatedZoomLevel = fullDuration / initialDuration;

    setZoomLevel(calculatedZoomLevel);
  }, [fullRange, initialRange]);

  const showAll = useCallback(() => {
    setTimelineRange(fullRange);
    setZoomLevel(1);
  }, [fullRange]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target !== document.body) return; // Only handle when not in input fields

      switch (e.key) {
        case '+':
        case '=':
          e.preventDefault();
          handleZoom(1.5);
          break;
        case '-':
          e.preventDefault();
          handleZoom(0.67);
          break;
        case '0':
          e.preventDefault();
          resetZoom(); // Fit events
          break;
        case '9':
          e.preventDefault();
          showAll(); // Show all (full padded range)
          break;
        case 'ArrowLeft':
          e.preventDefault();
          handlePan('left');
          break;
        case 'ArrowRight':
          e.preventDefault();
          handlePan('right');
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleZoom, handlePan, resetZoom, showAll]);

  // Global mouse event listeners for drag functionality
  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!isDragging || !dragStart) {
        return;
      }

      // Use the containerRef to calculate relative positions
      if (!containerRef.current || !scrollableRef.current) {
        return;
      }

      const rect = containerRef.current.getBoundingClientRect();
      const deltaX = e.clientX - dragStart.x;
      const deltaY = e.clientY - dragStart.y;
      const timelineWidth = rect.width - 150; // Subtract sidebar width

      // Handle horizontal panning (timeline)
      const currentDuration = dragStart.timelineEnd - dragStart.timelineStart;
      const timeDelta = (deltaX / timelineWidth) * currentDuration;

      // Calculate new start and end times (inverted because dragging right should move timeline left)
      let newStart = dragStart.timelineStart - timeDelta;
      let newEnd = dragStart.timelineEnd - timeDelta;

      // Clamp to full range bounds
      if (newStart < fullRange.start) {
        const diff = fullRange.start - newStart;
        newStart = fullRange.start;
        newEnd += diff;
      }
      if (newEnd > fullRange.end) {
        const diff = newEnd - fullRange.end;
        newEnd = fullRange.end;
        newStart -= diff;
      }

      // Final clamp to ensure we don't exceed bounds
      newStart = Math.max(fullRange.start, newStart);
      newEnd = Math.min(fullRange.end, newEnd);

      setTimelineRange({ start: newStart, end: newEnd });

      // Handle vertical scrolling
      const newScrollTop = dragStart.scrollTop - deltaY;
      const maxScrollTop =
        scrollableRef.current.scrollHeight - scrollableRef.current.clientHeight;
      const clampedScrollTop = Math.max(
        0,
        Math.min(maxScrollTop, newScrollTop)
      );

      scrollableRef.current.scrollTop = clampedScrollTop;
    };

    const handleGlobalMouseUp = () => {
      setIsDragging(false);
      setDragStart(null);
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleGlobalMouseMove);
      document.addEventListener('mouseup', handleGlobalMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove);
      document.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isDragging, dragStart, fullRange]);

  // Mouse wheel zoom handler
  const handleWheel = (e: React.WheelEvent) => {
    // Don't interfere with wheel events while dragging
    if (isDragging) {
      return;
    }

    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const timelineWidth = rect.width - 150; // Subtract sidebar width

    // Calculate center percent more precisely
    // Ensure we're only considering the timeline area (after the 150px sidebar)
    const timelineMouseX = mouseX - 150; // Mouse position relative to timeline start
    const centerPercent = Math.max(
      0,
      Math.min(1, timelineMouseX / timelineWidth)
    );

    const zoomFactor = e.deltaY > 0 ? 0.8 : 1.25; // Zoom out or in
    handleZoom(zoomFactor, centerPercent);
  };

  // Mouse drag handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Don't start dragging if clicking on interactive elements (buttons, badges, etc.)
      const target = e.target as HTMLElement;
      const isInteractiveElement =
        target.tagName === 'BUTTON' ||
        target.closest('button') ||
        target.closest('[role="button"]') ||
        target.closest('.euiBadge') ||
        target.closest('.EuiBadge');

      if (!isInteractiveElement && scrollableRef.current) {
        e.preventDefault();
        setIsDragging(true);
        setDragStart({
          x: e.clientX,
          y: e.clientY,
          timelineStart: timelineRange.start,
          timelineEnd: timelineRange.end,
          scrollTop: scrollableRef.current.scrollTop,
        });
      }
    },
    [timelineRange]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      // Mouse move is handled by global listeners when dragging
      if (isDragging) {
        e.preventDefault();
      }
    },
    [isDragging]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setDragStart(null);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsDragging(false);
    setDragStart(null);
  }, []);

  // Transform data to dnd-timeline format
  const { items, rows } = useMemo(() => {
    const items: TimelineItemType[] = data.items.map(item => {
      const startTime = new Date(item.start).getTime();
      let endTime: number;

      if (item.end) {
        endTime = new Date(item.end).getTime();
        // For very short CI jobs, ensure minimum 5-minute visibility
        const duration = endTime - startTime;
        if (duration < 5 * 60 * 1000) {
          // Less than 5 minutes
          endTime = startTime + 5 * 60 * 1000; // Make it 5 minutes for visibility
        }
      } else {
        // Default 30 minutes for point-in-time events
        endTime = startTime + 30 * 60 * 1000;
      }

      return {
        id: item.id,
        rowId: item.group,
        span: {
          start: startTime,
          end: endTime,
        },
        content: item.content,
        githubUrl: item.githubUrl as string,
        slackUrl: item.slackUrl as string,
        color: item.color,
      };
    });

    const rows: (RowDefinition & { title: string })[] = data.groups.map(
      group => ({
        id: group.id,
        title: group.content,
      })
    );

    return { items, rows };
  }, [data]);

  const handleItemClick = (item: { githubUrl?: string; slackUrl?: string }) => {
    if (item.githubUrl) {
      window.open(item.githubUrl, '_blank');
    } else if (item.slackUrl) {
      window.open(item.slackUrl, '_blank');
    }
  };

  // No longer needed since we're not using dnd-timeline context

  // Debug logging
  console.log('Chart Debug:', {
    timelineRange,
    totalItems: items.length,
    totalRows: rows.length,
    sampleItem: items[0],
    sampleSpan: items[0]?.span,
  });

  return (
    <div
      ref={containerRef}
      className="timeline-container"
      style={{
        width: '100%',
        height: '100%',
        // minHeight: '400px',
        // border: '1px solid #d1d5db',
        // borderRadius: '8px',
        overflow: 'hidden',
      }}
    >
      {/* Zoom Controls */}

      <EuiButtonGroup
        legend="Timeline controls"
        type="multi"
        options={[
          {
            id: `zoomIn`,
            label: 'Zoom In',
            iconType: 'plusInCircleFilled',
            isDisabled: zoomLevel >= 100,
          },
          {
            id: `zoomOut`,
            label: 'Zoom Out',
            iconType: 'minusInCircleFilled',
            isDisabled: zoomLevel <= 0.1,
          },
          {
            id: `fitEvents`,
            label: 'Fit Events',
            iconType: 'bullseye',
          },
          {
            id: `showAll`,
            label: 'Show All',
            iconType: 'timeline',
          },
        ]}
        onChange={id => {
          if (id === 'zoomIn') {
            handleZoom(1.5);
          } else if (id === 'zoomOut') {
            handleZoom(0.67);
          } else if (id === 'fitEvents') {
            resetZoom();
          } else if (id === 'showAll') {
            showAll();
          }
        }}
        isIconOnly
      />
      <div>
        <span>Zoom: {zoomLevel.toFixed(2)}x</span>
        <span> (Limits: 0.1x - 100x)</span>
      </div>

      {/* Timeline Content */}
      <div
        ref={scrollableRef}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        style={{
          height: '440px',
          display: 'flex',
          flexDirection: 'column',
          cursor: isDragging ? 'grabbing' : 'grab',
          userSelect: 'none', // Prevent text selection while dragging
          overflowX: 'visible', // Allow horizontal overflow for time markers
          overflowY: 'auto', // Keep vertical scrolling
          position: 'relative', // For absolute positioning of grid lines
        }}
      >
        {/* Global Vertical Grid Lines - rendered once for entire timeline */}
        <GlobalVerticalGridLines
          timelineRange={timelineRange}
          zoomLevel={zoomLevel}
          containerWidth={containerWidth}
        />

        {/* Time Axis Row */}
        <TimeAxisRow
          timelineRange={timelineRange}
          zoomLevel={zoomLevel}
          containerWidth={containerWidth}
        />

        {/* Timeline Rows */}
        {rows.map(row => {
          const rowItems = items.filter(item => item.rowId === row.id);
          return (
            <TimelineRow
              key={row.id}
              row={row}
              items={rowItems}
              onItemClick={handleItemClick}
              timelineRange={timelineRange}
              zoomLevel={zoomLevel}
              containerWidth={containerWidth}
            />
          );
        })}
      </div>
    </div>
  );
}
