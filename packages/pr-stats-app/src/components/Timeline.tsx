'use client';

import { PullRequestStats, TimelineData } from '@/lib/types';
import { Chart } from './Chart';
import { EuiPanel } from '@elastic/eui';

interface TimelineProps {
  data: TimelineData;
  pr: PullRequestStats;
}

export default function Timeline({ data, pr }: TimelineProps) {
  // Calculate PR duration for display
  const prStart = new Date(pr.created_at);
  const prEnd = new Date(pr.closed_at || pr.merged_at || new Date());
  const durationHours = Math.round(
    (prEnd.getTime() - prStart.getTime()) / (1000 * 60 * 60)
  );

  // Count different event types
  const eventCounts = data.items.reduce(
    (counts, item) => {
      if (item.className?.includes('commit')) counts.commits++;
      else if (item.className?.includes('review')) counts.reviews++;
      else if (item.className?.includes('comment')) counts.comments++;
      else if (item.className?.includes('ci')) counts.ci++;
      else if (item.className?.includes('discussion')) counts.discussions++;
      else if (item.className?.includes('release')) counts.releases++;
      else if (item.className?.includes('feature-turnaround'))
        counts.features++;
      return counts;
    },
    {
      commits: 0,
      reviews: 0,
      comments: 0,
      ci: 0,
      discussions: 0,
      releases: 0,
      features: 0,
    }
  );

  return (
    <div>
      {/* Timeline Chart */}
      <EuiPanel hasBorder hasShadow={false}>
        <Chart data={data} />
      </EuiPanel>

      {/* Legend */}
      <div>
        <h4>📋 Event Breakdown</h4>
        <div>
          <div>
            <span>📊 Total Events: ({data.items.length})</span>
          </div>
          <div>
            <span>📋 Groups: ({data.groups.length})</span>
          </div>
          {eventCounts.commits > 0 && (
            <div>
              <span>📝 Commits ({eventCounts.commits})</span>
            </div>
          )}
          {eventCounts.reviews > 0 && (
            <div>
              <span>👀 Reviews ({eventCounts.reviews})</span>
            </div>
          )}
          {eventCounts.comments > 0 && (
            <div>
              <span>💬 Comments ({eventCounts.comments})</span>
            </div>
          )}
          {eventCounts.ci > 0 && (
            <div>
              <span>🔧 CI/CD ({eventCounts.ci})</span>
            </div>
          )}
          {eventCounts.discussions > 0 && (
            <div>
              <span>💬 Discussions ({eventCounts.discussions})</span>
            </div>
          )}
          {eventCounts.releases > 0 && (
            <div>
              <span>🚀 Releases ({eventCounts.releases})</span>
            </div>
          )}
          {eventCounts.features > 0 && (
            <div>
              <span>⏱️ Features ({eventCounts.features})</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
