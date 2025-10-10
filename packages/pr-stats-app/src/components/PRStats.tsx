import { PullRequestStats } from '@/lib/types';
import {
  formatDuration,
  formatDeliveryFriction,
  formatDurationBetweenDates,
  formatPRComplexity,
} from '@/lib/utils';
import {
  EuiFlexGroup,
  EuiFlexItem,
  EuiPanel,
  EuiStat,
  EuiToolTip,
} from '@elastic/eui';

import { ApprovalDirectionStat } from './ApprovalDirectionStat';

interface PRStatsProps {
  pr: PullRequestStats;
  selectedWorkflow?: string;
}

export default function PRStats({
  pr,
  selectedWorkflow = 'all',
}: PRStatsProps) {
  // Get all CI build events, filtered by selected workflow (for workflow-specific stats)
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

  // Use pre-calculated build statistics from backend when workflow is "all"
  // Otherwise, calculate filtered stats based on selected workflow
  const totalBuilds =
    selectedWorkflow === 'all'
      ? (pr.build_stats.total_builds ?? ciBuilds.length)
      : ciBuilds.length;
  const completedBuilds =
    selectedWorkflow === 'all'
      ? (pr.build_stats.completed_builds ??
        ciBuilds.filter(
          event => event.type === 'ci_run' && event.ci_status === 'completed'
        ).length)
      : ciBuilds.filter(
          event => event.type === 'ci_run' && event.ci_status === 'completed'
        ).length;
  const failedBuilds =
    selectedWorkflow === 'all'
      ? (pr.build_stats.failed_builds ??
        ciBuilds.filter(
          event =>
            event.type === 'ci_run' &&
            (event.ci_conclusion === 'failure' ||
              event.ci_conclusion === 'error')
        ).length)
      : ciBuilds.filter(
          event =>
            event.type === 'ci_run' &&
            (event.ci_conclusion === 'failure' ||
              event.ci_conclusion === 'error')
        ).length;
  const successfulBuilds =
    selectedWorkflow === 'all'
      ? (pr.build_stats.successful_builds ??
        ciBuilds.filter(
          event => event.type === 'ci_run' && event.ci_conclusion === 'success'
        ).length)
      : ciBuilds.filter(
          event => event.type === 'ci_run' && event.ci_conclusion === 'success'
        ).length;
  const cancelledBuilds =
    selectedWorkflow === 'all'
      ? (pr.build_stats.cancelled_builds ??
        ciBuilds.filter(
          event =>
            event.type === 'ci_run' && event.ci_conclusion === 'cancelled'
        ).length)
      : ciBuilds.filter(
          event =>
            event.type === 'ci_run' && event.ci_conclusion === 'cancelled'
        ).length;

  // Calculate build time (use pre-calculated value when workflow is "all")
  const totalBuildMinutes =
    selectedWorkflow === 'all'
      ? (pr.build_stats.total_build_time_ms ?? 0)
      : ciBuilds.reduce((acc, event) => acc + (event.duration_ms || 0), 0);

  // Get wall-to-wall and cumulative build times (only for "all" workflow)
  const wallToWallBuildTime =
    selectedWorkflow === 'all'
      ? (pr.build_stats.wall_to_wall_build_time_ms ?? totalBuildMinutes)
      : totalBuildMinutes;
  const cumulativeBuildTime =
    pr.build_stats.cumulative_build_time_ms ?? totalBuildMinutes;

  // Calculate parallelization factor
  const parallelizationFactor =
    wallToWallBuildTime > 0
      ? Math.round((cumulativeBuildTime / wallToWallBuildTime) * 10) / 10
      : 1;

  // Calculate build time per conclusion type
  const successfulBuildTime = ciBuilds
    .filter(
      event => event.type === 'ci_run' && event.ci_conclusion === 'success'
    )
    .reduce((acc, event) => acc + (event.duration_ms || 0), 0);
  const failedBuildTime = ciBuilds
    .filter(
      event =>
        event.type === 'ci_run' &&
        (event.ci_conclusion === 'failure' || event.ci_conclusion === 'error')
    )
    .reduce((acc, event) => acc + (event.duration_ms || 0), 0);
  const cancelledBuildTime = ciBuilds
    .filter(
      event => event.type === 'ci_run' && event.ci_conclusion === 'cancelled'
    )
    .reduce((acc, event) => acc + (event.duration_ms || 0), 0);

  // Use pre-calculated team review time from backend or fallback to 0
  const totalTeamReviewTimeMs = pr.metrics?.total_team_review_time_ms ?? 0;

  // Use pre-calculated values from backend or fallback to 0
  const deliveryFriction = pr.metrics?.delivery_friction ?? 0;
  const frictionFormatted = formatDeliveryFriction(deliveryFriction);

  const complexity = pr.metrics?.complexity ?? 0;
  const complexityFormatted = formatPRComplexity(complexity);

  // Use pre-calculated run time from backend or fallback to PR dates
  const startTime = pr.metrics?.run_start_time
    ? new Date(pr.metrics?.run_start_time)
    : new Date(pr.created_at);
  const endTime = pr.metrics?.run_end_time
    ? new Date(pr.metrics?.run_end_time)
    : pr.merged_at || pr.closed_at
      ? new Date(pr.merged_at || pr.closed_at!)
      : new Date();
  const isComplete = pr.closed_at || pr.merged_at;

  // Use pre-calculated author-codeowner relationship from backend
  const authorCodeownerRelationships = pr.reviews.review_timings.map(
    timing => timing.author_reviewer_relationship
  );

  const releaseEvent = pr.timeline.find(
    event => event.type === 'time_to_release'
  );
  const hasRelease = releaseEvent && releaseEvent.release_tag;

  return (
    <EuiPanel hasBorder hasShadow={false} style={{ width: '100%' }}>
      <EuiFlexGroup direction="row">
        <EuiFlexItem>
          <EuiToolTip
            position="bottom"
            content={
              <div
                style={{
                  padding: '8px 0',
                  fontSize: '12px',
                  lineHeight: '1.5',
                }}
              >
                <strong>Start Date:</strong>
                <br />
                {startTime.toLocaleString()}
                <br />
                {pr.metrics?.run_start_time &&
                pr.linked_issues &&
                pr.linked_issues.length > 0
                  ? '(Issue created)'
                  : '(PR opened)'}
                <br />
                <br />
                <strong>End Date:</strong>
                <br />
                {endTime.toLocaleString()}
                <br />
                {isComplete
                  ? pr.metrics?.run_end_time &&
                    pr.linked_issues &&
                    pr.linked_issues.length > 0
                    ? '(Issue closed)'
                    : pr.merged_at
                      ? '(PR merged)'
                      : '(PR closed)'
                  : '(Current time)'}
                <br />
                <br />
                <strong>Duration:</strong>
                <br />
                {formatDurationBetweenDates(startTime, endTime)}
              </div>
            }
          >
            <EuiStat
              title={formatDurationBetweenDates(startTime, endTime)}
              description={`Turnaround time ${!isComplete ? '(so far)' : ''}`}
              titleSize="s"
              reverse
            />
          </EuiToolTip>
        </EuiFlexItem>
        <EuiFlexItem>
          <EuiToolTip
            display="block"
            position="bottom"
            content={
              <EuiFlexGroup direction="column">
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
                  <EuiToolTip
                    position="bottom"
                    content={
                      pr.codeowners
                        ? `Teams: ${pr.codeowners.teams.length}, Individuals: ${pr.codeowners.individuals.length}`
                        : 'No code owners found'
                    }
                  >
                    <EuiStat
                      title={
                        pr.codeowners
                          ? (
                              pr.codeowners.teams.length +
                              pr.codeowners.individuals.length
                            ).toString()
                          : '0'
                      }
                      description="Code Owners"
                      titleSize="s"
                      reverse
                      titleColor="primary"
                    />
                  </EuiToolTip>
                </EuiFlexItem>
                <EuiFlexItem>
                  <div
                    style={{
                      padding: '8px 0',
                      fontSize: '12px',
                      lineHeight: '1.5',
                    }}
                  >
                    <strong>Complexity Formula:</strong>
                    <br />
                    Weighted combination of:
                    <br />
                    • Lines changed (30%)
                    <br />
                    • Files changed (25%)
                    <br />
                    • Code owners per file (25%)
                    <br />• Review comments (20%)
                  </div>
                </EuiFlexItem>
              </EuiFlexGroup>
            }
          >
            <EuiStat
              title={`${complexityFormatted.value} / 10`}
              description={`PR Complexity (${complexityFormatted.label})`}
              titleSize="s"
              reverse
              titleColor={
                complexity <= 2
                  ? 'success'
                  : complexity <= 4
                    ? 'success'
                    : complexity <= 6
                      ? 'warning'
                      : 'danger'
              }
            />
          </EuiToolTip>
        </EuiFlexItem>
        <EuiFlexItem>
          <ApprovalDirectionStat
            authorCodeownerRelationships={authorCodeownerRelationships ?? []}
          />
        </EuiFlexItem>

        <EuiFlexItem>
          <EuiToolTip
            position="bottom"
            content={
              <div
                style={{
                  padding: '8px 0',
                  fontSize: '12px',
                  lineHeight: '1.5',
                }}
              >
                <strong>Time to First Review</strong>
                <br />
                Shortest waiting time from when a review was requested
                <br />
                to when the first review came in.
              </div>
            }
          >
            <EuiStat
              title={formatDuration(totalTeamReviewTimeMs, 'ms')}
              description="Time to first review"
              titleSize="s"
              reverse
              titleColor="primary"
            />
          </EuiToolTip>
        </EuiFlexItem>

        <EuiFlexItem>
          <EuiToolTip
            display="block"
            position="bottom"
            content={
              <div
                style={{
                  padding: '8px 0',
                  fontSize: '12px',
                  lineHeight: '1.5',
                }}
              >
                <strong>Friction Formula:</strong>
                <br />
                Weighted combination of:
                <br />
                • Waiting time (30%)
                <br />
                • CI build time (25%)
                <br />
                • Code complexity (20%)
                <br />
                • Review iterations (15%)
                <br />• Turnaround duration (10%)
              </div>
            }
          >
            <EuiStat
              title={frictionFormatted.value}
              description="PR Delivery Friction"
              titleSize="s"
              reverse
              titleColor={
                deliveryFriction <= 30
                  ? 'success'
                  : deliveryFriction <= 60
                    ? 'warning'
                    : 'danger'
              }
            />
          </EuiToolTip>
        </EuiFlexItem>

        <EuiFlexItem>
          <EuiToolTip
            position="bottom"
            content={
              <EuiFlexGroup direction="column">
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
                    title={`${successfulBuilds.toString()} ${successfulBuildTime ? `(${formatDuration(successfulBuildTime, 'ms')})` : ''}`}
                    description="Builds Successful"
                    titleSize="s"
                    reverse
                    titleColor="success"
                  />
                </EuiFlexItem>
                <EuiFlexItem>
                  <EuiStat
                    title={`${failedBuilds.toString()} ${failedBuildTime ? `(${formatDuration(failedBuildTime, 'ms')})` : ''}`}
                    description="Builds Failed"
                    titleSize="s"
                    reverse
                    titleColor="danger"
                  />
                </EuiFlexItem>
                <EuiFlexItem>
                  <EuiStat
                    title={`${cancelledBuilds.toString()} ${cancelledBuildTime ? `(${formatDuration(cancelledBuildTime, 'ms')})` : ''}`}
                    description="Builds Cancelled"
                    titleSize="s"
                    reverse
                    titleColor="warning"
                  />
                </EuiFlexItem>
              </EuiFlexGroup>
            }
          >
            <EuiStat
              title={formatDuration(wallToWallBuildTime, 'ms')}
              description="Build time (wall-to-wall)"
              titleSize="s"
              reverse
            />
          </EuiToolTip>
        </EuiFlexItem>
        <EuiFlexItem>
          <EuiToolTip
            position="bottom"
            content={
              <EuiFlexGroup direction="column">
                <EuiFlexItem>
                  <EuiStat
                    title={formatDuration(wallToWallBuildTime, 'ms')}
                    description="Wall-to-wall time"
                    titleSize="s"
                    reverse
                  />
                </EuiFlexItem>
                <EuiFlexItem>
                  <EuiStat
                    title={formatDuration(cumulativeBuildTime, 'ms')}
                    description="Cumulative time"
                    titleSize="s"
                    reverse
                  />
                </EuiFlexItem>
                <EuiFlexItem>
                  <EuiStat
                    title={`${parallelizationFactor}x`}
                    description="Parallelization"
                    titleSize="s"
                    reverse
                    titleColor="warning"
                  />
                </EuiFlexItem>
              </EuiFlexGroup>
            }
          >
            <EuiStat
              title={formatDuration(cumulativeBuildTime, 'ms')}
              description="Build time (cumulative)"
              titleSize="s"
              reverse
            />
          </EuiToolTip>
        </EuiFlexItem>
        <EuiFlexItem>
          {hasRelease ? (
            <EuiToolTip
              position="bottom"
              content={
                <div
                  style={{
                    padding: '8px 0',
                    fontSize: '12px',
                    lineHeight: '1.5',
                  }}
                >
                  <strong>First Release:</strong>
                  <br />
                  {releaseEvent.release_tag}
                  <br />
                  <br />
                  <strong>Released on:</strong>
                  <br />
                  {releaseEvent.end_date
                    ? new Date(releaseEvent.end_date).toLocaleString()
                    : 'Unknown'}
                </div>
              }
            >
              <EuiStat
                title={formatDuration(releaseEvent.duration_ms ?? 0, 'ms')}
                description="Time to first release"
                titleSize="s"
                reverse
              />
            </EuiToolTip>
          ) : (
            <EuiStat
              title={formatDuration(0, 'ms')}
              description="Time to first release"
              titleSize="s"
              reverse
            />
          )}
        </EuiFlexItem>
      </EuiFlexGroup>
    </EuiPanel>
  );
}
