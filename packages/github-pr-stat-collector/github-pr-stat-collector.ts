import { Octokit } from '@octokit/rest';
import { Client } from '@elastic/elasticsearch';
import * as dotenv from 'dotenv';
import {
  fetchTeamsWithParents,
  analyzeTeamRelationship,
  Team,
  fetchCodeowners,
  parseCodeowners,
  teamsHierarchyToMermaid,
  codeownersToTeamsMermaid,
  writeMarkdownFile,
} from './build-org-dependency-graph';
import { flatten } from 'flat';

// Load environment variables from .env file
dotenv.config();

interface TimelineEvent {
  type:
    | 'opened'
    | 'closed'
    | 'merged'
    | 'review'
    | 'commits_added'
    | 'ci_started'
    | 'ci_completed'
    | 'ci_failed'
    | 'comment_added'
    | 'review_comment_added'
    | 'ready_for_review'
    | 'converted_to_draft';
  date: string;
  // Optional fields depending on event type
  state?: string; // for reviews
  reviewer?: string; // for reviews
  submitted_at?: string; // for reviews (same as date but kept for consistency)
  time_to_review_hours?: number; // for reviews
  reviewer_teams?: string[]; // for reviews
  author_reviewer_relationship?:
    | 'same-team'
    | 'intra-team'
    | 'intra-department'
    | 'cross-department'; // for reviews
  commit_count?: number; // for commits_added
  comment_author?: string; // for comments
  ci_status?: string; // for CI events
  ci_conclusion?: string; // for CI events
  workflow_name?: string; // for CI events
}

interface UserTeamInfo {
  login: string;
  id: number;
  teams: string[];
}

interface CodeOwner {
  username: string;
  teams: string[];
}

interface ReviewTiming {
  reviewer: string;
  submitted_at: string;
  time_to_review_hours: number;
  state: string; // 'APPROVED', 'CHANGES_REQUESTED', 'COMMENTED'
  author_teams: string[]; // teams of the author
  reviewer_teams: string[]; // teams of the reviewer
  author_reviewer_relationship:
    | 'same-team'
    | 'intra-team'
    | 'intra-department'
    | 'cross-department';
  time_to_new_commits_pushed?: number; // hours
  time_to_author_response?: number; // hours
}

interface PullRequestStats {
  id: string | number;
  url: string;
  state: string;
  additions: number;
  author: string;
  // author_teams: string[];
  changed_files: number;
  created_at: string;
  closed_at: string | null;
  merged_at: string | null;
  updated_at: string;
  turnaround_time_hours: number;
  back_and_forth_count: number;
  // codeowners: CodeOwner[];
  comments: number;
  commits: number;
  deletions: number;
  review_comments: number;
  review_timings: ReviewTiming[];
  title: string;
  timeline: TimelineEvent[]; // NEW: Timeline of events
}

interface PR {
  id: number;
  title: string;
  url: string;
  state: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  mergedAt: string | null;
  author?: { login: string } | null;
  headRefName: string | null;
  baseRefName: string | null;
}

class GitHubPRStatsCollector {
  readonly octokit: Octokit;
  private readonly elasticsearch: Client;
  private teamsCache: Map<string, Team[]> = new Map();

  constructor(
    githubToken: string,
    elasticsearchUrl: string,
    elasticsearchApiKey?: string
  ) {
    this.octokit = new Octokit({
      auth: githubToken,
    });

    const elasticsearchConfig: any = {
      node: elasticsearchUrl,
    };

    if (elasticsearchApiKey) {
      elasticsearchConfig.auth = {
        apiKey: elasticsearchApiKey,
      };
    }

    this.elasticsearch = new Client(elasticsearchConfig);
  }

  private async getTeamsForOrg(org: string): Promise<Team[]> {
    if (!this.teamsCache.has(org)) {
      try {
        const teams = await fetchTeamsWithParents(org);
        this.teamsCache.set(org, teams);
      } catch (error) {
        console.warn(`Failed to fetch teams for org ${org}:`, error);
        this.teamsCache.set(org, []);
      }
    }
    return this.teamsCache.get(org) || [];
  }

