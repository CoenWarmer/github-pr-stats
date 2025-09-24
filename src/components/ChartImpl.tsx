'use client';

import { useEffect, useState } from 'react';
import { GanttTask, GanttLink, GanttScale } from '@/lib/types';

interface GanttComponentProps {
  tasks: GanttTask[];
  links?: GanttLink[];
  scales?: GanttScale[];
}

type GanttComponent = React.ComponentType<GanttComponentProps> | null;

export default function Chart({
  tasks,
  links,
  scales,
}: {
  tasks: GanttTask[];
  links: GanttLink[];
  scales: GanttScale[];
}) {
  const [GanttComponent, setGanttComponent] = useState<GanttComponent>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadGanttComponent = async () => {
      try {
        const [ganttModule] = await Promise.all([
          import('wx-react-gantt'),
          import('wx-react-gantt/dist/gantt.css'),
        ]);

        setGanttComponent(() => ganttModule.Gantt);
        setError(null);
      } catch (err) {
        console.error('Failed to load Gantt component:', err);
        setError('Failed to load Gantt chart component');
      } finally {
        setLoading(false);
      }
    };

    loadGanttComponent();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96 bg-gray-50 rounded-lg">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading Gantt Chart...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-96 bg-red-50 rounded-lg border border-red-200">
        <div className="text-center">
          <div className="text-red-500 text-xl mb-2">⚠️</div>
          <p className="text-red-600 font-medium mb-2">Chart Loading Error</p>
          <p className="text-red-500 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (!GanttComponent) {
    return (
      <div className="flex items-center justify-center h-96 bg-yellow-50 rounded-lg border border-yellow-200">
        <div className="text-center">
          <div className="text-yellow-500 text-xl mb-2">⚠️</div>
          <p className="text-yellow-600">Gantt component not available</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <GanttComponent tasks={tasks} links={links} scales={scales} />
    </div>
  );
}
