import * as d3 from 'd3';
import { ProcessedTimelineItem } from '../types';
import { ONE_DAY_MS, TIMELINE_CONFIG } from '../constants';
import { calculateVisibility, filterDayTicks } from './zoomUtils';
import { computeNudges } from './dataProcessing';
import { getItemY } from './items';

/**
 * Create zoom behavior with appropriate constraints
 */
export function createZoomBehavior(
  xScale: d3.ScaleTime<number, number>,
  timeDomain: [number, number],
  innerWidth: number,
  totalRowHeight: number,
  minScale: number,
  g: d3.Selection<SVGGElement, unknown, null, undefined>,
  bgGroup: d3.Selection<SVGGElement, unknown, null, undefined>,
  processedData: ProcessedTimelineItem[],
  rowHeights: number[],
  isDimmedRef: React.MutableRefObject<boolean>,
  colorMode: 'LIGHT' | 'DARK'
): d3.ZoomBehavior<SVGSVGElement, unknown> {
  let nudgeById = new Map<string, number>();

  return d3
    .zoom<SVGSVGElement, unknown>()
    .filter(event => {
      // Allow panning with mouse drag (no modifier key needed)
      // Only allow zooming (wheel events) when Alt/Option key is held
      if (event.type === 'wheel') {
        if (!event.altKey) return false;
        // Ignore wheel zooms when hovering tooltip to avoid odd centers
        const target = event.target as Element | null;
        if (target && target.closest('.d3-tooltip')) return false;
        return true;
      }
      // Allow all other events (drag, touch, etc.).
      // When Command/Meta is held (used for brushing), ignore zoom/pan.
      return !event.metaKey && !event.button;
    })
    .scaleExtent([minScale * 0.9, 1000])
    .extent([
      [0, 0],
      [innerWidth, totalRowHeight],
    ])
    .translateExtent([
      [xScale(timeDomain[0]), 0],
      [xScale(timeDomain[1]), totalRowHeight],
    ])
    .on('start', event => {
      // Reset opacity when user starts interacting (only for actual pan/zoom, not hover)
      if (isDimmedRef.current && event.sourceEvent) {
        const sourceEventType = event.sourceEvent.type;
        // Only reset for actual pan/zoom gestures (wheel, mousedown, touchstart)
        if (
          sourceEventType === 'wheel' ||
          sourceEventType === 'mousedown' ||
          sourceEventType === 'touchstart'
        ) {
          isDimmedRef.current = false;
          // Reset all items to full opacity
          g.selectAll('.timeline-rect').attr('opacity', 0.9);
          g.selectAll('.timeline-circle').attr('opacity', 0.9);
        }
      }
    })
    .on('zoom', event => {
      const { transform } = event;

      // Update x scale with zoom transform
      const newXScale = transform.rescaleX(xScale);

      // Update timeline items
      g.selectAll<SVGElement, ProcessedTimelineItem>('.timeline-item').each(
        function (d) {
          const element = d3.select(this);
          if (d.isPointInTime) {
            // Recompute nudges at current zoom
            nudgeById = computeNudges(
              newXScale,
              processedData,
              TIMELINE_CONFIG.minPixelGap
            );
            // Move grouped point marker via transform
            const circleHeight = TIMELINE_CONFIG.pointRadius * 2;
            element.attr(
              'transform',
              `translate(${newXScale(d.startTime) + (nudgeById.get(d.id) || 0)}, ${getItemY(d, rowHeights, TIMELINE_CONFIG.levelHeight, circleHeight) + TIMELINE_CONFIG.pointRadius})`
            );
          } else {
            // Update grouped rectangles
            const barWidth = Math.max(
              2,
              newXScale(d.endTime) - newXScale(d.startTime)
            );
            element
              .select('rect')
              .attr('x', newXScale(d.startTime))
              .attr('width', barWidth);

            // Update text labels - position depends on event type
            const isCiEvent =
              d.eventType === 'ci_run' ||
              d.eventType === 'ci_started' ||
              d.eventType === 'ci_completed';

            if (isCiEvent) {
              // CI events: update foreignObject position and width
              element
                .select('foreignObject')
                .attr('x', newXScale(d.startTime) + 5)
                .attr('width', Math.max(0, barWidth - 10));
            } else {
              // Other events: update text position
              element.select('text').attr('x', newXScale(d.endTime) + 20);
            }
          }
        }
      );

      // Calculate visibility settings
      const domain = newXScale.domain();
      const visibleTimeRange = domain[1].getTime() - domain[0].getTime();
      const visibleDays = visibleTimeRange / ONE_DAY_MS;
      const visibility = calculateVisibility(visibleDays);

      // Update hour grid lines with adaptive intervals based on zoom level
      let timeInterval: d3.CountableTimeInterval;
      if (visibility.visibleDays < 0.5) {
        // Extremely zoomed in: show 30-minute intervals
        timeInterval = d3.timeMinute.every(30)!;
      } else if (visibility.visibleDays < 1) {
        // Very zoomed in: show hourly intervals
        timeInterval = d3.timeHour.every(1)!;
      } else if (visibility.visibleDays < 3) {
        timeInterval = d3.timeHour.every(2)!;
      } else if (visibility.visibleDays < 5) {
        timeInterval = d3.timeHour.every(4)!;
      } else {
        timeInterval = d3.timeHour.every(6)!;
      }

      const newHourTicks = visibility.showHourGridLines
        ? newXScale.ticks(timeInterval)
        : [];
      const hourGridLines = bgGroup
        .selectAll('.hour-grid-line')
        .data(newHourTicks);

      hourGridLines.exit().remove();

      hourGridLines
        .enter()
        .append('line')
        .attr('class', 'hour-grid-line')
        .attr('y1', 0)
        .attr('y2', totalRowHeight)
        .attr('stroke', colorMode === 'DARK' ? '#222' : '#eee')
        .attr('stroke-width', 1)
        .attr('opacity', 0.6)
        .merge(hourGridLines)
        .attr('x1', d => newXScale(d))
        .attr('x2', d => newXScale(d));

      // Update day separators
      const allNewDayTicks = d3.timeDay.range(
        d3.timeDay.floor(new Date(timeDomain[0])),
        d3.timeDay.ceil(new Date(timeDomain[1]))
      );

      const filteredDayTicks = filterDayTicks(allNewDayTicks, visibleDays);

      const newDayTicks = filteredDayTicks.filter(
        d =>
          d.getTime() >= domain[0].getTime() &&
          d.getTime() <= domain[1].getTime()
      );

      const daySeps = bgGroup
        .selectAll('.day-separator')
        .data(visibility.showDaySeparators ? newDayTicks : []);

      daySeps.exit().remove();

      daySeps
        .enter()
        .append('line')
        .attr('class', 'day-separator')
        .attr('y1', -20)
        .attr('y2', totalRowHeight)
        .attr('stroke', colorMode === 'DARK' ? '#2B394F' : '#ddd')
        .attr('stroke-width', 1)
        .attr('opacity', 0.7)
        .merge(daySeps)
        .attr('x1', d => newXScale(d))
        .attr('x2', d => newXScale(d));

      // Update axes
      const newDayAxis = d3
        .axisTop(newXScale)
        .tickValues(newDayTicks)
        .tickFormat(
          d3.timeFormat('%a %m/%d') as (date: Date | d3.NumberValue) => string
        )
        .tickSize(5);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      g.select('.day-axis').call(newDayAxis as any);
      g.select('.day-axis')
        .selectAll('text')
        .attr('fill', colorMode === 'DARK' ? '#fff' : '#000')
        .attr('font-size', '12px')
        .attr('font-weight', 'bold');

      // Update hour axis
      if (visibility.showHourAxis) {
        // Use adaptive interval for hour axis labels (same logic as grid lines)
        let axisTimeInterval: d3.CountableTimeInterval;
        if (visibility.visibleDays < 0.5) {
          // Extremely zoomed in: show 30-minute intervals
          axisTimeInterval = d3.timeMinute.every(30)!;
        } else if (visibility.visibleDays < 1) {
          axisTimeInterval = d3.timeHour.every(1)!;
        } else if (visibility.visibleDays < 3) {
          axisTimeInterval = d3.timeHour.every(2)!;
        } else if (visibility.visibleDays < 5) {
          axisTimeInterval = d3.timeHour.every(4)!;
        } else {
          axisTimeInterval = d3.timeHour.every(6)!;
        }

        const newHourAxis = d3
          .axisTop(newXScale)
          .ticks(axisTimeInterval)
          .tickFormat(
            d3.timeFormat('%H:%M') as (date: Date | d3.NumberValue) => string
          )
          .tickSize(5);

        g.select('.hour-axis')
          .style('opacity', 1)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .call(newHourAxis as any);
        g.select('.hour-axis')
          .selectAll('text')
          .attr('fill', colorMode === 'DARK' ? '#ccc' : '#666')
          .attr('font-size', '10px');
      } else {
        g.select('.hour-axis').style('opacity', 0);
      }
    });
}