  async getUserTeams(username: string, org: string) {
    const query = `
    query($org: String!, $login: String!, $after: String) {
      organization(login: $org) {
        teams(first: 100, userLogins: [$login], after: $after) {
          nodes {
            name
            slug
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  `;

    let teams: { name: string; slug: string }[] = [];
    let after: string | null = null;

    do {
      const response: any = await this.octokit.graphql(query, {
        org,
        login: username,
        after,
      });

      const teamNodes = response.organization.teams.nodes;
      teams.push(...teamNodes);

      const pageInfo = response.organization.teams.pageInfo;
      after = pageInfo.hasNextPage ? pageInfo.endCursor : null;
    } while (after);

    return teams.map((team: { name: string; slug: string }) => team.name);
  }

  private async getCodeownersContent(
    owner: string,
    repo: string
  ): Promise<string> {
    const possiblePaths = [
      '.github/CODEOWNERS',
      'CODEOWNERS',
      'docs/CODEOWNERS',
    ];

    for (const path of possiblePaths) {
      try {
        const { data } = await this.octokit.rest.repos.getContent({
          owner,
          repo,
          path,
        });

        if ('content' in data) {
          return Buffer.from(data.content, 'base64').toString('utf-8');
        }
      } catch {
        // Continue to next path if file not found
      }
    }

    return '';
  }

  private isFileMatchingPattern(file: string, pathPattern: string): boolean {
    if (pathPattern === '*') return true;
    if (pathPattern.endsWith('/*')) {
      const dir = pathPattern.slice(0, -2);
      return file.startsWith(dir + '/');
    }
    if (pathPattern.includes('*')) {
      const regex = new RegExp(pathPattern.replace(/\*/g, '.*'));
      return regex.test(file);
    }
    return file === pathPattern || file.startsWith(pathPattern + '/');
  }

  private async processCodeowner(
    owner: string,
    ownerString: string
  ): Promise<CodeOwner> {
    const cleanOwner = ownerString.replace('@', '');

    if (cleanOwner.includes('/')) {
      // It's a team (@org/team)
      const [, teamName] = cleanOwner.split('/');
      return {
        username: cleanOwner,
        teams: [teamName],
      };
    } else {
      // It's a user
      const userTeams = await this.getUserTeams(cleanOwner, owner);
      return {
        username: cleanOwner,
        teams: userTeams,
      };
    }
  }

  async parseCodeowners(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<string[]> {
    try {
      // Get CODEOWNERS file content
      const codeownersContent = await this.getCodeownersContent(owner, repo);

      if (!codeownersContent) {
        console.warn(`No CODEOWNERS file found for ${owner}/${repo}`);
        return [];
      }

      // Get the files changed in this PR
      const { data: files } = await this.octokit.rest.pulls.listFiles({
        owner,
        repo,
        pull_number: prNumber,
      });

      const changedFiles = files.map(file => file.filename);
      const codeowners: CodeOwner[] = [];
      const processedOwners = new Set<string>();

      // Parse CODEOWNERS and match against changed files
      const lines = codeownersContent.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const parts = trimmed.split(/\s+/);
        if (parts.length < 2) continue;

        const pathPattern = parts[0];
        const owners = parts.slice(1);

        // Check if any changed files match this pattern
        const isMatching = changedFiles.some(file =>
          this.isFileMatchingPattern(file, pathPattern)
        );

        if (isMatching) {
          for (const ownerString of owners) {
            const cleanOwner = ownerString.replace('@', '');
            if (!processedOwners.has(cleanOwner)) {
              processedOwners.add(cleanOwner);
              const codeowner = await this.processCodeowner(owner, ownerString);
              codeowners.push(codeowner);
            }
          }
        }
      }

      return codeowners.flatMap(co => co.teams);
    } catch (error) {
      console.error('Error parsing CODEOWNERS:', error);
      return [];
    }
  }

