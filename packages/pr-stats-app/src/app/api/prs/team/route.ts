import { NextRequest } from 'next/server';
import { Octokit } from '@octokit/rest';
import { graphql } from '@octokit/graphql';
import { logger } from '@/lib/logger';
import { processPR, hasCachedData } from '@/lib/services';

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

/**
 * Builds a deterministic GitHub search query:
 * - PRs only
 * - Single repo
 * - OR-grouped authors
 * - Inclusive date range
 * - Sorted by created ascending (stable pagination)
 */
function buildSearchQuery(params: {
  repo: string; // "owner/name" e.g. "elastic/kibana"
  authors: string[]; // GitHub usernames
  fromDate: string; // "YYYY-MM-DD"
  toDate: string; // "YYYY-MM-DD"
}) {
  const { repo, authors, fromDate, toDate } = params;

  const authorsOr = `${authors.map(a => `author:${a}`).join(' ')})`;

  return [
    'is:pr',
    `repo:${repo}`,
    authors.length ? authorsOr : '',
    `${`created:${fromDate}..${toDate}`}`,
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

  logger.info('GitHub Search Query:', { searchQuery });

  const seen = new Set<string>(); // URLs for dedupe
  const results: PullRequest[] = [];

  let cursor: string | null = null;
  let pageCount = 0;
  for (;;) {
    pageCount++;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp: any = await graphqlWithAuth(SEARCH_GQL, {
      searchQuery,
      cursor,
    });

    const { search } = resp?.data ?? resp ?? {};

    const nodes: PullRequest[] = search?.nodes ?? [];

    logger.info(`Page ${pageCount} results:`, {
      nodesCount: nodes.length,
      hasNextPage: search?.pageInfo?.hasNextPage,
      totalResultsSoFar: results.length,
    });

    for (const pr of nodes) {
      if (pr?.url && !seen.has(pr.url)) {
        seen.add(pr.url);
        results.push(pr);
      }
    }

    const pageInfo = search?.pageInfo;
    if (!pageInfo?.hasNextPage) break;
    cursor = pageInfo.endCursor;

    // Optional: tiny jitter to be polite / avoid secondary rate limits
    // await new Promise(r => setTimeout(r, 150));
    // Optional: hard stop at 1000 to avoid infinite loops if something goes weird
    if (results.length >= 1000) break;
  }

  return results;
}

function sendSSEError(error: string, status = 500): Response {
  const encoder = new TextEncoder();
  const errorStream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ type: 'stream_error', error })}\n\n`
        )
      );
      controller.close();
    },
  });

  return new Response(errorStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
    status,
  });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const teamSlug = searchParams.get('team');
  const startDate = searchParams.get('start');
  const endDate = searchParams.get('end');
  const repos = searchParams.get('repos'); // Optional: single repo like "kibana"

  const githubToken = process.env.GITHUB_TOKEN;
  const githubOwner = process.env.GITHUB_OWNER;

  if (!githubToken) {
    return sendSSEError('GitHub token is not configured', 500);
  }

  if (!githubOwner) {
    return sendSSEError('GitHub owner is not configured', 500);
  }

  if (!teamSlug) {
    return sendSSEError('Team slug is required', 400);
  }

  if (!repos) {
    return sendSSEError('Repository is required (e.g., "kibana")', 400);
  }

  try {
    const octokit = new Octokit({ auth: githubToken });
    const graphqlWithAuth = graphql.defaults({
      headers: {
        authorization: `token ${githubToken}`,
      },
    });

    // Get team members
    logger.info(`Fetching members for team: ${teamSlug}`);
    const teamMembers = await octokit.paginate(
      octokit.rest.teams.listMembersInOrg,
      {
        org: githubOwner,
        team_slug: teamSlug,
        per_page: 100,
      }
    );

    // Build search query for PRs
    const authors = teamMembers.map(member => member.login);

    logger.info(`Found ${teamMembers.length} members in team ${teamSlug}`, {
      sample:
        authors.slice(0, 5).join(', ') + (authors.length > 5 ? '...' : ''),
    });

    // Test: Try a simple query for ANY PR in the repo during this period
    const testQuery = `is:pr repo:${githubOwner}/${repos} created:${startDate}..${endDate}`;
    logger.info('Testing with simplified query (no authors):', { testQuery });

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const testResp: any = await graphqlWithAuth(SEARCH_GQL, {
        searchQuery: testQuery,
        cursor: null,
      });
      const testSearch = testResp?.data ?? testResp ?? {};
      logger.info('Test query results:', {
        totalCount: testSearch?.search?.nodes?.length || 0,
        hasPRs: (testSearch?.search?.nodes?.length || 0) > 0,
        samplePR: testSearch?.search?.nodes?.[0]?.title || 'none',
      });
    } catch (err) {
      logger.error('Test query failed:', err);
    }

    const prs = await fetchAllPRs({
      graphqlWithAuth,
      repo: `${githubOwner}/${repos}`,
      authors,
      fromDate: startDate || '',
      toDate: endDate || '',
    });

    // Transform to simple format
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

    const hitGitHubLimit = allPRs.length >= 1000;

    logger.info(`Found ${allPRs.length} PRs for team ${teamSlug}`, {
      dateRange: `${startDate} to ${endDate}`,
      repo: `${githubOwner}/${repos}`,
      members: authors.length,
      hitGitHubLimit,
    });

    // Use Server-Sent Events to stream progress
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        // Keep-alive helper to prevent Netlify timeout
        let keepAliveInterval: NodeJS.Timeout | null = null;

        const startKeepAlive = () => {
          // Send keep-alive comment every 5 seconds
          keepAliveInterval = setInterval(() => {
            try {
              controller.enqueue(encoder.encode(': keep-alive\n\n'));
            } catch {
              // Connection might be closed
              if (keepAliveInterval) {
                clearInterval(keepAliveInterval);
              }
            }
          }, 5000);
        };

        const stopKeepAlive = () => {
          if (keepAliveInterval) {
            clearInterval(keepAliveInterval);
            keepAliveInterval = null;
          }
        };

        try {
          // Start keep-alive
          startKeepAlive();

          // Send initial list of PRs
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: 'init',
                team: teamSlug,
                repo: `${githubOwner}/${repos}`,
                dateRange: { start: startDate, end: endDate },
                members: authors.length,
                totalPRs: allPRs.length,
                hitGitHubLimit,
                warning: hitGitHubLimit
                  ? 'GitHub Search API has a 1000 result limit. There may be more PRs not shown.'
                  : undefined,
                prs: allPRs.map(pr => ({
                  owner: pr.owner,
                  repo: pr.repo,
                  number: pr.number,
                  title: pr.title,
                  author: pr.author,
                  url: pr.url,
                  status: 'pending',
                })),
              })}\n\n`
            )
          );

          // Process each PR
          for (const pr of allPRs) {
            try {
              // Check if cache exists (ignoring TTL)
              const isCached = hasCachedData(pr.owner, pr.repo, pr.number);

              if (isCached) {
                // Already cached - skip processing and mark as completed immediately
                logger.info(
                  `PR #${pr.number} already cached, skipping processing`
                );

                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: 'completed',
                      prNumber: pr.number,
                      owner: pr.owner,
                      repo: pr.repo,
                      fromCache: true,
                    })}\n\n`
                  )
                );
              } else {
                // Not cached - process it
                // Send processing status
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: 'processing',
                      prNumber: pr.number,
                      owner: pr.owner,
                      repo: pr.repo,
                    })}\n\n`
                  )
                );

                // Process the PR (will fetch and cache)
                await processPR(pr.owner, pr.repo, pr.number, false);

                // Send completed status
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: 'completed',
                      prNumber: pr.number,
                      owner: pr.owner,
                      repo: pr.repo,
                      fromCache: false,
                    })}\n\n`
                  )
                );
              }
            } catch (error) {
              logger.error(`Error processing PR #${pr.number}`, {
                error: error instanceof Error ? error.message : error,
              });

              // Send error status
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: 'error',
                    prNumber: pr.number,
                    owner: pr.owner,
                    repo: pr.repo,
                    error:
                      error instanceof Error ? error.message : 'Unknown error',
                  })}\n\n`
                )
              );
            }
          }

          // Send completion message
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: 'complete',
                totalProcessed: allPRs.length,
              })}\n\n`
            )
          );

          // Stop keep-alive and close
          stopKeepAlive();
          controller.close();
        } catch (error) {
          logger.error('Error in SSE stream', {
            error: error instanceof Error ? error.message : error,
          });

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: 'stream_error',
                error: error instanceof Error ? error.message : 'Unknown error',
              })}\n\n`
            )
          );

          // Stop keep-alive and close
          stopKeepAlive();
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    logger.error('Error fetching team PRs', {
      error: error instanceof Error ? error.message : error,
    });

    return sendSSEError(
      error instanceof Error ? error.message : 'Failed to fetch team PRs',
      500
    );
  }
}
