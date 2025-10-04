'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState, useCallback, useMemo } from 'react';
import { TimelineData, ApiResponse, PullRequestStats } from '@/lib/types';
import { transformToTimelineData } from '@/lib/timeline-transformer';
import { Chart } from '@/components/Chart';
import {
  EuiPageTemplate,
  EuiText,
  EuiPanel,
  EuiFlexGroup,
  EuiFlexItem,
  EuiButton,
  EuiLoadingSpinner,
  EuiEmptyPrompt,
  EuiButtonIcon,
  EuiIcon,
  EuiBadge,
  EuiSelect,
  EuiFormRow,
} from '@elastic/eui';
import PRStats from '@/components/PRStats';

interface PrPageParams {
  owner: string;
  repo: string;
  prNumber: string;
}

export default function ClientOnlyPrPage() {
  const params = useParams() as unknown as PrPageParams;
  const router = useRouter();
  const [data, setData] = useState<TimelineData | null>(null);
  const [prStats, setPrStats] = useState<PullRequestStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedWorkflow, setSelectedWorkflow] = useState<string>(
    'kibana / pull request'
  );

  const fetchPrData = useCallback(
    async (forceRefresh = false) => {
      if (!params.owner || !params.repo || !params.prNumber) {
        setError('Invalid URL parameters');
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const url = `/api/pr/${params.owner}/${params.repo}/${params.prNumber}${
          forceRefresh ? '?force=true' : ''
        }`;

        const response = await fetch(url);

        if (!response.ok) {
          throw new Error(`Failed to fetch PR data: ${response.statusText}`);
        }

        const result: ApiResponse<PullRequestStats> = await response.json();

        if (!result.data) {
          throw new Error('No data received from API');
        }

        // Store the raw PR stats
        setPrStats(result.data);
      } catch (err) {
        console.error('Error fetching PR data:', err);
        setError(err instanceof Error ? err.message : 'Unknown error occurred');
      } finally {
        setLoading(false);
      }
    },
    [params.owner, params.repo, params.prNumber]
  );

  // Extract unique workflow names from PR data
  const availableWorkflows = useMemo(() => {
    if (!prStats) return [];

    const workflows = new Set<string>();
    prStats.timeline.forEach(event => {
      if (
        event.workflow_name &&
        (event.type === 'ci_run' || event.type.includes('ci_'))
      ) {
        workflows.add(event.workflow_name);
      }
    });

    return Array.from(workflows).sort();
  }, [prStats]);

  // Filter and transform timeline data based on selected workflow
  const filteredData = useMemo(() => {
    if (!prStats) return null;

    // Filter timeline to only include selected workflow or non-CI events
    const filteredPrStats: PullRequestStats = {
      ...prStats,
      timeline: prStats.timeline.filter(event => {
        // Keep non-CI events
        if (!event.type.includes('ci_') && event.type !== 'ci_run') {
          return true;
        }
        // Keep CI events that match the selected workflow (or if "All Workflows" is selected)
        if (selectedWorkflow === 'all') {
          return true;
        }
        return event.workflow_name === selectedWorkflow;
      }),
    };

    return transformToTimelineData(filteredPrStats);
  }, [prStats, selectedWorkflow]);

  // Update data when filtered data changes
  useEffect(() => {
    setData(filteredData);
  }, [filteredData]);

  useEffect(() => {
    fetchPrData();
  }, [fetchPrData]);

  // Calculate author-codeowner relationship
  const authorCodeownerRelationship = useMemo(() => {
    if (!prStats) return null;

    // Check if the author is in any of the code owner teams
    const codeOwnerTeams = prStats.codeowners?.teams || [];
    const requestedTeams = prStats.requested_teams || [];
    const allCodeOwnerTeams = [
      ...new Set([...codeOwnerTeams, ...requestedTeams]),
    ];

    // Check review events to see if any reviewer from code owner teams
    // has the same relationship info
    const reviewWithRelationship = prStats.timeline.find(
      event => event.type === 'review' && event.author_reviewer_relationship
    );

    if (reviewWithRelationship?.author_reviewer_relationship) {
      return reviewWithRelationship.author_reviewer_relationship;
    }

    // Fallback: check if author is in code owner teams
    const isAuthorInCodeOwners = allCodeOwnerTeams.length > 0;
    return isAuthorInCodeOwners ? 'same-team' : 'cross-team';
  }, [prStats]);

  const handleBackToHome = () => {
    router.push('/');
  };

  const handleForceRefresh = () => {
    fetchPrData(true);
  };

  if (loading) {
    return (
      <EuiPageTemplate>
        <EuiPageTemplate.Header
          pageTitle="Loading PR..."
          description="Loading data from GitHub..."
        />
        <EuiPageTemplate.Section>
          <EuiPanel hasBorder hasShadow={false}>
            <EuiFlexGroup
              direction="column"
              alignItems="center"
              justifyContent="center"
              style={{ minHeight: '200px' }}
            >
              <EuiFlexItem grow={false}>
                <EuiLoadingSpinner size="xl" />
              </EuiFlexItem>
              <EuiFlexItem grow={false}>
                <EuiText>
                  <p>Fetching PR timeline data...</p>
                </EuiText>
              </EuiFlexItem>
            </EuiFlexGroup>
          </EuiPanel>
        </EuiPageTemplate.Section>
      </EuiPageTemplate>
    );
  }

  if (error) {
    return (
      <EuiPageTemplate>
        <EuiPageTemplate.Header
          pageTitle="Error"
          description="Failed to load PR data"
        />
        <EuiPageTemplate.Section>
          <EuiEmptyPrompt
            color="danger"
            iconType="error"
            title={<h2>Error loading PR data</h2>}
            body={<p>{error}</p>}
            actions={[
              <EuiButton
                key="back"
                color="primary"
                fill
                onClick={handleBackToHome}
                iconType="arrowLeft"
              >
                Back to Home
              </EuiButton>,
              <EuiButton
                key="retry"
                color="success"
                onClick={handleForceRefresh}
                iconType="refresh"
              >
                Try Again
              </EuiButton>,
            ]}
          />
        </EuiPageTemplate.Section>
      </EuiPageTemplate>
    );
  }

  if (!data || !data.items || !data.groups) {
    return (
      <EuiPageTemplate>
        <EuiPageTemplate.Header
          pageTitle="No Data"
          description="No timeline data available"
        />
        <EuiPageTemplate.Section>
          <EuiEmptyPrompt
            iconType="documents"
            title={<h2>No timeline data found</h2>}
            body={<p>Unable to generate timeline for this PR.</p>}
            actions={[
              <EuiButton
                key="back"
                color="primary"
                fill
                onClick={handleBackToHome}
                iconType="arrowLeft"
              >
                Back to Home
              </EuiButton>,
              <EuiButton
                key="refresh"
                color="success"
                onClick={handleForceRefresh}
                iconType="refresh"
              >
                Force Refresh
              </EuiButton>,
            ]}
          />
        </EuiPageTemplate.Section>
      </EuiPageTemplate>
    );
  }

  return (
    <EuiPageTemplate>
      <EuiPageTemplate.Header
        pageTitle={
          <>
            <a
              href={`https://github.com/${params.owner}/${params.repo}/pull/${params.prNumber}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {prStats?.title}
              <EuiIcon type="popout" size="m" style={{ marginLeft: '4px' }} />
            </a>
          </>
        }
        description={
          authorCodeownerRelationship && (
            <EuiFlexGroup gutterSize="s" alignItems="center">
              <EuiFlexItem grow={false}>
                <EuiText size="s">
                  <strong>Author:</strong> {prStats?.author}
                </EuiText>
              </EuiFlexItem>
              <EuiFlexItem grow={false}>
                <EuiBadge color="hollow">
                  {authorCodeownerRelationship === 'same-team'
                    ? 'Same Team as Code Owners'
                    : authorCodeownerRelationship === 'cross-team'
                      ? 'Cross Team'
                      : authorCodeownerRelationship}
                </EuiBadge>
              </EuiFlexItem>
            </EuiFlexGroup>
          )
        }
        rightSideItems={[
          <EuiButtonIcon
            key="refresh"
            color="success"
            onClick={handleForceRefresh}
            iconType="refresh"
            isLoading={loading}
          />,
          <EuiButtonIcon
            key="back"
            color="primary"
            onClick={handleBackToHome}
            iconType="arrowLeft"
          ></EuiButtonIcon>,
        ]}
      />
      <EuiPageTemplate.Header>
        {prStats && (
          <PRStats pr={prStats} selectedWorkflow={selectedWorkflow} />
        )}
      </EuiPageTemplate.Header>

      <EuiPageTemplate.Section>
        <EuiFlexGroup direction="row" gutterSize="s" alignItems="center">
          {prStats?.linked_issues?.map(issue => (
            <EuiFlexItem key={issue.number} grow={false}>
              <a
                href={issue.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ textDecoration: 'none' }}
              >
                <EuiPanel
                  hasBorder
                  paddingSize="s"
                  style={{ cursor: 'pointer' }}
                >
                  <EuiFlexGroup direction="column" gutterSize="xs">
                    <EuiFlexItem>
                      <EuiFlexGroup gutterSize="s" alignItems="center">
                        <EuiFlexItem grow={false}>
                          <EuiText size="s">
                            <strong>#{issue.number}</strong>
                          </EuiText>
                        </EuiFlexItem>
                        <EuiFlexItem grow={false}>
                          <EuiBadge
                            color={
                              issue.state === 'open' ? 'success' : 'default'
                            }
                          >
                            {issue.state.toUpperCase()}
                          </EuiBadge>
                        </EuiFlexItem>
                        {issue.assignees && issue.assignees.length > 0 && (
                          <EuiFlexItem grow={false}>
                            <EuiBadge color="hollow">
                              Assignee: {issue.assignees[0]}
                            </EuiBadge>
                          </EuiFlexItem>
                        )}
                      </EuiFlexGroup>
                    </EuiFlexItem>
                    <EuiFlexItem>
                      <EuiText size="s">{issue.title}</EuiText>
                    </EuiFlexItem>
                    {issue.labels.length > 0 && (
                      <EuiFlexItem>
                        <EuiFlexGroup gutterSize="xs" wrap>
                          {issue.labels.map(label => (
                            <EuiFlexItem key={label} grow={false}>
                              <EuiBadge color="hollow">{label}</EuiBadge>
                            </EuiFlexItem>
                          ))}
                        </EuiFlexGroup>
                      </EuiFlexItem>
                    )}
                  </EuiFlexGroup>
                </EuiPanel>
              </a>
            </EuiFlexItem>
          ))}
          <EuiFlexItem grow={false}>
            <EuiFormRow label="Filter CI/CD Workflows" display="rowCompressed">
              <EuiSelect
                options={[
                  { value: 'all', text: 'All Workflows' },
                  ...availableWorkflows.map(workflow => ({
                    value: workflow,
                    text: workflow,
                  })),
                ]}
                value={selectedWorkflow}
                onChange={e => setSelectedWorkflow(e.target.value)}
                compressed
              />
            </EuiFormRow>
          </EuiFlexItem>
        </EuiFlexGroup>
      </EuiPageTemplate.Section>

      <EuiPageTemplate.Section
        style={{ height: '100%', paddingInline: '0px' }}
        restrictWidth="100%"
      >
        <Chart data={data} />
      </EuiPageTemplate.Section>
    </EuiPageTemplate>
  );
}
