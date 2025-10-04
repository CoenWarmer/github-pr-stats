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
  selectedWorkflow?: string;
}

export default function PRStats({
  pr,
  selectedWorkflow = 'all',
}: PRStatsProps) {
  // Get all CI build events, filtered by selected workflow
  const ciBuilds = pr.timeline.filter(event => {
    if (event.type !== 'ci_run' || event.hidden_from_timeline) {
      return false;
    }
    // If "all" is selected, include all workflows
    if (selectedWorkflow === 'all') {
      return true;
    }
    // Otherwise, only include builds matching the selected workflow
    return event.workflow_name === selectedWorkflow;
  });

  // Calculate build statistics
  const totalBuilds = ciBuilds.length;
  const completedBuilds = ciBuilds.filter(
    event => event.ci_status === 'completed'
  ).length;
  const failedBuilds = ciBuilds.filter(
    event =>
      event.ci_conclusion === 'failure' || event.ci_conclusion === 'error'
  ).length;
  const successfulBuilds = ciBuilds.filter(
    event => event.ci_conclusion === 'success'
  ).length;

  // Calculate build minutes (simplified calculation)
  const totalBuildMinutes = ciBuilds.reduce(
    (acc, event) => acc + (event.duration_ms || 0),
    0
  );

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
              title={totalBuilds.toString()}
              description="Total Builds"
              titleSize="s"
              reverse
            />
          </EuiFlexItem>
          <EuiFlexItem>
            <EuiStat
              title={completedBuilds.toString()}
              description="Builds Completed"
              titleSize="s"
              reverse
            />
          </EuiFlexItem>
          <EuiFlexItem>
            <EuiStat
              title={successfulBuilds.toString()}
              description="Builds Successful"
              titleSize="s"
              reverse
              titleColor="success"
            />
          </EuiFlexItem>
          <EuiFlexItem>
            <EuiStat
              title={failedBuilds.toString()}
              description="Builds Failed"
              titleSize="s"
              reverse
              titleColor="danger"
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
