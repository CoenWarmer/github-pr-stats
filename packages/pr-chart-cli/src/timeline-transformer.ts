import {
  PullRequestStats,
  TimelineEvent,
  VisTimelineData,
  VisTimelineGroup,
  VisTimelineItem,
} from '../types';
import { formatDuration } from '../utils';

export class PRTimelineToVisJS {
  transformPRsToTimeline(
    prs: PullRequestStats[],
    owner?: string,
    repo?: string
  ): VisTimelineData {
    if (prs.length === 0) {
      return { groups: [], items: [] };
    }

    const pr = prs[0]; // For single PR visualization

    // Get all unique reviewers and their team memberships
    const reviewerTeams = new Map<string, string[]>();
    pr.timeline.forEach(event => {
      if (event.type === 'review' && event.reviewer && event.reviewer_teams) {
        reviewerTeams.set(event.reviewer, event.reviewer_teams);
      }
    });

    // Define the parallel tracks - starting with Releases at the top
    const groups: VisTimelineGroup[] = [];

    let order = 1;

    groups.push({
      id: 'releases',
      content: '🚀 Releases',
      order: order++,
    });

    // Add Discussion row if there are Slack messages
    const hasSlackMessages = pr.slack_messages && pr.slack_messages.length > 0;

    if (hasSlackMessages) {
      groups.push({
        id: 'discussion',
        content: '💬 Discussion',
        order: order++,
      });
    }

    // Add Feature Turnaround row if there are closed linked issues
    const hasClosedLinkedIssues =
      pr.linked_issues?.some(issue => issue.closed_at) || false;

    if (hasClosedLinkedIssues) {
      groups.push({
        id: 'feature-turnaround',
        content: '⏱️ Feature Turnaround',
        order: order++,
      });
    }

    // Add the basic rows
    groups.push(
      { id: 'admin', content: '📋 Administrative', order: order++ },
      { id: 'dev', content: '👨‍💻 Development', order: order++ },
      { id: 'ci', content: '🔧 CI/CD', order: order++ }
    );

    // Add rows for code owner teams
    const codeOwnerTeams = pr.codeowners?.teams || [];
    codeOwnerTeams.forEach(teamName => {
      groups.push({
        id: `team-${teamName}`,
        content: `👥 ${teamName}`,
        order: order++,
      });
    });

    // Add rows for individual code owners (those not in teams)
    const codeOwnerIndividuals = pr.codeowners?.individuals || [];
    codeOwnerIndividuals.forEach(individual => {
      groups.push({
        id: `individual-${individual}`,
        content: `👤 ${individual}`,
        order: order++,
      });
    });

    // Check if there are any non-code-owner reviewers
    const hasAdditionalReviewers = Array.from(reviewerTeams.entries()).some(
      ([reviewer, teams]) => {
        const isCodeOwner = codeOwnerIndividuals.includes(reviewer);
        const isInCodeOwnerTeam = teams.some(team =>
          codeOwnerTeams.includes(team)
        );
        return !isCodeOwner && !isInCodeOwnerTeam;
      }
    );

    // Add single row for all additional reviewers
    if (hasAdditionalReviewers) {
      groups.push({
        id: 'additional-reviewers',
        content: '👥 Additional Reviewers',
        order: order++,
      });
    }

    // Add discussion track at the end
    groups.push({ id: 'discussion', content: '💭 Discussion', order: order });

    const items: VisTimelineItem[] = [];
    let itemId = 0;

    // Process timeline events with consolidation logic for admin events
    const consolidatedEvents = this.consolidateAdminEvents(pr.timeline);

    for (let i = 0; i < consolidatedEvents.length; i++) {
      const event = consolidatedEvents[i];
      const eventTime = new Date(event.date);

      // Calculate end time
      let endTime: Date;
      if (i < consolidatedEvents.length - 1) {
        endTime = new Date(consolidatedEvents[i + 1].date);
      } else {
        // Last event - use closed/merged time or add 1 hour
        endTime =
          pr.closed_at || pr.merged_at
            ? new Date(pr.closed_at || pr.merged_at!)
            : new Date(eventTime.getTime() + 60 * 60 * 1000);
      }

      // Determine group and create item
      const item = this.createTimelineItem(
        event,
        eventTime,
        endTime,
        itemId++,
        pr,
        owner,
        repo
      );
      if (item) {
        items.push(item);
      }
    }

    // Handle CI events specially - pair start/complete events
    const ciItems = this.processCIEvents(pr.timeline);
    items.push(...ciItems.map(item => ({ ...item, id: `ci-${itemId++}` })));

    // Add "Awaiting code owner review" items
    const awaitingItems = this.createAwaitingReviewItems(pr, itemId);
    items.push(...awaitingItems.items);
    itemId = awaitingItems.nextItemId;

    // Add Release items for releases after merge
    if (pr.releases && pr.releases.length > 0) {
      const releaseItems = this.createReleaseItems(pr, itemId);
      items.push(...releaseItems.items);
      itemId = releaseItems.nextItemId;
    }

    // Add Slack Discussion items
    if (pr.slack_messages && pr.slack_messages.length > 0) {
      const discussionItems = this.createDiscussionItems(pr, itemId);
      items.push(...discussionItems.items);
      itemId = discussionItems.nextItemId;
    }

    // Add Feature Turnaround items for closed linked issues
    if (owner && repo) {
      const featureTurnaroundItems = this.createFeatureTurnaroundItems(
        pr,
        itemId,
        owner,
        repo
      );
      items.push(...featureTurnaroundItems.items);
      itemId = featureTurnaroundItems.nextItemId;
    }

    return { groups, items };
  }

