import * as d3 from 'd3';

/**
 * Render hour grid lines (vertical lines at hour intervals)
 */
export function renderHourGridLines(
  bgGroup: d3.Selection<SVGGElement, unknown, null, undefined>,
  xScale: d3.ScaleTime<number, number>,
  totalRowHeight: number,
  colorMode: 'LIGHT' | 'DARK'
) {
  const hourTicks = xScale.ticks(d3.timeHour.every(6));
  bgGroup
    .selectAll('.hour-grid-line')
    .data(hourTicks)
    .enter()
    .append('line')
    .attr('class', 'hour-grid-line')
    .attr('x1', d => xScale(d))
    .attr('x2', d => xScale(d))
    .attr('y1', 0)
    .attr('y2', totalRowHeight)
    .attr('stroke', colorMode === 'DARK' ? '#222' : '#eee')
    .attr('stroke-width', 1)
    .attr('opacity', 0.6);
}

/**
 * Render day separator lines (vertical lines at day boundaries)
 */
export function renderDaySeparators(
  bgGroup: d3.Selection<SVGGElement, unknown, null, undefined>,
  xScale: d3.ScaleTime<number, number>,
  dayTicks: Date[],
  totalRowHeight: number,
  colorMode: 'LIGHT' | 'DARK'
) {
  bgGroup
    .selectAll('.day-separator')
    .data(dayTicks)
    .enter()
    .append('line')
    .attr('class', 'day-separator')
    .attr('x1', d => xScale(d))
    .attr('x2', d => xScale(d))
    .attr('y1', -20)
    .attr('y2', totalRowHeight)
    .attr('stroke', colorMode === 'DARK' ? '#444' : '#ddd')
    .attr('stroke-width', 1)
    .attr('opacity', 0.7);
}
