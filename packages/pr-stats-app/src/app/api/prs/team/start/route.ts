import { NextRequest, NextResponse } from 'next/server';
import { Octokit } from '@octokit/rest';
import { graphql } from '@octokit/graphql';
import { logger } from '@/lib/logger';
import { processPR, hasCachedData } from '@/lib/services';
import {
  createJob,
  updateJobStatus,
  type JobStatus,
} from '@/lib/services/job-manager';
import { v4 as uuidv4 } from 'uuid';

// Same PR fetching logic from the original route
type PullRequest = {
  number: number;
  title: string;
  createdAt: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  url: string;
  author?: { login: string | null } | null;
  repository: { owner: { login: string }; name: string };
};

const SEARCH_GQL = /* GraphQL */ `
  query ($searchQuery: String!, $cursor: String) {
    search(query: $searchQuery, type: ISSUE, first: 100, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        ... on PullRequest {
          number
          title
          createdAt
          state
          url
          author {
            login
          }
          repository {
            owner {
              login
            }
            name
          }
        }
      }
    }
  }
`;

function buildSearchQuery(params: {
  repo: string;
  authors: string[];
  fromDate: string;
  toDate: string;
}) {
  const { repo, authors, fromDate, toDate } = params;
  const authorsQuery = authors.map(a => `author:${a}`).join(' ');

  return [
    'is:pr',
    `repo:${repo}`,
    authors.length ? authorsQuery : '',
    `created:${fromDate}..${toDate}`,
    'sort:created-asc',
  ]
    .filter(Boolean)
    .join(' ');
}

async function fetchAllPRs({
  graphqlWithAuth,
  repo,
  authors,
  fromDate,
  toDate,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  graphqlWithAuth: <T = any>(
    query: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vars: Record<string, any>
  ) => Promise<T>;
  repo: string;
  authors: string[];
  fromDate: string;
  toDate: string;
}): Promise<PullRequest[]> {
  const searchQuery = buildSearchQuery({ repo, authors, fromDate, toDate });
  const seen = new Set<string>();
  const results: PullRequest[] = [];

  let cursor: string | null = null;
  for (;;) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp: any = await graphqlWithAuth(SEARCH_GQL, {
      searchQuery,
      cursor,
    });

    const { search } = resp?.data ?? resp ?? {};
    const nodes: PullRequest[] = search?.nodes ?? [];

    for (const pr of nodes) {
      if (pr?.url && !seen.has(pr.url)) {
        seen.add(pr.url);
        results.push(pr);
      }
    }

    const pageInfo = search?.pageInfo;
    if (!pageInfo?.hasNextPage) break;
    cursor = pageInfo.endCursor;

    if (results.length >= 1000) break;
  }

  return results;
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { team, repos, startDate, endDate } = body;

  const githubToken = process.env.GITHUB_TOKEN;
  const githubOwner = process.env.GITHUB_OWNER;

  if (!githubToken || !githubOwner) {
    return NextResponse.json(
      { error: 'Server configuration error' },
      { status: 500 }
    );
  }

  if (!team || !repos) {
    return NextResponse.json(
      { error: 'Missing required parameters' },
      { status: 400 }
    );
  }

  try {
    const octokit = new Octokit({ auth: githubToken });
    const graphqlWithAuth = graphql.defaults({
      headers: {
        authorization: `token ${githubToken}`,
      },
    });

    // Get team members
    logger.info(`Fetching members for team: ${team}`);
    const teamMembers = await octokit.paginate(
      octokit.rest.teams.listMembersInOrg,
      {
        org: githubOwner,
        team_slug: team,
        per_page: 100,
      }
    );

    const authors = teamMembers.map(member => member.login);

    // Fetch PRs
    const prs = await fetchAllPRs({
      graphqlWithAuth,
      repo: `${githubOwner}/${repos}`,
      authors,
      fromDate: startDate || '',
      toDate: endDate || '',
    });

    const allPRs = prs.map(pr => ({
      owner: pr.repository.owner.login,
      repo: pr.repository.name,
      number: pr.number,
      title: pr.title,
      created_at: pr.createdAt,
      author: pr.author?.login || 'unknown',
      state: pr.state.toLowerCase(),
      url: pr.url,
    }));

    // Create job
    const jobId = uuidv4();
    const jobStatus: JobStatus = {
      jobId,
      status: 'running',
      team,
      repo: `${githubOwner}/${repos}`,
      totalPRs: allPRs.length,
      processedPRs: 0,
      completedPRs: 0,
      errorPRs: 0,
      prs: allPRs.map(pr => ({
        number: pr.number,
        owner: pr.owner,
        repo: pr.repo,
        title: pr.title,
        author: pr.author,
        url: pr.url,
        status: 'pending' as const,
      })),
      startedAt: new Date().toISOString(),
    };

    createJob(jobId, jobStatus);

    // Start processing in background (don't await)
    processJobInBackground(jobId, allPRs);

    // Return immediately
    return NextResponse.json({
      jobId,
      totalPRs: allPRs.length,
      statusUrl: `/api/prs/team/status/${jobId}`,
    });
  } catch (error) {
    logger.error('Error starting job', {
      error: error instanceof Error ? error.message : error,
    });

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to start job' },
      { status: 500 }
    );
  }
}

