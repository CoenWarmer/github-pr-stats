import { Octokit } from '@octokit/rest';
import { LinkedIssue, IssueLifecycleEvent } from '../types';
import { logger } from '../logger';

/**
 * Service for handling linked issues and their lifecycle events
 */
export class IssuesService {
  private octokit: Octokit;

  constructor(octokit: Octokit) {
    this.octokit = octokit;
  }

  /**
   * Get linked issues from PR body and timeline
   */
  async getLinkedIssues(
    owner: string,
    repo: string,
    prBody: string | null,
    prNumber?: number,
    prTimelineEvents?: any[]
  ): Promise<LinkedIssue[]> {
    if (!prBody) {
      return [];
    }

    try {
      const issueNumbers = this.extractIssueNumbers(prBody, owner, repo);

      // Check PR timeline for connected issues
      if (prNumber && prTimelineEvents) {
        for (const event of prTimelineEvents) {
          if (
            event.event === 'connected' ||
            event.event === 'cross-referenced'
          ) {
            const source = event.source;
            if (source?.issue && !source.issue.pull_request) {
              issueNumbers.add(source.issue.number);
            }
          }
        }
      }

      if (issueNumbers.size === 0) {
        return [];
      }

      const issues: LinkedIssue[] = [];

      for (const issueNumber of issueNumbers) {
        try {
          const { data: issue } = await this.octokit.rest.issues.get({
            owner,
            repo,
            issue_number: issueNumber,
          });

          if (issue.pull_request) {
            continue;
          }

          const lifecycleEvents = await this.getIssueLifecycleEvents(
            owner,
            repo,
            issueNumber,
            issue.created_at
          );

          const projectIteration = await this.getIssueProjectIteration(
            owner,
            repo,
            issueNumber
          );

          issues.push({
            number: issue.number,
            title: issue.title,
            url: issue.html_url,
            state: issue.state,
            labels: issue.labels
              .map(label =>
                typeof label === 'string' ? label : label.name || ''
              )
              .filter(Boolean),
            assignees:
              issue.assignees?.map(assignee => assignee.login || '') || [],
            created_at: issue.created_at,
            closed_at: issue.closed_at,
            lifecycle_events: lifecycleEvents,
            project_iteration: projectIteration || undefined,
          });

          await new Promise(resolve => setTimeout(resolve, 100));
        } catch {
          continue;
        }
      }

      return issues;
    } catch (error) {
      logger.error('Error fetching linked issues', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Extract issue numbers from PR body
   */
  private extractIssueNumbers(
    prBody: string,
    owner: string,
    repo: string
  ): Set<number> {
    const issuePatterns = [
      /(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|address(?:e[sd])?)\s*:?\s*#(\d+)/gi,
      /(?:related\s+to|see|ref(?:erence)?|relates?\s+to)\s*:?\s*#(\d+)/gi,
      /(?:closes?|fixes?|resolves?)\s+#(\d+)/gi,
      /(?:^|\s)#(\d+)(?:\s|$|[.,!?])/g,
      new RegExp(`https://github\\.com/${owner}/${repo}/issues/(\\d+)`, 'gi'),
    ];

    const issueNumbers = new Set<number>();

    for (const pattern of issuePatterns) {
      let match;
      while ((match = pattern.exec(prBody)) !== null) {
        const issueNumber = parseInt(match[1]);
        if (issueNumber) {
          issueNumbers.add(issueNumber);
        }
      }
    }

    return issueNumbers;
  }

  /**
   * Get lifecycle events for an issue
   */
  async getIssueLifecycleEvents(
    owner: string,
    repo: string,
    issueNumber: number,
    issueCreatedAt: string
  ): Promise<IssueLifecycleEvent[]> {
    try {
      const { data: events } = await this.octokit.rest.issues.listEvents({
        owner,
        repo,
        issue_number: issueNumber,
        per_page: 100,
      });

      const lifecycleEvents: IssueLifecycleEvent[] = [];
      lifecycleEvents.push({
        event_type: 'created',
        date: issueCreatedAt,
      });

      let hasClosedEvent = false;

      for (const event of events) {
        if (event.event === 'assigned' && event.assignee) {
          lifecycleEvents.push({
            event_type: 'assigned',
            date: event.created_at,
            assignee: event.assignee.login,
          });
        } else if (event.event === 'closed' && event.created_at) {
          lifecycleEvents.push({
            event_type: 'closed',
            date: event.created_at,
          });
          hasClosedEvent = true;
        }
      }

      // If the issue is still open, add an "in_progress" event
      if (!hasClosedEvent) {
        lifecycleEvents.push({
          event_type: 'in_progress',
          date: issueCreatedAt,
          end_date: new Date().toISOString(),
        });
      }

      return lifecycleEvents;
    } catch (error) {
      logger.warn(
        `Could not fetch lifecycle events for issue #${issueNumber}`,
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return [];
    }
  }

  /**
   * Get project iteration information for an issue
   */
  async getIssueProjectIteration(
    owner: string,
    repo: string,
    issueNumber: number
  ): Promise<{
    projectUrl: string;
    iterationTitle: string;
    iterationStartDate: string;
    iterationEndDate: string;
  } | null> {
    try {
      const query = `
        query GetIssueIteration($owner: String!, $repo: String!, $issueNumber: Int!) {
          repository(owner: $owner, name: $repo) {
            issue(number: $issueNumber) {
              projectItems(first: 10) {
                nodes {
                  project {
                    number
                    title
                  }
                  fieldValueByName(name: "Iteration") {
                    ... on ProjectV2ItemFieldIterationValue {
                      title
                      startDate
                      duration
                      iterationId
                    }
                  }
                }
              }
            }
          }
        }
      `;

      const result: any = await this.octokit.graphql(query, {
        owner,
        repo,
        issueNumber,
      });

      const projectItems = result.repository.issue.projectItems.nodes;

      for (const item of projectItems) {
        const iterationField = item.fieldValueByName;
        if (iterationField && iterationField.title) {
          const startDate = new Date(iterationField.startDate);
          const endDate = new Date(startDate);
          endDate.setDate(endDate.getDate() + iterationField.duration);

          const projectUrl = `https://github.com/orgs/${owner}/projects/${item.project.number}?query=is%3Aopen+iteration%3A"${encodeURIComponent(iterationField.title)}"`;

          return {
            projectUrl,
            iterationTitle: iterationField.title,
            iterationStartDate: startDate.toISOString(),
            iterationEndDate: endDate.toISOString(),
          };
        }
      }

      return null;
    } catch {
      return null;
    }
  }
}
