declare module 'wx-react-gantt' {
  import { ComponentType } from 'react';

  export interface GanttTask {
    id: string | number;
    text: string;
    start: Date;
    end: Date;
    progress: number;
    type?: 'task' | 'milestone';
    parent?: string | number;
    color?: string;
  }

  export interface GanttLink {
    id: string | number;
    source: string | number;
    target: string | number;
    type:
      | 'finish_to_start'
      | 'start_to_start'
      | 'finish_to_finish'
      | 'start_to_finish';
  }

  export interface GanttScale {
    unit: 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';
    step: number;
    format: string;
  }

  export interface GanttProps {
    tasks: GanttTask[];
    links?: GanttLink[];
    scales?: GanttScale[];
  }

  export const Gantt: ComponentType<GanttProps>;
}

declare module 'wx-react-gantt/dist/gantt.css';