  /**
   * NEW: Build a comprehensive timeline of events for a PR
   */
  async buildPRTimeline(
    owner: string,
    repo: string,
    prNumber: number,
    prData: PR,
    reviewTimings: ReviewTiming[]
  ): Promise<TimelineEvent[]> {
    const timeline: TimelineEvent[] = [];

    try {
      // 1. PR opened event
      timeline.push({
        type: 'opened',
        date: prData.createdAt,
      });

      // 2. Get commits and add commit events
      const { data: commits } = await this.octokit.rest.pulls.listCommits({
        owner,
        repo,
        pull_number: prNumber,
      });

      // Group commits by date (to avoid too many individual commit events)
      const commitsByDate = new Map<string, number>();
      commits.forEach(commit => {
        const date =
          commit.commit.author?.date || commit.commit.committer?.date;
        if (date) {
          const dateKey = date.split('T')[0]; // Group by day
          commitsByDate.set(dateKey, (commitsByDate.get(dateKey) || 0) + 1);
        }
      });

      // Add commit events (grouped by date)
      commitsByDate.forEach((count, dateKey) => {
        timeline.push({
          type: 'commits_added',
          date: `${dateKey}T12:00:00Z`, // Use noon as default time
          commit_count: count,
        });
      });

      // 3. Get check runs (CI events)
      try {
        const { data: checkRuns } = await this.octokit.rest.checks.listForRef({
          owner,
          repo,
          ref: `refs/pull/${prNumber}/head`,
          per_page: 100,
        });

        // Process CI events
        checkRuns.check_runs.forEach(checkRun => {
          if (checkRun.started_at) {
            timeline.push({
              type: 'ci_started',
              date: checkRun.started_at,
              ci_status: checkRun.status,
              workflow_name: checkRun.name,
            });
          }

          if (checkRun.completed_at) {
            const eventType =
              checkRun.conclusion === 'success' ? 'ci_completed' : 'ci_failed';
            timeline.push({
              type: eventType,
              date: checkRun.completed_at,
              ci_status: checkRun.status,
              ci_conclusion: checkRun.conclusion || 'unknown',
              workflow_name: checkRun.name,
            });
          }
        });
      } catch (error) {
        console.warn(`Could not fetch check runs for PR #${prNumber}:`, error);
      }

      // 4. Add review events from reviewTimings
      reviewTimings.forEach(review => {
        timeline.push({
          type: 'review',
          date: review.submitted_at,
          state: review.state,
          reviewer: review.reviewer,
          submitted_at: review.submitted_at,
          time_to_review_hours: review.time_to_review_hours,
          reviewer_teams: review.reviewer_teams,
          author_reviewer_relationship: review.author_reviewer_relationship,
        });
      });

      // 5. Get issue comments
      const { data: issueComments } =
        await this.octokit.rest.issues.listComments({
          owner,
          repo,
          issue_number: prNumber,
        });

      issueComments.forEach(comment => {
        timeline.push({
          type: 'comment_added',
          date: comment.created_at,
          comment_author: comment.user?.login,
        });
      });

      // 6. Get review comments
      const { data: reviewComments } =
        await this.octokit.rest.pulls.listReviewComments({
          owner,
          repo,
          pull_number: prNumber,
        });

      reviewComments.forEach(comment => {
        timeline.push({
          type: 'review_comment_added',
          date: comment.created_at,
          comment_author: comment.user?.login,
        });
      });

      // 7. Get timeline events from GitHub API (draft/ready conversions, etc.)
      try {
        const { data: timelineEvents } =
          await this.octokit.rest.issues.listEventsForTimeline({
            owner,
            repo,
            issue_number: prNumber,
            per_page: 100,
          });

        timelineEvents.forEach((event: any) => {
          if (event.event === 'ready_for_review') {
            timeline.push({
              type: 'ready_for_review',
              date: event.created_at,
            });
          } else if (event.event === 'convert_to_draft') {
            timeline.push({
              type: 'converted_to_draft',
              date: event.created_at,
            });
          }
        });
      } catch (error) {
        console.warn(
          `Could not fetch timeline events for PR #${prNumber}:`,
          error
        );
      }

      // 8. Add closed/merged events
      if (prData.closedAt) {
        timeline.push({
          type: 'closed',
          date: prData.closedAt,
        });
      }

      if (prData.mergedAt) {
        timeline.push({
          type: 'merged',
          date: prData.mergedAt,
        });
      }

      // Sort timeline by date
      timeline.sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
      );

      return timeline;
    } catch (error) {
      console.error(`Error building timeline for PR #${prNumber}:`, error);
      return timeline; // Return whatever we managed to collect
    }
  }

  async getReviewTimings(
    owner: string,
    repo: string,
    prNumber: number,
    prCreatedAt: string,
    authorTeams: string[],
    prCommits: any[],
    prComments: any[],
    prAuthor: string
  ): Promise<ReviewTiming[]> {
    try {
      // Get team hierarchy for relationship analysis
      const teams = await this.getTeamsForOrg(owner);

      const { data: reviews } = await this.octokit.rest.pulls.listReviews({
        owner,
        repo,
        pull_number: prNumber,
      });

      const reviewTimings: ReviewTiming[] = [];
      const prCreatedDate = new Date(prCreatedAt);

      for (const review of reviews) {
        if (!review.submitted_at || !review.user?.login) continue;

        const submittedDate = new Date(review.submitted_at);
        const timeToReviewHours =
          (submittedDate.getTime() - prCreatedDate.getTime()) /
          (1000 * 60 * 60);

        // Get reviewer teams
        const reviewerTeams = await this.getUserTeams(review.user.login, owner);

        // Analyze team relationship
        const teamRelationship = analyzeTeamRelationship(
          authorTeams,
          reviewerTeams,
          teams
        );

        // Find next commit by author after this review
        let timeToNewCommitsPushed: number | undefined = undefined;
        if (prCommits && prCommits.length > 0 && prAuthor) {
          const reviewTime = new Date(review.submitted_at).getTime();
          const nextCommit = prCommits.find(
            c =>
              c.author?.login === prAuthor &&
              new Date(c.commit.author.date).getTime() > reviewTime
          );
          if (nextCommit) {
            timeToNewCommitsPushed =
              (new Date(nextCommit.commit.author.date).getTime() - reviewTime) /
              (1000 * 60 * 60);
            timeToNewCommitsPushed =
              Math.round(timeToNewCommitsPushed * 100) / 100;
          }
        }

        // Find next issue comment by author after this review
        let timeToAuthorResponse: number | undefined = undefined;
        if (prComments && prComments.length > 0 && prAuthor) {
          const reviewTime = new Date(review.submitted_at).getTime();
          const nextComment = prComments.find(
            c =>
              c.user?.login === prAuthor &&
              new Date(c.created_at).getTime() > reviewTime
          );
          if (nextComment) {
            timeToAuthorResponse =
              (new Date(nextComment.created_at).getTime() - reviewTime) /
              (1000 * 60 * 60);
            timeToAuthorResponse = Math.round(timeToAuthorResponse * 100) / 100;
          }
        }

        reviewTimings.push({
          state: review.state,
          reviewer: review.user.login,
          submitted_at: review.submitted_at,
          time_to_review_hours: Math.round(timeToReviewHours * 100) / 100, // Round to 2 decimal places
          author_teams: authorTeams,
          reviewer_teams: reviewerTeams,
          author_reviewer_relationship: teamRelationship,
          time_to_new_commits_pushed: timeToNewCommitsPushed,
          time_to_author_response: timeToAuthorResponse,
        });

        // Add a small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      return reviewTimings;
    } catch (error) {
      console.error('Error fetching review timings:', error);
      return [];
    }
  }

  async indexSinglePR(
    prStat: PullRequestStats,
    indexName: string
  ): Promise<void> {
    try {
      await this.elasticsearch.index({
        index: indexName,
        body: prStat,
      });
      console.log(
        `✓ Indexed PR #${prStat.id}: ${prStat.title} (${prStat.author})`
      );
    } catch (error) {
      console.error(`✗ Failed to index PR #${prStat.id}:`, error);
      throw error;
    }
  }

  async ensureIndexExists(indexName: string): Promise<void> {
    try {
      const indexExists = await this.elasticsearch.indices.exists({
        index: indexName,
      });

      if (indexExists) {
        await this.elasticsearch.indices.delete({ index: indexName });
        console.log(`✓ Deleted existing index: ${indexName}`);
        await this.createIndex(indexName);
      }

      if (!indexExists) {
        await this.createIndex(indexName);
      }
    } catch (error) {
      console.error('Error ensuring index exists:', error);
      throw error;
    }
  }

  async createIndex(indexName: string): Promise<void> {
    try {
      await this.elasticsearch.indices.create({
        index: indexName,
        body: {
          settings: {
            index: {
              mapping: {
                total_fields: {
                  limit: 5000,
                },
              },
            },
          },
          mappings: {
            properties: {
              id: { type: 'long' },
              number: { type: 'long' },
              title: { type: 'text' },
              state: { type: 'keyword' },
              created_at: { type: 'date' },
              updated_at: { type: 'date' },
              closed_at: { type: 'date' },
              merged_at: { type: 'date' },
              user: {
                properties: {
                  login: { type: 'keyword' },
                  id: { type: 'long' },
                  teams: { type: 'keyword' },
                },
              },
              codeowners: {
                type: 'nested',
                properties: {
                  username: { type: 'keyword' },
                  teams: { type: 'keyword' },
                },
              },
              review_timings: {
                type: 'nested',
                properties: {
                  reviewer: { type: 'keyword' },
                  reviewer_teams: { type: 'keyword' },
                  submitted_at: { type: 'date' },
                  time_to_review_hours: { type: 'double' },
                  state: { type: 'keyword' },
                  author_reviewer_relationship: { type: 'keyword' },
                },
              },
              // NEW: Timeline mapping
              timeline: {
                type: 'nested',
                properties: {
                  type: { type: 'keyword' },
                  date: { type: 'date' },
                  state: { type: 'keyword' },
                  reviewer: { type: 'keyword' },
                  submitted_at: { type: 'date' },
                  time_to_review_hours: { type: 'double' },
                  reviewer_teams: { type: 'keyword' },
                  author_reviewer_relationship: { type: 'keyword' },
                  commit_count: { type: 'integer' },
                  comment_author: { type: 'keyword' },
                  ci_status: { type: 'keyword' },
                  ci_conclusion: { type: 'keyword' },
                  workflow_name: { type: 'keyword' },
                },
              },
              additions: { type: 'long' },
              deletions: { type: 'long' },
              changed_files: { type: 'long' },
              commits: { type: 'long' },
              review_comments: { type: 'long' },
              comments: { type: 'long' },
            },
          },
        },
      });
      console.log(`✓ Created index: ${indexName}`);
    } catch {}
  }

  async listMergedPRsGraphQL(owner: string, repo: string) {
    const pageSize = 100;
    const q = `repo:${owner}/${repo} is:pr is:merged -author:kibanamachine -author:elastic-renovate-prod[bot]`;

    const query = `
    query($q: String!, $pageSize: Int!, $cursor: String) {
      search(query: $q, type: ISSUE, first: $pageSize, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          ... on PullRequest {

            number
            title
            url
            state
            createdAt
            updatedAt
            closedAt
            mergedAt
            author { login }
            headRefName
            baseRefName            
          }
        }
      }
    }
  `;

    let cursor: string | null = null;
    const all: PR[] = [];
    let totalFetched = 0;
    const maxPRs = 1000;

    do {
      const res: {
        search: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          nodes: PR[];
        };
      } = await this.octokit.graphql<{
        search: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          nodes: PR[];
        };
      }>(query, { q, pageSize, cursor });

      const {
        nodes,
        pageInfo,
      }: {
        nodes: PR[];
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      } = res.search;

      // filter out PRs with "backport" in the head branch name
      const filtered = nodes.filter(
        (pr: PR) => !/backport/i.test(pr.headRefName ?? '')
      );

      all.push(...filtered);
      totalFetched += filtered.length;

      cursor =
        pageInfo.hasNextPage && totalFetched < maxPRs
          ? pageInfo.endCursor
          : null;
    } while (cursor && totalFetched < maxPRs);

    return all.slice(0, maxPRs);
  }

  async collectAndIndexPRStats(
    owner: string,
    repo: string,
    indexName: string
  ): Promise<number> {
    try {
      console.log(`Collecting and indexing PR stats for ${owner}/${repo}...`);

      // Ensure the index exists first
      await this.ensureIndexExists(indexName);

      const mergedPRs = await this.listMergedPRsGraphQL(owner, repo);

      console.log(
        `Found ${mergedPRs.length} merged PRs (excluding kibanamachine) and backports`
      );

      let processedCount = 0;

      for (const pr of mergedPRs) {
        console.log(`Processing PR #${pr.id}: ${pr.title}`);

        // Get detailed PR information
        const { data: detailedPR } = await this.octokit.rest.pulls.get({
          owner,
          repo,
          pull_number: pr.id,
        });

        // Get review comments count
        const { data: reviewComments } =
          await this.octokit.rest.pulls.listReviewComments({
            owner,
            repo,
            pull_number: pr.id,
          });

        // Get issue comments count
        const { data: issueComments } =
          await this.octokit.rest.issues.listComments({
            owner,
            repo,
            issue_number: pr.id,
          });

        // Get user teams for the PR author
        const userTeams = await this.getUserTeams(
          pr.author?.login || '',
          owner
        );

        const authorTeamsPrefixed = flattenArr(userTeams, 'author_teams');

        // Get codeowners for this PR
        const codeowners = await this.parseCodeowners(owner, repo, pr.id);
        const codeOwnersPrefixed = flattenArr(codeowners, 'codeowners');

        // Get review timings
        // Get all commits for this PR
        const { data: prCommits } = await this.octokit.rest.pulls.listCommits({
          owner,
          repo,
          pull_number: pr.id,
        });
        // Get all issue comments for this PR
        // (already fetched as issueComments above)
        const reviewTimings = await this.getReviewTimings(
          owner,
          repo,
          pr.id,
          pr.createdAt,
          userTeams,
          prCommits,
          issueComments,
          pr.author?.login || ''
        );

        // NEW: Build timeline
        const timeline = await this.buildPRTimeline(
          owner,
          repo,
          pr.id,
          pr,
          reviewTimings
        );

        // Flatten review timings for easier indexing
        const reviewTimingsTransformed = flattenArr(
          reviewTimings,
          'review_timings'
        );

        // NEW: Flatten timeline for easier indexing

        const timelineTransformed = flattenArr(timeline, 'timeline');

        // --- Back and Forth Detection ---
        // Get all reviews sorted by submitted_at
        const sortedReviews = [...reviewTimings].sort((a, b) =>
          a.submitted_at.localeCompare(b.submitted_at)
        );
        let backAndForthCount = 0;
        let lastChangeRequestedIndex = -1;
        // Find cycles: CHANGES_REQUESTED -> (any review after new commit)
        for (let i = 0; i < sortedReviews.length; i++) {
          if (sortedReviews[i].state === 'CHANGES_REQUESTED') {
            lastChangeRequestedIndex = i;
          } else if (
            lastChangeRequestedIndex !== -1 &&
            i > lastChangeRequestedIndex
          ) {
            backAndForthCount++;
            lastChangeRequestedIndex = -1; // Only count one cycle per CR
          }
        }

        const prStat: PullRequestStats = {
          id: pr.id,
          title: pr.title,
          url: detailedPR.html_url,
          author: pr.author?.login || 'unknown',
          // author_teams: userTeams,
          ...authorTeamsPrefixed,
          state: pr.state,
          created_at: pr.createdAt,
          updated_at: pr.updatedAt,
          closed_at: pr.closedAt,
          merged_at: pr.mergedAt,
          turnaround_time_hours: pr.closedAt
            ? Math.round(
                ((new Date(pr.closedAt).getTime() -
                  new Date(pr.createdAt).getTime()) /
                  (1000 * 60 * 60)) *
                  100
              ) / 100
            : 0,
          // codeowners,
          ...codeOwnersPrefixed,
          review_timings: reviewTimings,
          ...reviewTimingsTransformed,
          timeline: timeline, // NEW: Add timeline
          ...timelineTransformed, // NEW: Add flattened timeline for easier querying
          back_and_forth_count: backAndForthCount,
          additions: detailedPR.additions || 0,
          deletions: detailedPR.deletions || 0,
          changed_files: detailedPR.changed_files || 0,
          commits: detailedPR.commits || 0,
          review_comments: reviewComments.length,
          comments: issueComments.length,
        };

        console.log('PR Stat:', prStat);

        // Index this PR immediately
        await this.indexSinglePR(prStat, indexName);

        processedCount++;

        // Add a small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      console.log(`✓ Successfully processed and indexed ${processedCount} PRs`);
      return processedCount;
    } catch (error) {
      console.error('Error collecting and indexing PR stats:', error);
      throw error;
    }
  }

  async searchPRStats(indexName: string, query: any): Promise<any> {
    try {
      const response = await this.elasticsearch.search({
        index: indexName,
        body: query,
      });
      return response;
    } catch (error) {
      console.error('Error searching Elasticsearch:', error);
      throw error;
    }
  }

  async getAggregatedStats(indexName: string): Promise<any> {
    try {
      const query = {
        size: 0,
        aggs: {
          pr_states: {
            terms: { field: 'state' },
          },
          avg_additions: {
            avg: { field: 'additions' },
          },
          avg_deletions: {
            avg: { field: 'deletions' },
          },
          avg_changed_files: {
            avg: { field: 'changed_files' },
          },
          top_contributors: {
            terms: {
              field: 'user.login',
              size: 10,
            },
          },
          contributor_teams: {
            terms: {
              field: 'user.teams',
              size: 20,
            },
          },
          codeowner_teams: {
            nested: {
              path: 'codeowners',
            },
            aggs: {
              teams: {
                terms: {
                  field: 'codeowners.teams',
                  size: 20,
                },
              },
            },
          },
          review_timing_stats: {
            nested: {
              path: 'review_timings',
            },
            aggs: {
              avg_review_time: {
                avg: {
                  field: 'review_timings.time_to_review_hours',
                },
              },
              review_time_percentiles: {
                percentiles: {
                  field: 'review_timings.time_to_review_hours',
                  percents: [50, 75, 90, 95],
                },
              },
              reviewer_teams: {
                terms: {
                  field: 'review_timings.reviewer_teams',
                  size: 20,
                },
              },
              review_states: {
                terms: {
                  field: 'review_timings.state',
                },
              },
              author_reviewer_relationships: {
                terms: {
                  field: 'review_timings.author_reviewer_relationship',
                },
              },
            },
          },
          // NEW: Timeline aggregations
          timeline_stats: {
            nested: {
              path: 'timeline',
            },
            aggs: {
              event_types: {
                terms: {
                  field: 'timeline.type',
                  size: 20,
                },
              },
              ci_conclusions: {
                terms: {
                  field: 'timeline.ci_conclusion',
                  size: 10,
                },
              },
              workflow_names: {
                terms: {
                  field: 'timeline.workflow_name',
                  size: 20,
                },
              },
            },
          },
          prs_over_time: {
            date_histogram: {
              field: 'created_at',
              calendar_interval: 'month',
            },
          },
        },
      };

      const response = await this.searchPRStats(indexName, query);
      return response.aggregations;
    } catch (error) {
      console.error('Error getting aggregated stats:', error);
      throw error;
    }
  }
}