  private createTimelineItem(
    event: TimelineEvent,
    start: Date,
    end: Date,
    id: number,
    pr: PullRequestStats,
    owner?: string,
    repo?: string
  ): VisTimelineItem | null {
    const duration = end.getTime() - start.getTime();

    // Define minimum visible duration (15 minutes)
    const minDuration = 15 * 60 * 1000;
    const actualEnd =
      duration < minDuration ? new Date(start.getTime() + minDuration) : end;

    switch (event.type) {
      case 'opened':
        return {
          id: id.toString(),
          group: 'admin',
          start: start.toISOString(),
          content: 'PR Opened',
          title: 'PR opened and immediately ready for review',
          type: 'point',
          className: 'admin-event ready',
        };

      case 'opened_draft':
        return {
          id: id.toString(),
          group: 'admin',
          start: start.toISOString(),
          content: 'Draft PR Opened',
          title: 'PR opened as draft',
          type: 'point',
          className: 'admin-event draft',
        };

      case 'ready_for_review':
        return {
          id: id.toString(),
          group: 'admin',
          start: start.toISOString(),
          content: 'Ready for Review',
          title: 'Draft PR marked as ready for review',
          type: 'point',
          className: 'admin-event ready',
        };

      case 'opened_and_ready':
        return {
          id: id.toString(),
          group: 'admin',
          start: start.toISOString(),
          content: 'PR Opened and set to Ready for Review',
          title: 'PR opened and marked as ready for review (within 5 minutes)',
          type: 'point',
          className: 'admin-event ready',
        };

      case 'opened_draft_and_ready':
        return {
          id: id.toString(),
          group: 'admin',
          start: start.toISOString(),
          content: 'Draft PR Opened and set to Ready for Review',
          title:
            'Draft PR opened then marked as ready for review (within 5 minutes)',
          type: 'point',
          className: 'admin-event ready',
        };

      case 'convert_to_draft':
        return {
          id: id.toString(),
          group: 'admin',
          start: start.toISOString(),
          content: 'Converted to Draft',
          title: 'PR converted back to draft status',
          type: 'point',
          className: 'admin-event draft',
        };

      case 'closed':
      case 'merged':
        return {
          id: id.toString(),
          group: 'admin',
          start: start.toISOString(),
          content: event.type === 'merged' ? 'PR Merged' : 'PR Closed',
          type: 'point',
          className: `admin-event ${event.type}`,
        };

      case 'commits_added':
        const commitCount = event.commit_count || 1;
        const hasCommitDetails = event.commits && event.commits.length > 0;

        // Create tooltip with commit details
        let tooltip = `${commitCount} commit${commitCount > 1 ? 's' : ''} pushed at ${start.toLocaleString()}`;

        if (hasCommitDetails && owner && repo) {
          tooltip += '\n\nCommits:';
          event.commits!.forEach((commit, index) => {
            const shortMessage = commit.message.split('\n')[0];
            const truncatedMessage =
              shortMessage.length > 50
                ? shortMessage.substring(0, 47) + '...'
                : shortMessage;
            tooltip += `\n• ${commit.sha.substring(0, 7)}: ${truncatedMessage} (${commit.author})`;
          });
          tooltip += `\n\nClick to view commits on GitHub`;
        }

        // Create GitHub URL for first commit (or could be multiple)
        const githubUrl =
          hasCommitDetails && owner && repo && event.commits!.length > 0
            ? `https://github.com/${owner}/${repo}/commit/${event.commits![0].sha}`
            : undefined;

        const item: VisTimelineItem = {
          id: id.toString(),
          group: 'dev',
          start: start.toISOString(),
          content: `${commitCount} commit${commitCount > 1 ? 's' : ''}`,
          title: tooltip,
          type: 'point',
          className: hasCommitDetails ? 'dev-commits clickable' : 'dev-commits',
        };

        // Add GitHub URL as custom property for click handling
        if (githubUrl) {
          (item as any).githubUrl = githubUrl;
        }

        return item;

      case 'review':
        // Map reviewer to appropriate group based on team membership and code ownership
        let groupId = 'discussion'; // fallback
        const reviewer = event.reviewer!;
        const reviewerTeamsForEvent = event.reviewer_teams || [];

        // Check if reviewer is individual code owner
        if (pr.codeowners?.individuals.includes(reviewer)) {
          groupId = `individual-${reviewer}`;
        }
        // Check if reviewer is in any code owner team
        else {
          const codeOwnerTeams = pr.codeowners?.teams || [];
          const matchingTeam = reviewerTeamsForEvent.find(team =>
            codeOwnerTeams.includes(team)
          );
          if (matchingTeam) {
            groupId = `team-${matchingTeam}`;
          } else {
            // Reviewer not a code owner, use additional reviewers row
            groupId = 'additional-reviewers';
          }
        }

        const reviewItem: VisTimelineItem = {
          id: id.toString(),
          group: groupId,
          start: start.toISOString(),
          content: `${reviewer}: ${event.state?.toLowerCase()}`,
          title: `Review by ${reviewer} - ${event.state}\n\nClick to view review on GitHub`,
          type: 'point',
          className: event.comment_url
            ? `review-${event.state?.toLowerCase()} clickable`
            : `review-${event.state?.toLowerCase()}`,
        };

        // Add GitHub URL for clickable reviews
        if (event.comment_url) {
          (reviewItem as any).githubUrl = event.comment_url;
        }

        return reviewItem;

      case 'comment_added':
      case 'review_comment_added':
        // Check if this is an elasticmachine comment (CI bot)
        if (event.comment_author === 'elasticmachine') {
          const content = this.parseElasticMachineComment(
            event.comment_content || ''
          );
          return {
            id: id.toString(),
            group: 'ci',
            start: start.toISOString(),
            content: content.label,
            title: `${content.title} - ${event.comment_author}`,
            type: 'point',
            className: content.className,
          };
        } else {
          // Create enhanced tooltip for discussion comments
          const hasCommentUrl = event.comment_url;
          const commentPreview = event.comment_content
            ? event.comment_content.substring(0, 100) +
              (event.comment_content.length > 100 ? '...' : '')
            : '';

          let tooltip = `Comment by ${event.comment_author} at ${start.toLocaleString()}`;
          if (commentPreview) {
            tooltip += `\n\n"${commentPreview}"`;
          }
          if (hasCommentUrl) {
            tooltip += '\n\nClick to view comment on GitHub';
          }

          const item: VisTimelineItem = {
            id: id.toString(),
            group: 'discussion',
            start: start.toISOString(),
            content: `${event.comment_author}`,
            title: tooltip,
            type: 'point',
            className: hasCommentUrl
              ? 'discussion-comment clickable'
              : 'discussion-comment',
          };

          // Add GitHub URL as custom property for click handling
          if (hasCommentUrl) {
            (item as any).githubUrl = event.comment_url;
          }

          return item;
        }

      // CI events are handled separately in processCIEvents
      case 'ci_started':
      case 'ci_completed':
      case 'ci_failed':
        return null;

      // Issue lifecycle events
      case 'issue_created':
        const createdItem: VisTimelineItem = {
          id: id.toString(),
          group: 'admin',
          start: start.toISOString(),
          content: `📝 Issue #${event.issue_number} Created`,
          title: `Issue #${event.issue_number}: ${event.issue_title} was created\n\nClick to view issue on GitHub`,
          type: 'point',
          className: event.comment_url
            ? 'admin-event issue-created clickable'
            : 'admin-event issue-created',
        };
        if (event.comment_url) {
          (createdItem as any).githubUrl = event.comment_url;
        }
        return createdItem;

      case 'issue_assigned':
        const assigneeDisplay = event.assignee ? ` to @${event.assignee}` : '';
        const assignedItem: VisTimelineItem = {
          id: id.toString(),
          group: 'admin',
          start: start.toISOString(),
          content: `👤 Issue #${event.issue_number} Assigned${assigneeDisplay}`,
          title: `Issue #${event.issue_number}: ${event.issue_title} was assigned${event.assignee ? ` to @${event.assignee}` : ''}\n\nClick to view issue on GitHub`,
          type: 'point',
          className: event.comment_url
            ? 'admin-event issue-assigned clickable'
            : 'admin-event issue-assigned',
        };
        if (event.comment_url) {
          (assignedItem as any).githubUrl = event.comment_url;
        }
        return assignedItem;

      case 'issue_unassigned':
        const unassigneeDisplay = event.assignee
          ? ` from @${event.assignee}`
          : '';
        const unassignedItem: VisTimelineItem = {
          id: id.toString(),
          group: 'admin',
          start: start.toISOString(),
          content: `👤 Issue #${event.issue_number} Unassigned${unassigneeDisplay}`,
          title: `Issue #${event.issue_number}: ${event.issue_title} was unassigned${event.assignee ? ` from @${event.assignee}` : ''}\n\nClick to view issue on GitHub`,
          type: 'point',
          className: event.comment_url
            ? 'admin-event issue-unassigned clickable'
            : 'admin-event issue-unassigned',
        };
        if (event.comment_url) {
          (unassignedItem as any).githubUrl = event.comment_url;
        }
        return unassignedItem;

      case 'issue_in_progress':
        const inProgressItem: VisTimelineItem = {
          id: id.toString(),
          group: 'admin',
          start: start.toISOString(),
          content: `🚀 Issue #${event.issue_number} In Progress`,
          title: `Issue #${event.issue_number}: ${event.issue_title} marked as in progress\n\nClick to view issue on GitHub`,
          type: 'point',
          className: event.comment_url
            ? 'admin-event issue-in-progress clickable'
            : 'admin-event issue-in-progress',
        };
        if (event.comment_url) {
          (inProgressItem as any).githubUrl = event.comment_url;
        }
        return inProgressItem;

      case 'issue_closed':
        const closedItem: VisTimelineItem = {
          id: id.toString(),
          group: 'admin',
          start: start.toISOString(),
          content: `✅ Issue #${event.issue_number} Closed`,
          title: `Issue #${event.issue_number}: ${event.issue_title} was closed\n\nClick to view issue on GitHub`,
          type: 'point',
          className: event.comment_url
            ? 'admin-event issue-closed clickable'
            : 'admin-event issue-closed',
        };
        if (event.comment_url) {
          (closedItem as any).githubUrl = event.comment_url;
        }
        return closedItem;

      default:
        return {
          id: id.toString(),
          group: 'admin',
          start: start.toISOString(),
          content: event.type.replace('_', ' '),
          type: 'point',
          className: 'other-event',
        };
    }
  }

