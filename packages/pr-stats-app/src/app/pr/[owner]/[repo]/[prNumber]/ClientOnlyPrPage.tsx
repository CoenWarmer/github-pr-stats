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
  EuiProgress,
  EuiSpacer,
  EuiButtonGroup,
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
  const [progressStep, setProgressStep] = useState<string>('');
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [zoomOption, setZoomOption] = useState<string>('full');
  const [zoomRange, setZoomRange] = useState<[Date, Date] | null>(null);

  // Map zoom options to their relevant groups
  const activeGroups = useMemo(() => {
    if (zoomOption === 'full') return null; // Show all groups

    const groupMap: Record<string, string[]> = {
      delivery: ['admin'], // Administrative (issues)
      development: ['dev'], // Development (PR lifecycle, commits)
      reviews: ['additional_reviewers'], // Review groups (dynamically generated)
    };

    // For reviews, include all code owner team groups (they start with "reviewer_")
    if (zoomOption === 'reviews' && data?.groups) {
      const reviewGroups = data.groups
        .filter(
          g => g.id.startsWith('reviewer_') || g.id === 'additional_reviewers'
        )
        .map(g => g.id);
      return reviewGroups;
    }

    return groupMap[zoomOption] || null;
  }, [zoomOption, data?.groups]);

  const fetchPrData = useCallback(
    async (forceRefresh = false) => {
      if (!params.owner || !params.repo || !params.prNumber) {
        setError('Invalid URL parameters');
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      setProgressPercent(0);
      setProgressStep('Checking cache...');

      try {
        // First try to get cached data quickly
        if (!forceRefresh) {
          const url = `/api/pr/${params.owner}/${params.repo}/${params.prNumber}`;
          const response = await fetch(url);

          if (response.ok) {
            const result: ApiResponse<PullRequestStats> = await response.json();
            if (result.cached && result.data) {
              // We have cached data, use it immediately
              setPrStats(result.data);
              setLoading(false);
              setProgressPercent(100);
              setProgressStep('Loaded from cache');
              return;
            }
          }
        }

        // No cache or force refresh - use SSE for progress updates
        setProgressStep('Starting data collection...');
        const eventSource = new EventSource(
          `/api/pr-progress/${params.owner}/${params.repo}/${params.prNumber}`
        );

        eventSource.onmessage = event => {
          try {
            const data = JSON.parse(event.data);

            if (data.error) {
              throw new Error(data.error);
            }

            if (data.complete) {
              // Progress complete, now fetch the final data
              eventSource.close();
              fetch(`/api/pr/${params.owner}/${params.repo}/${params.prNumber}`)
                .then(res => res.json())
                .then((result: ApiResponse<PullRequestStats>) => {
                  if (result.data) {
                    setPrStats(result.data);
                  }
                  setLoading(false);
                  setProgressPercent(100);
                  setProgressStep('Complete');
                })
                .catch(err => {
                  console.error('Error fetching final data:', err);
                  setError(
                    err instanceof Error ? err.message : 'Unknown error'
                  );
                  setLoading(false);
                });
            } else if (data.step) {
              setProgressStep(data.step);
              setProgressPercent(data.current);
            }
          } catch (parseError) {
            console.error('Error parsing SSE data:', parseError);
          }
        };

        eventSource.onerror = error => {
          console.error('SSE error:', error);
          eventSource.close();
          setError('Connection lost. Please refresh the page.');
          setLoading(false);
        };
      } catch (err) {
        console.error('Error fetching PR data:', err);
        setError(err instanceof Error ? err.message : 'Unknown error occurred');
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

  // Calculate zoom ranges for different views
  const zoomRanges = useMemo(() => {
    if (!prStats) return null;

    const ranges: Record<string, [Date, Date] | null> = {
      full: null, // null means show everything
      delivery: null,
      development: null,
      reviews: null,
    };

    // Feature Delivery: Issue created to Issue closed (or PR created/merged as fallback)
    if (prStats.linked_issues && prStats.linked_issues.length > 0) {
      const earliestIssue = prStats.linked_issues
        .map(issue => new Date(issue.created_at))
        .sort((a, b) => a.getTime() - b.getTime())[0];

      const latestIssueClosed = prStats.linked_issues
        .filter(issue => issue.closed_at)
        .map(issue => new Date(issue.closed_at!))
        .sort((a, b) => b.getTime() - a.getTime())[0];

      if (earliestIssue && latestIssueClosed) {
        ranges.delivery = [earliestIssue, latestIssueClosed];
      }
    }

    // Fallback to PR dates if no issues
    if (!ranges.delivery) {
      const prStart = new Date(prStats.created_at);
      const prEnd = prStats.merged_at
        ? new Date(prStats.merged_at)
        : prStats.closed_at
          ? new Date(prStats.closed_at)
          : new Date();
      ranges.delivery = [prStart, prEnd];
    }

    // Feature Development: PR opened to PR closed/merged
    const devStart = new Date(prStats.created_at);
    const devEnd = prStats.closed_at
      ? new Date(prStats.closed_at)
      : prStats.merged_at
        ? new Date(prStats.merged_at)
        : new Date();
    ranges.development = [devStart, devEnd];

    // Code Reviews: First review request to last approval
    const reviewRequestEvents = prStats.timeline.filter(
      event =>
        event.type === 'team_review_requested' ||
        event.type === 'review_requested'
    );

    // Find all approval events in the timeline
    const approvalEvents = prStats.timeline.filter(
      event =>
        event.type === 'review' && event.state?.toUpperCase() === 'APPROVED'
    );

    if (reviewRequestEvents.length > 0 || approvalEvents.length > 0) {
      // Get the first review request or approval (whichever came first)
      const allReviewEvents = [...reviewRequestEvents, ...approvalEvents];
      const firstReview = allReviewEvents
        .map(e => new Date(e.date))
        .sort((a, b) => a.getTime() - b.getTime())[0];

      // Find the last approval event
      const lastApproval =
        approvalEvents.length > 0
          ? approvalEvents
              .map(e => new Date(e.date))
              .sort((a, b) => b.getTime() - a.getTime())[0]
          : firstReview;

      // Ensure there's a minimum time range (at least 1 hour)
      const minRangeMs = 60 * 60 * 1000; // 1 hour
      const rangeMs = lastApproval.getTime() - firstReview.getTime();

      if (rangeMs < minRangeMs) {
        // Expand the range symmetrically around the midpoint
        const midpoint = (firstReview.getTime() + lastApproval.getTime()) / 2;
        const halfRange = minRangeMs / 2;
        ranges.reviews = [
          new Date(midpoint - halfRange),
          new Date(midpoint + halfRange),
        ];
      } else {
        ranges.reviews = [firstReview, lastApproval];
      }
    }

    return ranges;
  }, [prStats]);

  // Update zoom range when zoom option changes
  useEffect(() => {
    if (zoomRanges && zoomOption !== 'full') {
      const selectedRange = zoomRanges[zoomOption];
      setZoomRange(selectedRange || null);
    } else {
      setZoomRange(null);
    }
  }, [zoomOption, zoomRanges]);

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
          description={`Fetching data for PR #${params.prNumber}`}
        />
        <EuiPageTemplate.Section>
          <EuiPanel hasBorder hasShadow={false}>
            <EuiFlexGroup
              direction="column"
              alignItems="center"
              justifyContent="center"
              style={{
                minHeight: '300px',
                maxWidth: '600px',
                margin: '0 auto',
              }}
            >
              <EuiFlexItem grow={false} style={{ width: '100%' }}>
                <EuiText textAlign="center" size="s" color="subdued">
                  <p>{progressStep || 'Initializing...'}</p>
                </EuiText>
                <EuiSpacer size="m" />
                <EuiProgress
                  value={progressPercent}
                  max={100}
                  size="l"
                  color="primary"
                />
                <EuiSpacer size="s" />
                <EuiText textAlign="center" size="xs" color="subdued">
                  <p>{progressPercent}%</p>
                </EuiText>
              </EuiFlexItem>
              <EuiFlexItem grow={false}>
                <EuiLoadingSpinner size="xl" />
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
            aria-label="Refresh"
            key="refresh"
            color="success"
            onClick={handleForceRefresh}
            iconType="refresh"
            isLoading={loading}
          />,
          <EuiButtonIcon
            aria-label="Back to Home"
            key="back"
            color="primary"
            onClick={handleBackToHome}
            iconType="arrowLeft"
          />,
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
          <EuiFlexItem grow={false}>
            <EuiFormRow label="Zoom to Phase" display="rowCompressed">
              <EuiButtonGroup
                legend="Timeline zoom options"
                options={[
                  {
                    id: 'full',
                    label: 'Full Timeline',
                  },
                  {
                    id: 'delivery',
                    label: 'Feature Delivery',
                  },
                  {
                    id: 'development',
                    label: 'Development',
                  },
                  {
                    id: 'reviews',
                    label: 'Code Reviews',
                    isDisabled: !zoomRanges?.reviews,
                  },
                ]}
                idSelected={zoomOption}
                onChange={(id: string) => setZoomOption(id)}
                buttonSize="compressed"
                color="primary"
              />
            </EuiFormRow>
          </EuiFlexItem>
        </EuiFlexGroup>
      </EuiPageTemplate.Section>

      <EuiPageTemplate.Section
        style={{ height: '100%', paddingInline: '0px' }}
        restrictWidth="100%"
      >
        <Chart data={data} zoomRange={zoomRange} activeGroups={activeGroups} />
      </EuiPageTemplate.Section>
    </EuiPageTemplate>
  );
}
