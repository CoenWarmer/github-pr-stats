import * as d3 from 'd3';
import { TimelineData } from '@/lib/types';

/**
 * Render group labels and separators on the left side of the timeline
 */
export function renderGroupLabels(
  g: d3.Selection<SVGGElement, unknown, null, undefined>,
  data: TimelineData,
  rowHeights: number[],
  collapsedGroups: Set<string>,
  setCollapsedGroups: React.Dispatch<React.SetStateAction<Set<string>>>,
  margin: { top: number; right: number; bottom: number; left: number },
  innerWidth: number,
  colorMode: 'LIGHT' | 'DARK'
) {
  let currentY = 0;
  data.groups.forEach((group, i) => {
    const rowHeight = rowHeights[i];

    // Group separator line
    if (i > 0) {
      g.append('line')
        .attr('x1', -margin.left)
        .attr('x2', innerWidth)
        .attr('y1', currentY)
        .attr('y2', currentY)
        .attr('stroke', colorMode === 'DARK' ? '#2B394F' : '#ccc')
        .attr('stroke-width', 1);
    }

    // Add background rectangle behind the text - full row height
    const bgRect = g
      .append('rect')
      .attr('x', -margin.left)
      .attr('y', currentY)
      .attr('width', margin.left)
      .attr('height', rowHeight)
      .attr('fill', colorMode === 'DARK' ? 'rgb(7, 16, 31)' : '#fafafa')
      .attr('stroke', colorMode === 'DARK' ? '#2B394F' : '#ddd')
      .attr('stroke-width', 1)
      .attr('opacity', 1);

    // Group label text (rendered after background)
    const labelText = g
      .append('text')
      .attr('x', -15)
      .attr('y', currentY + rowHeight / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'end')
      .attr('font-size', '14px')
      .attr('fill', colorMode === 'DARK' ? '#fff' : '#000')
      .text(group.content);

    // Add collapse/expand indicator for collapsible groups
    if (group.collapsed !== undefined) {
      const isCollapsed = collapsedGroups.has(group.id);
      g.append('text')
        .attr('x', -margin.left + 5)
        .attr('y', currentY + rowHeight / 2)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'start')
        .attr('font-size', '12px')
        .attr('fill', colorMode === 'DARK' ? '#999' : '#666')
        .style('cursor', 'pointer')
        .text(isCollapsed ? '▶' : '▼');

      // Make the background and label clickable for collapsible groups
      bgRect.style('cursor', 'pointer');
      labelText.style('cursor', 'pointer');

      const toggleCollapse = () => {
        setCollapsedGroups(prev => {
          const next = new Set(prev);
          if (next.has(group.id)) {
            next.delete(group.id);
          } else {
            next.add(group.id);
          }
          return next;
        });
      };

      bgRect.on('click', toggleCollapse);
      labelText.on('click', toggleCollapse);
    }

    currentY += rowHeight;
  });
}