  private processCIEvents(
    timeline: TimelineEvent[]
  ): Omit<VisTimelineItem, 'id'>[] {
    const ciItems: Omit<VisTimelineItem, 'id'>[] = [];
    const startedJobs = new Map<
      string,
      { event: TimelineEvent; start: Date }
    >();

    timeline.forEach(event => {
      if (event.type === 'ci_started') {
        startedJobs.set(event.workflow_name!, {
          event,
          start: new Date(event.date),
        });
      } else if (event.type === 'ci_completed' || event.type === 'ci_failed') {
        const workflowName = event.workflow_name!;
        const startInfo = startedJobs.get(workflowName);

        if (startInfo) {
          const endTime = new Date(event.date);
          const duration = endTime.getTime() - startInfo.start.getTime();

          ciItems.push({
            group: 'ci',
            start: startInfo.start.toISOString(),
            end: endTime.toISOString(),
            content: workflowName,
            title: `${workflowName}: ${Math.round(duration / 1000 / 60)} minutes - ${event.ci_conclusion}`,
            type: 'range',
            className: `ci-${event.ci_conclusion?.toLowerCase()}`,
            style:
              event.ci_conclusion === 'success'
                ? 'background-color: #90EE90;'
                : 'background-color: #FFB6C1;',
          });

          startedJobs.delete(workflowName);
        }
      }
    });

    // Handle any remaining started jobs that didn't complete
    startedJobs.forEach((startInfo, workflowName) => {
      const endTime = new Date(startInfo.start.getTime() + 10 * 60 * 1000); // 10 minutes default

      ciItems.push({
        group: 'ci',
        start: startInfo.start.toISOString(),
        end: endTime.toISOString(),
        content: `${workflowName} (ongoing)`,
        title: `${workflowName}: Still running`,
        type: 'range',
        className: 'ci-running',
        style: 'background-color: #FFA500;',
      });
    });

    return ciItems;
  }

