import { GitHubCollector } from './github-collector';
import { PullRequestStats } from '../types';
import { logger } from '../../shared/logger';

export class PRDataFetcher {
  private collector: GitHubCollector;

  constructor(githubToken: string, slackToken?: string) {
    this.collector = new GitHubCollector(githubToken, slackToken);
  }

  async getPRFromGitHub(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<PullRequestStats | null> {
    logger.info(`Fetching PR from GitHub...`);

    try {
      const { data: pr } = await this.collector.octokit.rest.pulls.get({
        owner,
        repo,
        pull_number: prNumber,
      });

      if (!pr) {
        return null;
      }

      logger.info(`Found PR: ${pr.title} (${pr.user?.login})`);

      const [
        reviewComments,
        issueComments,
        prCommits,
        userTeams,
        codeowners,
        linkedIssues,
        releases,
        slackMessages,
      ] = await Promise.all([
        this.collector.octokit.rest.pulls.listReviewComments({
          owner,
          repo,
          pull_number: prNumber,
        }),
        this.collector.octokit.rest.issues.listComments({
          owner,
          repo,
          issue_number: prNumber,
        }),
        this.collector.octokit.rest.pulls.listCommits({
          owner,
          repo,
          pull_number: prNumber,
        }),
        this.collector.getUserTeams(pr.user?.login || '', owner),
        this.collector.parseCodeowners(owner, repo, prNumber),
        this.collector.getLinkedIssues(owner, repo, pr.body),
        this.collector.getReleasesAfterMerge(owner, repo, pr.merged_at),
        this.collector.getSlackMessages(owner, repo, prNumber, pr.created_at),
      ]);

      const reviewTimings = await this.collector.getReviewTimings(
        owner,
        repo,
        prNumber,
        pr.created_at,
        userTeams,
        prCommits.data,
        issueComments.data,
        pr.user?.login || ''
      );

      const prData = {
        id: pr.number,
        number: pr.number,
        title: pr.title,
        url: pr.html_url,
        state: pr.state,
        createdAt: pr.created_at,
        updatedAt: pr.updated_at,
        closedAt: pr.closed_at,
        mergedAt: pr.merged_at,
        author: { login: pr.user?.login || 'unknown' },
        headRefName: pr.head.ref,
        headSha: pr.head.sha,
        baseRefName: pr.base.ref,
      };

      const timeline = await this.collector.buildPRTimeline(
        owner,
        repo,
        prNumber,
        prData,
        reviewTimings,
        linkedIssues
      );

      const sortedReviews = [...reviewTimings].sort((a, b) =>
        a.submitted_at.localeCompare(b.submitted_at)
      );
      let backAndForthCount = 0;
      let lastChangeRequestedIndex = -1;

      for (let i = 0; i < sortedReviews.length; i++) {
        if (sortedReviews[i].state === 'CHANGES_REQUESTED') {
          lastChangeRequestedIndex = i;
        } else if (
          lastChangeRequestedIndex !== -1 &&
          i > lastChangeRequestedIndex
        ) {
          backAndForthCount++;
          lastChangeRequestedIndex = -1;
        }
      }

      const prStats: PullRequestStats = {
        id: pr.number,
        url: pr.html_url,
        state: pr.state,
        additions: pr.additions || 0,
        author: pr.user?.login || 'unknown',
        changed_files: pr.changed_files || 0,
        created_at: pr.created_at,
        closed_at: pr.closed_at,
        merged_at: pr.merged_at,
        updated_at: pr.updated_at,
        turnaround_time_hours: pr.closed_at
          ? Math.round(
              ((new Date(pr.closed_at).getTime() -
                new Date(pr.created_at).getTime()) /
                (1000 * 60 * 60)) *
                100
            ) / 100
          : 0,
        back_and_forth_count: backAndForthCount,
        comments: issueComments.data.length,
        commits: prCommits.data.length,
        deletions: pr.deletions || 0,
        review_comments: reviewComments.data.length,
        review_timings: reviewTimings,
        title: pr.title,
        timeline: timeline,
        codeowners: codeowners, // Add codeowners to the PR stats
        linked_issues: linkedIssues, // Add linked issues to the PR stats
        releases: releases, // Add releases to the PR stats
        slack_messages: slackMessages, // Add Slack messages to the PR stats
      };

      return prStats;
    } catch (error) {
      logger.error('Error fetching PR from GitHub', {
        prNumber,
        error: error instanceof Error ? error.message : error,
      });
      return null;
    }
  }
}
