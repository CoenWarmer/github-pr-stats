import { PullRequestStats } from '@/lib/types';
import {
  formatTime,
  formatDurationInHours,
  calculateDeliveryFriction,
  formatDeliveryFriction,
} from '@/lib/utils';
import { EuiFlexGroup, EuiPanel, EuiStat } from '@elastic/eui';

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
    <div>
      {/* Linked Issues */}
      {pr.linked_issues && pr.linked_issues.length > 0 && (
        <EuiFlexGroup direction="row">
          <strong>🔗 Linked Issues ({pr.linked_issues.length}):</strong>
          <div>
            {pr.linked_issues.map(issue => (
              <div key={issue.number}>
                <a href={issue.url} target="_blank" rel="noopener noreferrer">
                  #{issue.number}
                </a>
                <span> • </span>
                <span>{issue.title}</span>
                <span>
                  <span>{issue.state.toUpperCase()}</span>
                  {issue.labels.length > 0 && (
                    <span>
                      {issue.labels.map(label => (
                        <span key={label}>{label}</span>
                      ))}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </EuiFlexGroup>
      )}

      {/* Statistics */}
      <EuiPanel hasBorder hasShadow={false}>
        <EuiFlexGroup direction="row">
          <EuiStat
            title={`${formatDurationInHours(pr.turnaround_time_hours)}h`}
            description="Total PR Duration"
            titleSize="l"
          />
          <EuiStat
            title={frictionFormatted.value}
            description="Delivery Friction"
            titleSize="l"
            titleColor={
              frictionFormatted.color === '#22C55E'
                ? 'success'
                : frictionFormatted.color === '#F59E0B'
                  ? 'warning'
                  : 'danger'
            }
          />
          <EuiStat
            title={pr.commits.toString()}
            description="Commits"
            titleSize="l"
          />
          <EuiStat
            title={pr.comments.toString()}
            description="Comments"
            titleSize="l"
          />
          <EuiStat
            title={pr.review_comments.toString()}
            description="Review Comments"
            titleSize="l"
          />
          <EuiStat
            title={pr.changed_files.toString()}
            description="Files Changed"
            titleSize="l"
          />
          <EuiStat
            title={`+${pr.additions}`}
            description="Additions"
            titleSize="l"
            titleColor="success"
          />
          <EuiStat
            title={`-${pr.deletions}`}
            description="Deletions"
            titleSize="l"
            titleColor="danger"
          />
          <EuiStat
            title={formatTime(totalBuildMinutes)}
            description="Total Build Minutes"
            titleSize="l"
          />
          <EuiStat
            title={formatTime(totalWaitingMinutes)}
            description="Total time waited for approvals"
            titleSize="l"
          />
        </EuiFlexGroup>
      </EuiPanel>
    </div>
  );
}