  private createAwaitingReviewItems(
    pr: PullRequestStats,
    startingItemId: number
  ): { items: VisTimelineItem[]; nextItemId: number } {
    const items: VisTimelineItem[] = [];
    let itemId = startingItemId;

    // Find when PR became ready for review (the actual ready event, not just opened)
    const readyForReviewEvent = pr.timeline.find(
      event =>
        event.type === 'ready_for_review' ||
        event.type === 'opened_and_ready' ||
        (event.type === 'opened' &&
          !pr.timeline.some(e => e.type === 'ready_for_review'))
    );

    if (!readyForReviewEvent) return { items, nextItemId: itemId };

    const readyTime = new Date(readyForReviewEvent.date);

    // Create awaiting items for each code owner team
    const codeOwnerTeams = pr.codeowners?.teams || [];
    codeOwnerTeams.forEach(teamName => {
      // Find first review from this team
      const firstTeamReview = pr.timeline.find(
        event =>
          event.type === 'review' &&
          event.reviewer_teams &&
          event.reviewer_teams.includes(teamName)
      );

      if (firstTeamReview) {
        const reviewTime = new Date(firstTeamReview.date);
        const duration = formatDuration(readyTime, reviewTime);

        items.push({
          id: itemId.toString(),
          group: `team-${teamName}`,
          start: readyTime.toISOString(),
          end: reviewTime.toISOString(),
          content: `Awaiting code owner review (${duration})`,
          title: `Waiting for ${teamName} review`,
          type: 'range',
          className: 'awaiting-review',
        });
        itemId++;
      } else {
        // No review yet - show as ongoing
        const now =
          pr.closed_at || pr.merged_at
            ? new Date(pr.closed_at || pr.merged_at!)
            : new Date();
        const duration = formatDuration(readyTime, now);

        items.push({
          id: itemId.toString(),
          group: `team-${teamName}`,
          start: readyTime.toISOString(),
          end: now.toISOString(),
          content: `Awaiting code owner review (${duration})`,
          title: `Still waiting for ${teamName} review`,
          type: 'range',
          className: 'awaiting-review pending',
        });
        itemId++;
      }
    });

    // Create awaiting items for individual code owners
    const codeOwnerIndividuals = pr.codeowners?.individuals || [];
    codeOwnerIndividuals.forEach(individual => {
      // Find first review from this individual
      const firstIndividualReview = pr.timeline.find(
        event => event.type === 'review' && event.reviewer === individual
      );

      if (firstIndividualReview) {
        const reviewTime = new Date(firstIndividualReview.date);
        const duration = formatDuration(readyTime, reviewTime);

        items.push({
          id: itemId.toString(),
          group: `individual-${individual}`,
          start: readyTime.toISOString(),
          end: reviewTime.toISOString(),
          content: `Awaiting code owner review (${duration})`,
          title: `Waiting for ${individual} review`,
          type: 'range',
          className: 'awaiting-review',
        });
        itemId++;
      } else {
        // No review yet - show as ongoing
        const now =
          pr.closed_at || pr.merged_at
            ? new Date(pr.closed_at || pr.merged_at!)
            : new Date();
        const duration = formatDuration(readyTime, now);

        items.push({
          id: itemId.toString(),
          group: `individual-${individual}`,
          start: readyTime.toISOString(),
          end: now.toISOString(),
          content: `Awaiting code owner review (${duration})`,
          title: `Still waiting for ${individual} review`,
          type: 'range',
          className: 'awaiting-review pending',
        });
        itemId++;
      }
    });

    return { items, nextItemId: itemId };
  }