async function main() {
  // Configuration - loaded from .env file
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
  const ELASTICSEARCH_URL =
    process.env.ELASTICSEARCH_URL || 'http://localhost:9200';
  const ELASTICSEARCH_API_KEY = process.env.ELASTICSEARCH_API_KEY;
  const OWNER = process.env.GITHUB_OWNER || 'elastic';
  const REPO = process.env.GITHUB_REPO || 'elasticsearch';
  const INDEX_NAME = `github-pr-stats-${OWNER}-${REPO}`.toLowerCase();

  if (!GITHUB_TOKEN) {
    console.error('Please set GITHUB_TOKEN environment variable');
    process.exit(1);
  }

  try {
    const collector = new GitHubPRStatsCollector(
      GITHUB_TOKEN,
      ELASTICSEARCH_URL,
      ELASTICSEARCH_API_KEY
    );

    // Collect and index merged PR stats from GitHub in real-time
    const processedCount = await collector.collectAndIndexPRStats(
      OWNER,
      REPO,
      INDEX_NAME
    );
    console.log(
      `\n✓ Successfully processed and indexed ${processedCount} merged pull requests`
    );

    // Generate organizational dependency graphs and markdown files
    console.log('\n=== Generating Organizational Dependency Graphs ===');

    try {
      // 1) Fetch teams (with parents)
      const teams = await fetchTeamsWithParents(OWNER);
      console.log(`✓ Fetched ${teams.length} teams from ${OWNER} organization`);

      // 2) Fetch CODEOWNERS
      const codeownersRaw = await fetchCodeowners(OWNER, REPO);
      const codeownersRules = codeownersRaw
        ? parseCodeowners(codeownersRaw, OWNER)
        : [];
      console.log(
        `✓ Parsed ${codeownersRules.length} CODEOWNERS rules from ${REPO} repository`
      );

      // // 3) Generate Mermaid diagrams
      // const mermaidHierarchy = teamsHierarchyToMermaid(teams);
      // const mermaidCodeowners = codeownersToTeamsMermaid(
      //   codeownersRules,
      //   teams
      // );

      // // 4) Write to markdown files
      // writeMarkdownFile(
      //   'team-hierarchy.md',
      //   'Team Hierarchy',
      //   mermaidHierarchy,
      //   `This diagram shows the hierarchical structure of teams in the **${OWNER}** organization. Parent teams are connected to their child teams with arrows.`
      // );

      // writeMarkdownFile(
      //   'codeowners-teams.md',
      //   'CODEOWNERS → Teams Mapping',
      //   mermaidCodeowners,
      //   `This diagram shows how file patterns in the CODEOWNERS file map to teams in the **${OWNER}** organization for the **${REPO}** repository. Each pattern is represented as a rounded rectangle, with arrows pointing to the teams responsible for those files.`
      // );

      // console.log(
      //   '✓ Generated team-hierarchy.md and codeowners-teams.md files'
      // );
    } catch (graphError) {
      console.warn(
        '⚠️  Could not generate organizational graphs:',
        graphError instanceof Error ? graphError.message : String(graphError)
      );
    }

    // Get some aggregated statistics
    const aggregatedStats = await collector.getAggregatedStats(INDEX_NAME);
    console.log('\n=== Aggregated Statistics ===');
    console.log('PR States:', aggregatedStats.pr_states.buckets);
    console.log(
      'Average Additions:',
      Math.round(aggregatedStats.avg_additions.value)
    );
    console.log(
      'Average Deletions:',
      Math.round(aggregatedStats.avg_deletions.value)
    );
    console.log(
      'Average Changed Files:',
      Math.round(aggregatedStats.avg_changed_files.value)
    );
    console.log(
      'Top Contributors:',
      aggregatedStats.top_contributors.buckets.slice(0, 5)
    );
    console.log(
      'Contributor Teams:',
      aggregatedStats.contributor_teams.buckets
    );
    console.log(
      'Codeowner Teams:',
      aggregatedStats.codeowner_teams.teams.buckets
    );

    if (aggregatedStats.review_timing_stats.avg_review_time.value) {
      console.log('\n=== Review Timing Statistics ===');
      console.log(
        'Average Review Time (hours):',
        Math.round(
          aggregatedStats.review_timing_stats.avg_review_time.value * 100
        ) / 100
      );
      console.log(
        'Review Time Percentiles (hours):',
        aggregatedStats.review_timing_stats.review_time_percentiles.values
      );
      console.log(
        'Reviewer Teams:',
        aggregatedStats.review_timing_stats.reviewer_teams.buckets
      );
      console.log(
        'Review States:',
        aggregatedStats.review_timing_stats.review_states.buckets
      );
      console.log(
        'Team Relationships:',
        aggregatedStats.review_timing_stats.author_reviewer_relationship.buckets
      );
    }

    // NEW: Timeline statistics
    if (aggregatedStats.timeline_stats) {
      console.log('\n=== Timeline Statistics ===');
      console.log(
        'Event Types:',
        aggregatedStats.timeline_stats.event_types.buckets
      );
      console.log(
        'CI Conclusions:',
        aggregatedStats.timeline_stats.ci_conclusions.buckets
      );
      console.log(
        'Workflow Names:',
        aggregatedStats.timeline_stats.workflow_names.buckets
      );
    }
  } catch (error) {
    console.error('Error in main execution:', error);
    process.exit(1);
  }
}

// Run the script if this file is executed directly
if (require.main === module) {
  main();
}

function flattenArr(arr: Array<unknown>, prefix: string) {
  const flattened: Record<string, unknown> = flatten(arr);

  return Object.keys(flattened).reduce(
    (acc, key) => {
      const newKey = `${prefix}.${key}`;
      acc[newKey] = flattened[key];
      return acc;
    },
    {} as Record<string, unknown>
  );
}

export { GitHubPRStatsCollector, PullRequestStats, TimelineEvent };
