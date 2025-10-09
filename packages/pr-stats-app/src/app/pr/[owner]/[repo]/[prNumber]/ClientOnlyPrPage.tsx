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
import ToolHelp from '@/components/ToolHelp';
import { NavBar } from '@/components/NavBar';

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
  const [selectedBuildId, setSelectedBuildId] = useState<string | null>(null);
  const [selectedRowGroup, setSelectedRowGroup] = useState<string | null>(null);

  // Map zoom options to their relevant groups
  const activeGroups = useMemo(() => {
    // If a row is selected, only show items from that row
    if (selectedRowGroup) {
      return [selectedRowGroup];
    }

    if (zoomOption === 'full') return null; // Show all groups

    const groupMap: Record<string, string[]> = {
      delivery: ['admin'], // Administrative (issues)
      development: ['dev'], // Development (PR lifecycle, commits)
      reviews: ['additional_reviewers'], // Review groups (dynamically generated)
      ci: ['ci'], // CI/CD group
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
  }, [zoomOption, data?.groups, selectedRowGroup]);

  // Handle row click: zoom to show all items in that row
  const handleRowClick = useCallback(
    (groupId: string) => {
      if (!data) return;

      // Toggle: if clicking the same row, deselect it
      if (selectedRowGroup === groupId) {
        setSelectedRowGroup(null);
        setZoomRange(null);
        setZoomOption('full');
        return;
      }

      // Select the row
      setSelectedRowGroup(groupId);
      setZoomOption('full'); // Clear zoom preset

      // Find all items in this group
      const groupItems = data.items.filter(item => item.group === groupId);

      if (groupItems.length === 0) {
        // No items in this group
        setZoomRange(null);
        return;
      }

      // Find min and max times
      const times = groupItems.flatMap(item => [
        new Date(item.start).getTime(),
        item.end
          ? new Date(item.end).getTime()
          : new Date(item.start).getTime(),
      ]);

      const minTime = Math.min(...times);
      const maxTime = Math.max(...times);

      // Add some padding (10% on each side)
      const padding = (maxTime - minTime) * 0.1;
      const startDate = new Date(minTime - padding);
      const endDate = new Date(maxTime + padding);

      setZoomRange([startDate, endDate]);
    },
    [data, selectedRowGroup]
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
        const forceParam = forceRefresh ? '&force=true' : '';
        const eventSource = new EventSource(
          `/api/pr/${params.owner}/${params.repo}/${params.prNumber}?stream=true${forceParam}`
        );

        eventSource.onmessage = event => {
          try {
            const data = JSON.parse(event.data);

            if (data.error) {
              throw new Error(data.error);
            }

            if (data.complete && data.data) {
              // SSE complete with data included
              eventSource.close();
              setPrStats(data.data);
              setLoading(false);
              setProgressPercent(100);
              setProgressStep('Complete');
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
        'workflow_name' in event &&
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
        // For CI events, match both main builds (exact match) and jobs (starts with workflow name)
        if ('workflow_name' in event && event.workflow_name) {
          // Exact match for main builds (e.g., "kibana / pull request")
          if (event.workflow_name === selectedWorkflow) {
            return true;
          }
          // Match jobs that belong to the selected workflow (e.g., "kibana / pull request - Pre-Build")
          // Jobs have format "workflow - job name"
          if (event.workflow_name.startsWith(selectedWorkflow + ' - ')) {
            return true;
          }
        }
        return false;
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

  // Calculate zoom ranges for different views
  const zoomRanges = useMemo(() => {
    if (!prStats) return null;

    const ranges: Record<string, [Date, Date] | null> = {
      full: null, // null means show everything
      delivery: null,
      development: null,
      reviews: null,
      ci: null,
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

    // CI/CD: First CI run to last CI completion
    const ciEvents = prStats.timeline.filter(
      event =>
        event.type === 'ci_run' ||
        event.type === 'ci_started' ||
        event.type === 'ci_completed' ||
        event.type.includes('ci_')
    );

    if (ciEvents.length > 0) {
      const ciTimes = ciEvents.map(e => new Date(e.date));
      const firstCi = ciTimes.sort((a, b) => a.getTime() - b.getTime())[0];
      const lastCi = ciTimes.sort((a, b) => b.getTime() - a.getTime())[0];

      // Ensure there's a minimum time range (at least 30 minutes)
      const minRangeMs = 30 * 60 * 1000; // 30 minutes
      const rangeMs = lastCi.getTime() - firstCi.getTime();

      if (rangeMs < minRangeMs) {
        // Expand the range symmetrically around the midpoint
        const midpoint = (firstCi.getTime() + lastCi.getTime()) / 2;
        const halfRange = minRangeMs / 2;
        ranges.ci = [
          new Date(midpoint - halfRange),
          new Date(midpoint + halfRange),
        ];
      } else {
        ranges.ci = [firstCi, lastCi];
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
        <NavBar />
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
        <NavBar />
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

  if (!loading && (!data || !data.items || !data.groups)) {
    // Only show "no data" if we're not loading and have no data
    return (
      <EuiPageTemplate>
        <NavBar />
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
      <NavBar />
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
      >
        {prStats?.linked_issues?.map(issue => (
          <EuiFlexItem key={issue.number} grow={false}>
            <EuiFlexGroup direction="column" gutterSize="xs">
              <EuiFlexItem>
                <EuiFlexGroup gutterSize="s" alignItems="center">
                  <EuiFlexItem grow={false}>
                    <EuiText size="s">
                      <strong>
                        Linked issue:
                        <a
                          href={issue.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ textDecoration: 'none' }}
                        >
                          {issue.title} #{issue.number}
                        </a>{' '}
                      </strong>{' '}
                      {issue.assignees.length > 0 &&
                        issue.assignees.map(assignee => assignee).join(', ')}
                    </EuiText>
                  </EuiFlexItem>
                  <EuiFlexItem grow={false}>
                    <EuiBadge
                      color={issue.state === 'closed' ? 'success' : 'default'}
                    >
                      {issue.state.toUpperCase()}
                    </EuiBadge>
                  </EuiFlexItem>
                </EuiFlexGroup>
              </EuiFlexItem>

              {issue.labels.length > 0 && (
                <EuiFlexItem>
                  <EuiSpacer size="s" />
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
          </EuiFlexItem>
        ))}
      </EuiPageTemplate.Header>
      <EuiPageTemplate.Header>
        {prStats && (
          <PRStats pr={prStats} selectedWorkflow={selectedWorkflow} />
        )}
      </EuiPageTemplate.Header>

      <EuiPageTemplate.Section grow={false}>
        <EuiFlexGroup direction="row" gutterSize="l" alignItems="flexEnd">
          <EuiFlexItem grow>
            <EuiFormRow label="Zoom to Phase" display="row" fullWidth>
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
                  {
                    id: 'ci',
                    label: 'CI/CD',
                  },
                ]}
                idSelected={zoomOption}
                onChange={(id: string) => {
                  // Toggle: clicking the same button resets to full view
                  setZoomOption(id === zoomOption ? 'full' : id);
                }}
                buttonSize="compressed"
                color="primary"
              />
            </EuiFormRow>
          </EuiFlexItem>

          <EuiFlexItem grow={false}>
            <EuiFormRow label="Filter CI/CD Workflows" display="row">
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

      <EuiPageTemplate.Section restrictWidth="100%">
        <div style={{ position: 'relative' }}>
          <div
            style={{
              position: 'absolute',
              left: '14px',
              bottom: '14px',
              paddingInline: '16px',
            }}
          >
            <ToolHelp />
          </div>
          {data && (
            <Chart
              data={data}
              zoomRange={zoomRange}
              activeGroups={activeGroups}
              selectedBuildId={selectedBuildId}
              onBuildDoubleClick={buildId => {
                // Toggle: if same build is double-clicked, deselect it
                if (selectedBuildId === buildId) {
                  setSelectedBuildId(null);
                  // Keep current zoom level, don't reset it
                  return;
                }

                // Select the build and zoom to show it
                setSelectedBuildId(buildId);

                // Find the build item in the timeline
                const buildItem = data.items.find(
                  item =>
                    (item.eventType === 'ci_run' ||
                      item.eventType === 'ci_started') &&
                    item.buildkite_build_id === buildId
                );

                if (buildItem) {
                  const startTime = new Date(buildItem.start).getTime();
                  const endTime = buildItem.end
                    ? new Date(buildItem.end).getTime()
                    : startTime + 30 * 60 * 1000; // Default 30 min if no end time

                  // Add minimal padding (1% on each side)
                  const duration = endTime - startTime;
                  const padding = Math.max(duration * 0.01, 1 * 60 * 1000); // At least 1 minute padding
                  const startDate = new Date(startTime - padding);
                  const endDate = new Date(endTime + padding);

                  setZoomRange([startDate, endDate]);
                }
              }}
              onRowClick={handleRowClick}
              onZoomRangeChange={range => {
                setZoomRange(range);
                setZoomOption('full'); // Clear preset
                setSelectedRowGroup(null); // Clear row selection
              }}
            />
          )}
        </div>
      </EuiPageTemplate.Section>
    </EuiPageTemplate>
  );
}