  private consolidateAdminEvents(timeline: TimelineEvent[]): TimelineEvent[] {
    const consolidated: TimelineEvent[] = [];
    const CONSOLIDATION_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

    for (let i = 0; i < timeline.length; i++) {
      const currentEvent = timeline[i];

      // Check if this is a PR opened event
      if (
        currentEvent.type === 'opened' ||
        currentEvent.type === 'opened_draft'
      ) {
        // Look for a ready_for_review event within 5 minutes
        const nextEvents = timeline.slice(i + 1, i + 5); // Check next few events
        const readyEvent = nextEvents.find(
          event =>
            event.type === 'ready_for_review' &&
            Math.abs(
              new Date(event.date).getTime() -
                new Date(currentEvent.date).getTime()
            ) <= CONSOLIDATION_THRESHOLD_MS
        );

        if (readyEvent) {
          // Consolidate the events
          const consolidatedEvent: TimelineEvent = {
            ...currentEvent,
            type: 'opened_and_ready',
            date: currentEvent.date, // Use the earlier timestamp
          };
          consolidated.push(consolidatedEvent);

          // Skip the ready_for_review event since we've consolidated it
          const skipIndex = timeline.indexOf(readyEvent);
          if (skipIndex > i) {
            i = skipIndex; // Skip to after the ready_for_review event
          }
        } else {
          consolidated.push(currentEvent);
        }
      }
      // Check if this is a standalone ready_for_review that wasn't already consolidated
      else if (currentEvent.type === 'ready_for_review') {
        // Check if the previous event was an opened event within 5 minutes
        const prevEvent = consolidated[consolidated.length - 1];
        const isAlreadyConsolidated =
          prevEvent &&
          (prevEvent.type === 'opened_and_ready' ||
            prevEvent.type === 'opened_draft_and_ready') &&
          Math.abs(
            new Date(currentEvent.date).getTime() -
              new Date(prevEvent.date).getTime()
          ) <= CONSOLIDATION_THRESHOLD_MS;

        if (!isAlreadyConsolidated) {
          consolidated.push(currentEvent);
        }
      } else {
        consolidated.push(currentEvent);
      }
    }

    return consolidated;
  }

