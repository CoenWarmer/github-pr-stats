'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';
import { TimelineData, ApiResponse, PullRequestStats } from '@/lib/types';
import { transformToTimelineData } from '@/lib/timeline-transformer';
import Chart from '@/components/ChartImpl';
import {
  EuiPageTemplate,
  EuiTitle,
  EuiText,
  EuiSpacer,
  EuiPanel,
  EuiFlexGroup,
  EuiFlexItem,
  EuiButton,
  EuiLoadingSpinner,
  EuiEmptyPrompt,
  EuiIcon,
} from '@elastic/eui';
import PRStats from '@/components/PRStats';

interface PrPageParams {
  owner: string;
  repo: string;
  prNumber: string;
}

export default function PrPage() {
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

        if (result.data) {
          const timelineData = transformToTimelineData(result.data);
          setData(timelineData);
          setPrStats(result.data);
        } else {
          throw new Error(result.error || 'No data received from API');
        }
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

  if (loading) {
    return (
      <EuiPageTemplate>
        <EuiPageTemplate.Header
          pageTitle="Loading PR Timeline"
          description={`Loading data for ${params.owner}/${params.repo}#${params.prNumber}...`}
        />
        <EuiPageTemplate.Section>
          <EuiPanel hasBorder hasShadow={false}>
            <EuiFlexGroup
              justifyContent="center"
              alignItems="center"
              style={{ minHeight: '200px' }}
            >
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
          pageTitle="Error Loading PR"
          description={`Failed to load ${params.owner}/${params.repo}#${params.prNumber}`}
        />
        <EuiPageTemplate.Section>
          <EuiEmptyPrompt
            color="danger"
            icon={<EuiIcon type="alert" />}
            title={<h2>Failed to load PR data</h2>}
            body={
              <div>
                <EuiText>
                  <p>{error}</p>
                </EuiText>
                <EuiSpacer size="m" />
                <EuiButton color="primary" fill onClick={() => fetchPrData()}>
                  Try Again
                </EuiButton>
              </div>
            }
          />
        </EuiPageTemplate.Section>
      </EuiPageTemplate>
    );
  }

  if (!data) {
    return (
      <EuiPageTemplate>
        <EuiPageTemplate.Header
          pageTitle="No Data"
          description={`No data found for ${params.owner}/${params.repo}#${params.prNumber}`}
        />
        <EuiPageTemplate.Section>
          <EuiEmptyPrompt
            icon={<EuiIcon type="documents" />}
            title={<h2>No PR data available</h2>}
            body={
              <EuiText>
                <p>The requested PR data could not be found or loaded.</p>
              </EuiText>
            }
          />
        </EuiPageTemplate.Section>
      </EuiPageTemplate>
    );
  }

  return (
    <EuiPageTemplate>
      <EuiPageTemplate.Header
        pageTitle={
          <EuiFlexGroup alignItems="center" gutterSize="m">
            <EuiFlexItem grow={false}>
              <EuiTitle size="l">
                <h1>PR Timeline</h1>
              </EuiTitle>
            </EuiFlexItem>
          </EuiFlexGroup>
        }
        description={`${params.owner}/${params.repo}#${params.prNumber}`}
        rightSideItems={[
          <EuiButton
            key="back"
            iconType="arrowLeft"
            onClick={() => router.push('/')}
          >
            Back to Home
          </EuiButton>,
          <EuiButton
            key="refresh"
            iconType="refresh"
            onClick={() => fetchPrData(true)}
            isLoading={loading}
          >
            Force Refresh
          </EuiButton>,
        ]}
      />

      <EuiPageTemplate.Section>
        <EuiPanel hasBorder hasShadow={false}>
          {prStats && <PRStats pr={prStats} />}
        </EuiPanel>
      </EuiPageTemplate.Section>

      <EuiPageTemplate.Section>
        <EuiPanel hasBorder hasShadow={false}>
          <EuiFlexGroup direction="column" gutterSize="m">
            <EuiFlexItem>
              <EuiFlexGroup justifyContent="spaceBetween" alignItems="center">
                <EuiFlexItem>
                  <EuiTitle size="s">
                    <h2>📊 Timeline</h2>
                  </EuiTitle>
                </EuiFlexItem>
              </EuiFlexGroup>
            </EuiFlexItem>

            <EuiFlexItem>
              {data && data.items && data.groups ? (
                <Chart data={data} />
              ) : (
                <EuiEmptyPrompt
                  icon={<EuiIcon type="alert" />}
                  title={<h2>Invalid data structure</h2>}
                  body={
                    <EuiText>
                      <p>
                        The PR data could not be properly transformed for
                        timeline display.
                      </p>
                    </EuiText>
                  }
                />
              )}
            </EuiFlexItem>
          </EuiFlexGroup>
        </EuiPanel>
      </EuiPageTemplate.Section>
    </EuiPageTemplate>
  );
}
