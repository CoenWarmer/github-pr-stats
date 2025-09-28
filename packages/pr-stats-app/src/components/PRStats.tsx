import { PullRequestStats } from '@/lib/types';
import {
  formatDuration,
  calculateDeliveryFriction,
  formatDeliveryFriction,
  formatDurationBetweenDates,
} from '@/lib/utils';
import { EuiFlexGroup, EuiFlexItem, EuiPanel, EuiStat } from '@elastic/eui';

interface PRStatsProps {
  pr: PullRequestStats;
}

export default function PRStats({ pr }: PRStatsProps) {
  // Calculate build minutes (simplified calculation)
  const totalBuildMinutes = pr.timeline
    .filter(event => event.type === 'ci_run' && !event.hidden_from_timeline)
    .reduce((acc, event) => acc + (event.duration_ms || 0), 0);

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
      {/* Statistics */}
      <EuiPanel hasBorder hasShadow={false}>
        <EuiFlexGroup direction="row">
          <EuiFlexItem>
            {pr.closed_at ? (
              <EuiStat
                title={formatDuration(pr.turnaround_time_hours, 'hours')}
                description="Run time"
                titleSize="s"
                reverse
              />
            ) : (
              <EuiStat
                title={formatDurationBetweenDates(pr.created_at, new Date())}
                description="Run time (so far)"
                titleSize="s"
                reverse
              />
            )}
          </EuiFlexItem>
          <EuiFlexItem>
            <EuiStat
              title={frictionFormatted.value}
              description="Delivery Friction"
              titleSize="s"
              reverse
              titleColor={
                frictionFormatted.color === '#22C55E'
                  ? 'success'
                  : frictionFormatted.color === '#F59E0B'
                    ? 'warning'
                    : 'danger'
              }
            />
          </EuiFlexItem>
          <EuiFlexItem>
            <EuiStat
              title={pr.commits.toString()}
              description="Commits"
              titleSize="s"
              reverse
            />
          </EuiFlexItem>
          <EuiFlexItem>
            <EuiStat
              title={pr.comments.toString()}
              description="Comments"
              titleSize="s"
              reverse
            />
          </EuiFlexItem>
          <EuiFlexItem>
            <EuiStat
              title={pr.review_comments.toString()}
              description="Review Comments"
              titleSize="s"
              reverse
            />
          </EuiFlexItem>
          <EuiFlexItem>
            <EuiStat
              title={pr.changed_files.toString()}
              description="Files Changed"
              titleSize="s"
              reverse
            />
          </EuiFlexItem>
          <EuiFlexItem>
            <EuiStat
              title={`+${pr.additions}`}
              description="Additions"
              titleSize="s"
              reverse
              titleColor="success"
            />
          </EuiFlexItem>
          <EuiFlexItem>
            <EuiStat
              title={`-${pr.deletions}`}
              description="Deletions"
              titleSize="s"
              reverse
              titleColor="danger"
            />
          </EuiFlexItem>
          <EuiFlexItem>
            <EuiStat
              title={formatDuration(totalBuildMinutes, 'ms')}
              description="Total build time"
              titleSize="s"
              reverse
            />
          </EuiFlexItem>
          <EuiFlexItem>
            <EuiStat
              title={formatDuration(totalWaitingMinutes, 'minutes')}
              description="Time awaiting code reviews"
              titleSize="s"
              reverse
            />
          </EuiFlexItem>
        </EuiFlexGroup>
      </EuiPanel>
    </div>
  );
}