  private parseElasticMachineComment(content: string): {
    label: string;
    title: string;
    className: string;
  } {
    const lowerContent = content.toLowerCase();

    if (lowerContent.includes('build succeeded')) {
      return {
        label: 'Build succeeded',
        title: 'Automated build success notification',
        className: 'ci-success',
      };
    }

    if (
      lowerContent.includes('build failed') ||
      lowerContent.includes('Some checks were not successful')
    ) {
      return {
        label: 'Build failed',
        title: 'Automated build failure notification',
        className: 'ci-failure',
      };
    }

    // Check for other common patterns
    if (lowerContent.includes('test') && lowerContent.includes('passed')) {
      return {
        label: 'Tests passed',
        title: 'Automated test success notification',
        className: 'ci-success',
      };
    }

    if (
      lowerContent.includes('test') &&
      (lowerContent.includes('failed') || lowerContent.includes('failure'))
    ) {
      return {
        label: 'Tests failed',
        title: 'Automated test failure notification',
        className: 'ci-failure',
      };
    }

    if (
      lowerContent.includes('deployment') &&
      lowerContent.includes('successful')
    ) {
      return {
        label: 'Deployment successful',
        title: 'Automated deployment success notification',
        className: 'ci-success',
      };
    }

    if (
      lowerContent.includes('deployment') &&
      lowerContent.includes('failed')
    ) {
      return {
        label: 'Deployment failed',
        title: 'Automated deployment failure notification',
        className: 'ci-failure',
      };
    }

    if (lowerContent.includes('Pinging ')) {
      return {
        label: 'Pinging Codeowners',
        title: 'Pinging Codeowners',
        className: 'ci-bot-comment',
      };
    }

    // Default fallback for unrecognized content
    return {
      label: 'Bot notification',
      title: `Automated notification from elasticmachine ${lowerContent}`,
      className: 'ci-bot-comment',
    };
  }

