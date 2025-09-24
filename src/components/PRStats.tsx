import { PullRequestStats } from '@/lib/types';
import {
  formatTime,
  formatDurationInHours,
  calculateDeliveryFriction,
  formatDeliveryFriction,
} from '@/lib/utils';

interface PRStatsProps {
  pr: PullRequestStats;
}

export default function PRStats({ pr }: PRStatsProps) {
  // Calculate build minutes (simplified calculation)
  const totalBuildMinutes =
    pr.timeline.filter(event => event.type === 'ci_completed').length * 10; // Rough estimate

  // Calculate waiting minutes
  const totalWaitingMinutes =
    pr.timeline.filter(event => event.type === 'awaiting_review').length * 60; // Rough estimate

  const deliveryFriction = calculateDeliveryFriction(
    pr,
    totalBuildMinutes,
    totalWaitingMinutes
  );
  const frictionFormatted = formatDeliveryFriction(deliveryFriction);

  return (
    <div className="bg-gray-50 p-6 rounded-lg border">
      <div className="mb-4">
        <div className="text-sm text-gray-600">
          <strong>Author:</strong> {pr.author} | <strong>Created:</strong>{' '}
          {new Date(pr.created_at).toLocaleDateString()} |{' '}
          <strong>Status:</strong> {pr.state}
          {pr.merged_at ? ' (merged)' : ''}
        </div>
      </div>

      {/* Linked Issues */}
      {pr.linked_issues && pr.linked_issues.length > 0 && (
        <div className="mb-4 p-3 bg-blue-50 border-l-4 border-blue-400 rounded">
          <strong>🔗 Linked Issues ({pr.linked_issues.length}):</strong>
          <div className="mt-2 space-y-1">
            {pr.linked_issues.map(issue => (
              <div key={issue.number} className="text-sm">
                <a
                  href={issue.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline font-medium"
                >
                  #{issue.number}
                </a>
                <span className="text-gray-500 mx-2">•</span>
                <span>{issue.title}</span>
                <span className="ml-2">
                  <span
                    className={`px-2 py-1 text-xs font-semibold rounded-full ${
                      issue.state.toLowerCase() === 'open'
                        ? 'bg-red-500 text-white'
                        : 'bg-green-500 text-white'
                    }`}
                  >
                    {issue.state.toUpperCase()}
                  </span>
                  {issue.labels.length > 0 && (
                    <span className="ml-1">
                      {issue.labels.map(label => (
                        <span
                          key={label}
                          className="ml-1 px-1 py-0.5 text-xs bg-blue-100 text-blue-800 rounded"
                        >
                          {label}
                        </span>
                      ))}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Statistics */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
        <StatItem
          label="Total PR Duration"
          value={`${formatDurationInHours(pr.turnaround_time_hours)}h`}
        />
        <StatItem label="Commits" value={pr.commits.toString()} />
        <StatItem label="Comments" value={pr.comments.toString()} />
        <StatItem
          label="Review Comments"
          value={pr.review_comments.toString()}
        />
        <StatItem label="Files Changed" value={pr.changed_files.toString()} />
        <StatItem label="Additions" value={`+${pr.additions}`} />
        <StatItem label="Deletions" value={`-${pr.deletions}`} />
        <StatItem
          label="Total Build Minutes"
          value={formatTime(totalBuildMinutes)}
        />
        <StatItem
          label="Total time waited for approvals"
          value={formatTime(totalWaitingMinutes)}
        />
        <StatItem
          label="Delivery Friction"
          value={frictionFormatted.value}
          valueColor={frictionFormatted.color}
          tooltip="Composite metric combining CI time (25%), waiting time (30%), code complexity (20%), review iterations (15%), and duration (10%). Measures delivery friction from technical, organizational, and process obstacles. Score: 0-30=Low, 31-60=Medium, 61+=High friction"
        />
      </div>
    </div>
  );
}

interface StatItemProps {
  label: string;
  value: string;
  valueColor?: string;
  tooltip?: string;
}

function StatItem({
  label,
  value,
  valueColor = '#333',
  tooltip,
}: StatItemProps) {
  return (
    <div className="bg-white p-3 rounded border" title={tooltip}>
      <div className="text-xs text-gray-600">{label}</div>
      <div className="text-lg font-bold" style={{ color: valueColor }}>
        {value}
      </div>
    </div>
  );
}