// Process job in background
async function processJobInBackground(
  jobId: string,
  prs: Array<{
    owner: string;
    repo: string;
    number: number;
    title: string;
    author: string;
    url: string;
  }>
) {
  try {
    const { getJobStatus } = await import('@/lib/services/job-manager');

    for (let i = 0; i < prs.length; i++) {
      const pr = prs[i];

      try {
        // Check if cached
        const isCached = hasCachedData(pr.owner, pr.repo, pr.number);

        // Get current job status to update individual PR
        const currentStatus = getJobStatus(jobId);
        if (!currentStatus) continue;

        if (isCached) {
          // Update PR status to completed
          const updatedPRs = [...currentStatus.prs];
          updatedPRs[i] = { ...updatedPRs[i], status: 'completed' as const };

          updateJobStatus(jobId, {
            processedPRs: i + 1,
            completedPRs: currentStatus.completedPRs + 1,
            prs: updatedPRs,
          });
        } else {
          // Update PR status to processing
          const processingPRs = [...currentStatus.prs];
          processingPRs[i] = {
            ...processingPRs[i],
            status: 'processing' as const,
          };

          updateJobStatus(jobId, {
            prs: processingPRs,
          });

          // Process PR
          await processPR(pr.owner, pr.repo, pr.number, false);

          // Update PR status to completed
          const completedPRs = [
            ...(getJobStatus(jobId)?.prs || currentStatus.prs),
          ];
          completedPRs[i] = {
            ...completedPRs[i],
            status: 'completed' as const,
          };

          updateJobStatus(jobId, {
            processedPRs: i + 1,
            completedPRs: currentStatus.completedPRs + 1,
            prs: completedPRs,
          });
        }
      } catch (error) {
        const currentStatus = getJobStatus(jobId);
        if (!currentStatus) continue;

        // Update PR status to error
        const errorPRs = [...currentStatus.prs];
        errorPRs[i] = {
          ...errorPRs[i],
          status: 'error' as const,
          error: error instanceof Error ? error.message : 'Unknown error',
        };

        updateJobStatus(jobId, {
          processedPRs: i + 1,
          errorPRs: currentStatus.errorPRs + 1,
          prs: errorPRs,
        });
      }
    }

    // Mark as completed
    updateJobStatus(jobId, {
      status: 'completed',
      completedAt: new Date().toISOString(),
    });
  } catch (error) {
    updateJobStatus(jobId, {
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
      completedAt: new Date().toISOString(),
    });
  }
}