  private createFeatureTurnaroundItems(
    pr: PullRequestStats,
    startingItemId: number,
    owner: string,
    repo: string
  ): { items: VisTimelineItem[]; nextItemId: number } {
    const items: VisTimelineItem[] = [];
    let itemId = startingItemId;

    if (!pr.linked_issues || pr.linked_issues.length === 0) {
      return { items, nextItemId: itemId };
    }

    // Create turnaround items for closed issues only
    const closedIssues = pr.linked_issues.filter(issue => issue.closed_at);

    for (const issue of closedIssues) {
      const startTime = new Date(issue.created_at);
      const endTime = new Date(issue.closed_at!);
      const durationMs = endTime.getTime() - startTime.getTime();
      const durationDays =
        Math.round((durationMs / (1000 * 60 * 60 * 24)) * 10) / 10;

      // Format duration for display
      const formatDuration = (days: number): string => {
        if (days < 1) {
          const hours = Math.round(days * 24);
          return `${hours}h`;
        } else if (days < 7) {
          return `${days}d`;
        } else {
          const weeks = Math.round((days / 7) * 10) / 10;
          return `${weeks}w`;
        }
      };

      const turnaroundItem: VisTimelineItem = {
        id: itemId.toString(),
        group: 'feature-turnaround',
        start: startTime.toISOString(),
        end: endTime.toISOString(),
        content: `Issue #${issue.number} (${formatDuration(durationDays)})`,
        title: `Feature Turnaround: Issue #${issue.number}\n${issue.title}\n\nDuration: ${formatDuration(durationDays)}\nCreated: ${startTime.toLocaleDateString()}\nClosed: ${endTime.toLocaleDateString()}\n\nClick to view issue on GitHub`,
        type: 'range',
        className: 'feature-turnaround clickable',
      };

      // Add GitHub URL for clickable issue
      (turnaroundItem as any).githubUrl = issue.url;

      items.push(turnaroundItem);
      itemId++;
    }

    return { items, nextItemId: itemId };
  }

