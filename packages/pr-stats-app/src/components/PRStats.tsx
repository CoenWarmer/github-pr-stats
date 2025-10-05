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
    event => event.type === 'ci_run' && event.ci_status === 'completed'
  ).length;
  const failedBuilds = ciBuilds.filter(
    event =>
      event.type === 'ci_run' &&
      (event.ci_conclusion === 'failure' || event.ci_conclusion === 'error')
  ).length;
  const successfulBuilds = ciBuilds.filter(
    event => event.type === 'ci_run' && event.ci_conclusion === 'success'
  ).length;

  // Calculate build minutes (simplified calculation)
  const totalBuildMinutes = ciBuilds.reduce(
    (acc, event) => acc + (event.duration_ms || 0),
    0
  );

  // Calculate waiting minutes
  const totalWaitingMinutes =
    pr.timeline.filter(event => event.type === 'awaiting_review').length * 60; // Rough estimate

  // Calculate total team review time (from team review requested to first approval)
  const calculateTeamReviewTime = () => {
    const teamReviewRequests = pr.timeline.filter(
      event => event.type === 'team_review_requested'
    );

    let totalReviewTimeMs = 0;

    for (const requestEvent of teamReviewRequests) {
      const teamName = requestEvent.requested_team;
      if (!teamName) continue;

      // Find the first approval from this team
      const firstApproval = pr.timeline.find(
        event =>
          event.type === 'review' &&
          event.state?.toLowerCase() === 'approved' &&
          event.reviewer_teams?.includes(teamName) &&
          new Date(event.date).getTime() > new Date(requestEvent.date).getTime()
      );

      if (firstApproval) {
        const durationMs =
          new Date(firstApproval.date).getTime() -
          new Date(requestEvent.date).getTime();
        totalReviewTimeMs += durationMs;
      }
    }

    return totalReviewTimeMs;
  };

  const totalTeamReviewTimeMs = calculateTeamReviewTime();

  const deliveryFriction = calculateDeliveryFriction(
    pr,
    totalBuildMinutes,
    totalWaitingMinutes
  );
  const frictionFormatted = formatDeliveryFriction(deliveryFriction);

  // Calculate actual run time based on linked issues
  const calculateRunTime = () => {
    // Determine start time
    let startTime: Date;
    if (pr.linked_issues && pr.linked_issues.length > 0) {
      // If there are linked issues, use the earliest issue creation date
      const earliestIssueDate = pr.linked_issues
        .map(issue => new Date(issue.created_at))
        .sort((a, b) => a.getTime() - b.getTime())[0];
      startTime = earliestIssueDate;
    } else {
      // No linked issues, use PR creation date
      startTime = new Date(pr.created_at);
    }

    // Determine end time
    let endTime: Date;
    if (pr.linked_issues && pr.linked_issues.length > 0) {
      // Get the latest of: issue closed dates and PR merged date
      const latestIssueClosed = pr.linked_issues
        .filter(issue => issue.closed_at)
        .map(issue => new Date(issue.closed_at!))
        .sort((a, b) => b.getTime() - a.getTime())[0];

      const prEndDate = pr.merged_at || pr.closed_at;
      const prEndTime = prEndDate ? new Date(prEndDate) : null;

      // Take the latest of issue closed or PR merged/closed
      if (latestIssueClosed && prEndTime) {
        endTime = latestIssueClosed > prEndTime ? latestIssueClosed : prEndTime;
      } else if (latestIssueClosed) {
        endTime = latestIssueClosed;
      } else if (prEndTime) {
        endTime = prEndTime;
      } else {
        // Not closed yet
        endTime = new Date();
      }
    } else {
      // No linked issues, use PR closed/merged date or now
      const prEndDate = pr.closed_at || pr.merged_at;
      endTime = prEndDate ? new Date(prEndDate) : new Date();
    }

    return { startTime, endTime };
  };

  const { startTime, endTime } = calculateRunTime();
  const isComplete = pr.closed_at || pr.merged_at;

  return (
    <div>
      {/* Statistics */}
      <EuiPanel hasBorder hasShadow={false}>
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
              title={formatDuration(totalTeamReviewTimeMs, 'ms')}
              description="Total team review time"
              titleSize="s"
              reverse
              titleColor="primary"
            />
          </EuiFlexItem>
        </EuiFlexGroup>
      </EuiPanel>
    </div>
  );
}
