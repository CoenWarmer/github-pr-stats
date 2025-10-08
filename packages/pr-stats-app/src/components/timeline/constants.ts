import { TimelineConfig } from './types';

export const TIMELINE_CONFIG: TimelineConfig = {
  margin: { top: 100, right: 40, bottom: 40, left: 200 },
  baseRowHeight: 17,
  levelHeight: 25,
  collapsedRowHeight: 42,
  pointRadius: 12,
  minPixelGap: 24, // pointRadius * 2
  rectHeight: 1,
};

export const ONE_DAY_MS = 24 * 60 * 60 * 1000;
export const MIN_TIME_RANGE = 60 * 60 * 1000; // 1 hour minimum
