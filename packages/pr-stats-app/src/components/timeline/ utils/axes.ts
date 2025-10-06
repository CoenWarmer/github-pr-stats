import * as d3 from 'd3';
import { filterDayTicks } from './zoomUtils';

/**
 * Render day axis with adaptive tick spacing
 */
export function renderDayAxis(
  g: d3.Selection<SVGGElement, unknown, null, undefined>,
  xScale: d3.ScaleTime<number, number>,
  dayTicks: Date[],
  colorMode: 'LIGHT' | 'DARK'
) {
  const dayAxis = d3
    .axisTop(xScale)
    .tickValues(dayTicks)
    .tickFormat(
      d3.timeFormat('%a %m/%d') as (date: Date | d3.NumberValue) => string
    )
    .tickSize(5);

  const dayAxisGroup = g
    .append('g')
    .attr('class', 'day-axis')
    .attr('transform', `translate(0, -20)`)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .call(dayAxis as any);

  dayAxisGroup
    .selectAll('text')
    .attr('fill', colorMode === 'DARK' ? '#fff' : '#000')
    .attr('font-size', '12px')
    .attr('font-weight', 'bold');

  dayAxisGroup
    .selectAll('line')
    .attr('stroke', colorMode === 'DARK' ? '#666' : '#999');

  dayAxisGroup
    .select('.domain')
    .attr('stroke', colorMode === 'DARK' ? '#666' : '#999')
    .attr('opacity', 0);
}

/**
 * Render hour axis (only visible when zoomed in)
 */
export function renderHourAxis(
  g: d3.Selection<SVGGElement, unknown, null, undefined>,
  xScale: d3.ScaleTime<number, number>,
  showHourAxis: boolean,
  colorMode: 'LIGHT' | 'DARK'
) {
  if (showHourAxis) {
    const hourAxis = d3
      .axisTop(xScale)
      .ticks(d3.timeHour.every(4))
      .tickFormat(
        d3.timeFormat('%H:%M') as (date: Date | d3.NumberValue) => string
      )
      .tickSize(5);

    const hourAxisGroup = g
      .append('g')
      .attr('class', 'hour-axis')
      .attr('transform', `translate(0, -5)`)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .call(hourAxis as any);

    hourAxisGroup
      .selectAll('text')
      .attr('fill', colorMode === 'DARK' ? '#ccc' : '#666')
      .attr('font-size', '10px');

    hourAxisGroup
      .selectAll('line')
      .attr('stroke', colorMode === 'DARK' ? '#555' : '#aaa');

    hourAxisGroup
      .select('.domain')
      .attr('stroke', colorMode === 'DARK' ? '#555' : '#aaa');
  } else {
    // Create empty hour axis group for zoom handler to update
    g.append('g')
      .attr('class', 'hour-axis')
      .attr('transform', `translate(0, -5)`)
      .style('opacity', 0);
  }
}

/**
 * Calculate initial day ticks for the timeline
 */
export function calculateInitialDayTicks(
  domain: [Date, Date],
  visibleDays: number
): Date[] {
  const allDayTicks = d3.timeDay.range(
    d3.timeDay.floor(domain[0]),
    d3.timeDay.ceil(domain[1])
  );

  return filterDayTicks(allDayTicks, visibleDays);
}