  private createReleaseItems(
    pr: PullRequestStats,
    startingItemId: number
  ): { items: VisTimelineItem[]; nextItemId: number } {
    const items: VisTimelineItem[] = [];
    let itemId = startingItemId;

    if (!pr.releases || pr.releases.length === 0) {
      return { items, nextItemId: itemId };
    }

    // Create release item for the first release published after PR merge
    const firstRelease = pr.releases[0]; // Releases are already sorted by date
    if (firstRelease) {
      const releaseDate = new Date(firstRelease.published_at);
      const mergeDate = pr.merged_at ? new Date(pr.merged_at) : null;

      // Calculate time from merge to release
      let timeToRelease = '';
      if (mergeDate) {
        const durationMs = releaseDate.getTime() - mergeDate.getTime();
        const durationDays =
          Math.round((durationMs / (1000 * 60 * 60 * 24)) * 10) / 10;

        if (durationDays < 1) {
          const hours = Math.round(durationDays * 24);
          timeToRelease = `${hours}h after merge`;
        } else if (durationDays < 7) {
          timeToRelease = `${durationDays}d after merge`;
        } else {
          const weeks = Math.round((durationDays / 7) * 10) / 10;
          timeToRelease = `${weeks}w after merge`;
        }
      }

      const releaseItem: VisTimelineItem = {
        id: itemId.toString(),
        group: 'releases',
        start: releaseDate.toISOString(),
        content: `${firstRelease.tag_name}${firstRelease.prerelease ? ' (pre)' : ''}`,
        title: `Release: ${firstRelease.name || firstRelease.tag_name}\n${firstRelease.prerelease ? 'Pre-release\n' : ''}Published: ${releaseDate.toLocaleDateString()} ${releaseDate.toLocaleTimeString()}\n${timeToRelease ? timeToRelease + '\n' : ''}\nClick to view release on GitHub`,
        type: 'point',
        className: `release ${firstRelease.prerelease ? 'prerelease' : 'stable'} clickable`,
      };

      // Add GitHub URL for clickable release
      (releaseItem as any).githubUrl = firstRelease.html_url;

      items.push(releaseItem);
      itemId++;
    }

    return { items, nextItemId: itemId };
  }

  private createDiscussionItems(
    pr: PullRequestStats,
    startingItemId: number
  ): { items: VisTimelineItem[]; nextItemId: number } {
    const items: VisTimelineItem[] = [];
    let itemId = startingItemId;

    if (!pr.slack_messages || pr.slack_messages.length === 0) {
      return { items, nextItemId: itemId };
    }

    // Create discussion items for Slack messages
    for (const message of pr.slack_messages) {
      const messageDate = new Date(message.timestamp);

      // Truncate long messages for display
      const maxLength = 60;
      let displayText = message.text.replace(/\n/g, ' ').trim();
      if (displayText.length > maxLength) {
        displayText = displayText.substring(0, maxLength) + '...';
      }

      const discussionItem: VisTimelineItem = {
        id: itemId.toString(),
        group: 'discussion',
        start: messageDate.toISOString(),
        content: `💬 ${message.username || 'Unknown'}: ${displayText}`,
        title: `Slack Discussion\nChannel: #${message.channel_name || message.channel}\nUser: ${message.username || message.user}\nTime: ${messageDate.toLocaleDateString()} ${messageDate.toLocaleTimeString()}\n\nMessage:\n${message.text}\n\nClick to view in Slack`,
        type: 'point',
        className: 'discussion slack-message clickable',
      };

      // Add Slack permalink for clickable message
      if (message.permalink) {
        (discussionItem as any).slackUrl = message.permalink;
      }

      items.push(discussionItem);
      itemId++;
    }

    return { items, nextItemId: itemId };
  }
}
