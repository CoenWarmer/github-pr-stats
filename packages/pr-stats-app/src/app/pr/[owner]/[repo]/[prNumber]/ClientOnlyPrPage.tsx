'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';
import { TimelineData, ApiResponse, PullRequestStats } from '@/lib/types';
import { transformToTimelineData } from '@/lib/timeline-transformer';
import Chart from '@/components/ChartImpl';
import {
  EuiPageTemplate,
  EuiText,
  EuiSpacer,
  EuiPanel,
  EuiFlexGroup,
  EuiFlexItem,
  EuiButton,
  EuiLoadingSpinner,
  EuiEmptyPrompt,
  EuiButtonIcon,
  EuiIcon,
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

        // Transform the data for the timeline
        const timelineData = transformToTimelineData(result.data);
        setData(timelineData);
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

  useEffect(() => {
    fetchPrData();
  }, [fetchPrData]);

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
              <EuiIcon type="popout" size="s" style={{ marginLeft: '4px' }} />
            </a>
          </>
        }
        description={<></>}
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
        {prStats && <PRStats pr={prStats} />}
      </EuiPageTemplate.Header>
      <EuiPageTemplate.Section>
        <Chart data={data} />
      </EuiPageTemplate.Section>
    </EuiPageTemplate>
  );
}
