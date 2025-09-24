'use client';

import { PullRequestStats, GanttData } from '@/lib/types';
import { Chart } from './Chart';

interface TimelineProps {
  data: GanttData;
  pr: PullRequestStats;
}

export default function Timeline({ data, pr }: TimelineProps) {
  // Calculate PR duration for display
  const prStart = new Date(pr.created_at);
  const prEnd = new Date(pr.closed_at || pr.merged_at || new Date());
  const durationHours = Math.round(
    (prEnd.getTime() - prStart.getTime()) / (1000 * 60 * 60)
  );

  return (
    <div className="w-full">
      {/* Timeline Info */}
      <div className="mb-4 p-4 bg-blue-50 rounded-lg">
        <div className="flex flex-wrap items-center justify-between gap-4 text-sm">
          <div>
            <span className="font-medium">📅 PR Duration:</span>{' '}
            <span className="text-blue-700 font-semibold">
              {durationHours}h ({Math.round(durationHours / 24)}d)
            </span>
          </div>
          <div>
            <span className="font-medium">📊 Timeline Events:</span>{' '}
            <span className="text-blue-700 font-semibold">
              {data.tasks.length}
            </span>
          </div>
          <div>
            <span className="font-medium">🏁 Status:</span>{' '}
            <span
              className={`px-2 py-1 rounded-full text-xs font-medium ${
                pr.merged_at
                  ? 'bg-purple-100 text-purple-800'
                  : pr.closed_at
                    ? 'bg-red-100 text-red-800'
                    : 'bg-green-100 text-green-800'
              }`}
            >
              {pr.merged_at
                ? '✅ Merged'
                : pr.closed_at
                  ? '❌ Closed'
                  : '🔄 Open'}
            </span>
          </div>
        </div>
      </div>

      {/* Gantt Chart */}
      <div className="w-full border border-gray-300 rounded-lg bg-white p-4">
        <div style={{ height: '500px' }}>
          <Chart tasks={data.tasks} links={data.links} scales={data.scales} />
        </div>
      </div>

      {/* Legend */}
      <div className="mt-4 p-4 bg-gray-50 rounded-lg">
        <h4 className="font-medium text-gray-800 mb-2">📋 Legend</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-blue-500 rounded"></div>
            <span>📝 Commits</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-green-500 rounded"></div>
            <span>👀 Reviews</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-orange-500 rounded"></div>
            <span>💬 Comments</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-purple-500 rounded"></div>
            <span>🔧 CI/CD</span>
          </div>
        </div>
      </div>
    </div>
  );
}
