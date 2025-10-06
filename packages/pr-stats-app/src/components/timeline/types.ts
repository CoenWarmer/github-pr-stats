import { TimelineData, TimelineItem } from '@/lib/types';

export interface D3TimelineProps {
  data: TimelineData;
  width?: number;
  height?: number;
  zoomRange?: [Date, Date] | null;
  activeGroups?: string[] | null;
}

export interface ProcessedTimelineItem extends TimelineItem {
  startTime: number;
  endTime: number;
  duration: number;
  level: number;
  groupIndex: number;
}

export interface TimelineConfig {
  margin: { top: number; right: number; bottom: number; left: number };
  baseRowHeight: number;
  levelHeight: number;
  collapsedRowHeight: number;
  pointRadius: number;
  minPixelGap: number;
  rectHeight: number;
}

export interface VisibilityConfig {
  showHourGridLines: boolean;
  showDaySeparators: boolean;
  showHourAxis: boolean;
  visibleDays: number;
}
