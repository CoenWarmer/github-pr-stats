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

  // Calculate build time (use pre-calculated value when workflow is "all")
  const totalBuildMinutes =
    selectedWorkflow === 'all'
      ? (pr.build_stats.total_build_time_ms ?? 0)
      : ciBuilds.reduce((acc, event) => acc + (event.duration_ms || 0), 0);

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

  return (
    <EuiPanel hasBorder hasShadow={false} style={{ width: '100%' }}>
      <EuiFlexGroup direction="row">
        <EuiFlexItem>
          <EuiStat
            title={formatDurationBetweenDates(startTime, endTime)}
            description={isComplete ? 'Run time' : 'Run time (so far)'}
            titleSize="s"
            reverse
          />
        </EuiFlexItem>
        <EuiFlexItem>
          <EuiToolTip
            display="block"
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
              </EuiFlexGroup>
            }
          >
            <EuiStat
              title={complexityFormatted.value}
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
        </EuiFlexItem>

        <EuiFlexItem>
          <ApprovalDirectionStat
            authorCodeownerRelationships={authorCodeownerRelationships ?? []}
          />
        </EuiFlexItem>

        <EuiFlexItem>
          <EuiStat
            title={formatDuration(totalTeamReviewTimeMs, 'ms')}
            description="Total team review time"
            titleSize="s"
            reverse
            titleColor="primary"
          />
        </EuiFlexItem>
        <EuiFlexItem>
          <EuiToolTip
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
              </EuiFlexGroup>
            }
          >
            <EuiStat
              title={formatDuration(totalBuildMinutes, 'ms')}
              description="Total build time"
              titleSize="s"
              reverse
            />
          </EuiToolTip>
        </EuiFlexItem>
        <EuiFlexItem>
          <EuiStat
            title={formatDuration(
              pr.timeline.find(event => event.type === 'time_to_release')
                ?.duration_ms ?? 0,
              'ms'
            )}
            description="Time to first release"
            titleSize="s"
            reverse
          />
        </EuiFlexItem>
      </EuiFlexGroup>
    </EuiPanel>
  );
}
