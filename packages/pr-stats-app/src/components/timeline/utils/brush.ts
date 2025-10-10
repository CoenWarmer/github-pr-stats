import * as d3 from 'd3';

/**
 * Creates and manages brush selection for timeline zooming
 */
export function createBrushSelection(
  svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
  margin: { top: number; left: number },
  totalRowHeight: number,
  colorMode: string,
  xScale: d3.ScaleTime<number, number>,
  onZoomRangeChange?: (range: [Date, Date]) => void
) {
  const brushGroup = svg.append('g').attr('class', 'brush-selection');
  const brushRect = brushGroup
    .append('rect')
    .attr('class', 'brush-rect')
    .attr(
      'fill',
      colorMode === 'DARK'
        ? 'rgba(100, 150, 255, 0.2)'
        : 'rgba(0, 100, 255, 0.2)'
    )
    .attr(
      'stroke',
      colorMode === 'DARK' ? 'rgb(100, 150, 255)' : 'rgb(0, 100, 255)'
    )
    .attr('stroke-width', 1)
    .attr('stroke-dasharray', '5,5')
    .style('display', 'none');

  let brushStartX: number | null = null;
  const brushSelectionRef = {
    start: null as number | null,
    current: null as number | null,
  };

  svg.on('mousedown', (event: MouseEvent) => {
    if (event.metaKey) {
      event.preventDefault();
      const [x] = d3.pointer(event);
      brushStartX = x;
      brushSelectionRef.start = x;
      brushSelectionRef.current = x;
      brushRect
        .style('display', null)
        .attr('x', x)
        .attr('y', margin.top)
        .attr('width', 0)
        .attr('height', totalRowHeight);
    }
  });

  svg.on('mousemove', (event: MouseEvent) => {
    if (brushStartX !== null && event.metaKey) {
      const [x] = d3.pointer(event);
      brushSelectionRef.current = x;
      const rectX = Math.min(brushStartX, x);
      const rectWidth = Math.abs(x - brushStartX);
      brushRect.attr('x', rectX).attr('width', rectWidth);
    }
  });

  svg.on('mouseup', (event: MouseEvent) => {
    if (brushStartX !== null && event.metaKey) {
      const [x] = d3.pointer(event);
      const startX = Math.min(brushStartX, x) - margin.left;
      const endX = Math.max(brushStartX, x) - margin.left;

      // Use the CURRENT zoom transform for accurate inversion
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const currentTransform = d3.zoomTransform(svg.node() as any);
      const currentXScale = currentTransform.rescaleX(xScale);

      // Convert pixel coordinates to time values using current scale
      const startTime = currentXScale.invert(startX);
      const endTime = currentXScale.invert(endX);

      // Only zoom if selection is significant (> 20 pixels)
      if (Math.abs(endX - startX) > 20 && onZoomRangeChange) {
        onZoomRangeChange([startTime, endTime]);
      }

      // Reset brush
      brushStartX = null;
      brushSelectionRef.start = null;
      brushSelectionRef.current = null;
      brushRect.style('display', 'none');
    }
  });

  // Hide brush if Meta is released while dragging or mouse leaves
  svg.on('mouseleave', () => {
    if (brushStartX !== null) {
      brushStartX = null;
      brushSelectionRef.start = null;
      brushSelectionRef.current = null;
      brushRect.style('display', 'none');
    }
  });

  return brushSelectionRef;
}
