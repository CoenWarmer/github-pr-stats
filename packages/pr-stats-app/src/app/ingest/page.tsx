'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  EuiPageTemplate,
  EuiPanel,
  EuiTitle,
  EuiSpacer,
  EuiText,
  EuiButton,
  EuiCallOut,
  EuiBasicTable,
  EuiLink,
  EuiLoadingSpinner,
  EuiBadge,
  EuiProgress,
  EuiButtonIcon,
  EuiFlexGroup,
  EuiFlexItem,
} from '@elastic/eui';
import type { EuiBasicTableColumn } from '@elastic/eui';
import { NavBar } from '@/components/NavBar';
import { JobStatus } from '@/lib/services';

interface PR {
  owner: string;
  repo: string;
  number: number;
  title: string;
  author: string;
  url: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  error?: string;
}

function IngestPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const teams = useMemo(
    () => searchParams.get('teams')?.split(',') || [],
    [searchParams]
  );
  const startDate = searchParams.get('start') || '';
  const endDate = searchParams.get('end') || '';
  const repos = searchParams.get('repos') || '';

  const [status, setStatus] = useState<
    'loading' | 'processing' | 'complete' | 'error'
  >('loading');
  const [prs, setPrs] = useState<PR[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [teamInfo, setTeamInfo] = useState<{
    team: string;
    repo: string;
    members: number;
  } | null>(null);

  useEffect(() => {
    if (teams.length === 0) return;

    let isCancelled = false;
    let pollInterval: NodeJS.Timeout | null = null;

    const startJob = async () => {
      setStatus('loading');

      try {
        const team = teams[0];

        // Start the background job
        const response = await fetch('/api/prs/team/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            team,
            repos,
            startDate,
            endDate,
          }),
        });

        if (!response.ok) {
          throw new Error('Failed to start job');
        }

        const { jobId } = await response.json();

        // Start polling for status
        pollInterval = setInterval(async () => {
          if (isCancelled) return;

          try {
            const statusResponse = await fetch(`/api/prs/team/status/${jobId}`);

            if (!statusResponse.ok) {
              throw new Error('Failed to fetch status');
            }

            const jobStatus: JobStatus = await statusResponse.json();

            // Update team info on first poll
            if (teamInfo === null) {
              setTeamInfo({
                team: jobStatus.team,
                repo: jobStatus.repo,
                members: 0, // Not available in job status
              });
            }

            // Update PRs - ensure we always have an array
            if (jobStatus.prs && Array.isArray(jobStatus.prs)) {
              setPrs(jobStatus.prs);
            }
            setStatus('processing');

            // Check if complete
            if (jobStatus.status === 'completed') {
              setStatus('complete');
              if (pollInterval) clearInterval(pollInterval);
            } else if (jobStatus.status === 'error') {
              setErrorMessage(jobStatus.error || 'Job failed');
              setStatus('error');

              if (pollInterval) clearInterval(pollInterval);
            }
          } catch (error) {
            console.error('Error polling status:', error);
            // Continue polling on error
          }
        }, 2000); // Poll every 2 seconds
      } catch (error) {
        if (isCancelled) return;
        console.error('Error starting job:', error);
        setErrorMessage(
          error instanceof Error ? error.message : 'Failed to start processing'
        );
        setStatus('error');
      }
    };

    startJob();

    return () => {
      isCancelled = true;
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [teams, startDate, endDate, repos, teamInfo]);

  const handleRefreshPR = async (pr: PR) => {
    // Set PR to processing state
    setPrs(prev =>
      prev.map(p =>
        p.number === pr.number ? { ...p, status: 'processing' as const } : p
      )
    );

    try {
      // Call the API to force refresh this PR
      const response = await fetch(
        `/api/pr/${pr.owner}/${pr.repo}/${pr.number}?force=true`
      );

      if (!response.ok) {
        throw new Error('Failed to refresh PR');
      }

      // Set PR back to completed state
      setPrs(prev =>
        prev.map(p =>
          p.number === pr.number ? { ...p, status: 'completed' as const } : p
        )
      );
    } catch (error) {
      console.error(`Error refreshing PR #${pr.number}:`, error);
      // Set PR to error state
      setPrs(prev =>
        prev.map(p =>
          p.number === pr.number
            ? {
                ...p,
                status: 'error' as const,
                error:
                  error instanceof Error ? error.message : 'Failed to refresh',
              }
            : p
        )
      );
    }
  };

  const columns: Array<EuiBasicTableColumn<PR>> = [
    {
      field: 'number',
      name: 'PR #',
      width: '100px',
      render: (number: number, pr: PR) => {
        if (pr.status === 'completed') {
          return (
            <EuiLink
              href={`/pr/${pr.owner}/${pr.repo}/${number}`}
              target="_blank"
              external
            >
              #{number}
            </EuiLink>
          );
        }
        return `#${number}`;
      },
    },
    {
      field: 'title',
      name: 'Title',
      render: (title: string, pr: PR) => {
        if (pr.status === 'completed') {
          return (
            <EuiLink
              href={`/pr/${pr.owner}/${pr.repo}/${pr.number}`}
              target="_blank"
              external
            >
              {title}
            </EuiLink>
          );
        }
        return title;
      },
    },
    {
      field: 'author',
      name: 'Author',
      width: '150px',
    },
    {
      field: 'status',
      name: 'Status',
      width: '140px',
      // align: 'right',
      render: (status: PR['status'], pr: PR) => {
        switch (status) {
          case 'pending':
            return <EuiBadge color="default">Pending</EuiBadge>;
          case 'processing':
            return (
              <EuiFlexGroup
                gutterSize="s"
                alignItems="center"
                responsive={false}
              >
                <EuiFlexItem grow={false}>
                  <EuiLoadingSpinner size="m" />
                </EuiFlexItem>
                <EuiFlexItem grow={false}>
                  <span>Processing...</span>
                </EuiFlexItem>
              </EuiFlexGroup>
            );
          case 'completed':
            return (
              <EuiFlexGroup
                gutterSize="s"
                alignItems="center"
                responsive={false}
              >
                <EuiFlexItem grow={false}>
                  <EuiBadge color="success">✓ Completed</EuiBadge>
                </EuiFlexItem>
                <EuiFlexItem grow={false}>
                  <EuiButtonIcon
                    iconType="refresh"
                    aria-label="Refresh this PR"
                    size="s"
                    color="primary"
                    onClick={() => handleRefreshPR(pr)}
                  />
                </EuiFlexItem>
              </EuiFlexGroup>
            );
          case 'error':
            return (
              <EuiFlexGroup
                gutterSize="s"
                alignItems="center"
                responsive={false}
              >
                <EuiFlexItem grow={false}>
                  <EuiBadge color="danger" title={pr.error}>
                    ✗ Error
                  </EuiBadge>
                </EuiFlexItem>
                <EuiFlexItem grow={false}>
                  <EuiButtonIcon
                    iconType="refresh"
                    aria-label="Retry this PR"
                    size="s"
                    color="danger"
                    onClick={() => handleRefreshPR(pr)}
                  />
                </EuiFlexItem>
              </EuiFlexGroup>
            );
          default:
            return null;
        }
      },
    },
  ];

  const completedCount = (prs || []).filter(
    pr => pr.status === 'completed'
  ).length;
  const errorCount = (prs || []).filter(pr => pr.status === 'error').length;
  const progressPercent =
    (prs || []).length > 0
      ? Math.round((completedCount / (prs || []).length) * 100)
      : 0;

  if (teams.length === 0) {
    return (
      <EuiPageTemplate>
        <NavBar />
        <EuiPageTemplate.Section>
          <EuiCallOut
            title="No teams selected"
            color="warning"
            iconType="warning"
          >
            <p>Please go back and select at least one team.</p>
            <EuiSpacer size="m" />
            <EuiButton onClick={() => router.push('/')}>Back to Home</EuiButton>
          </EuiCallOut>
        </EuiPageTemplate.Section>
      </EuiPageTemplate>
    );
  }

  return (
    <EuiPageTemplate>
      <NavBar />
      <EuiPageTemplate.Section>
        <EuiPanel paddingSize="l">
          <EuiTitle size="l">
            <h1>Ingesting PR Stats</h1>
          </EuiTitle>
          <EuiSpacer size="m" />

          {teamInfo && (
            <>
              <EuiText color="subdued">
                <p>
                  <strong>Team:</strong> {teamInfo.team}
                  <br />
                  <strong>Repository:</strong> {teamInfo.repo}
                  <br />
                  <strong>Date Range:</strong> {startDate} to {endDate}
                  <br />
                  <strong>Team Members:</strong> {teamInfo.members}
                  <br />
                  <strong>Total PRs:</strong> {(prs || []).length}
                </p>
              </EuiText>

              <EuiSpacer size="m" />
            </>
          )}

          <EuiSpacer size="xl" />

          {status === 'loading' && (
            <>
              <EuiText>
                <h3>Fetching list of PRs...</h3>
              </EuiText>
              <EuiSpacer size="m" />
              <EuiProgress size="m" color="primary" />
            </>
          )}

          {status === 'processing' && (
            <>
              <EuiProgress
                value={completedCount + errorCount}
                max={(prs || []).length}
                size="l"
                color="primary"
                label={`Processing PRs (${progressPercent}%)`}
                valueText
              />

              <EuiSpacer size="m" />

              <EuiText size="s" color="subdued">
                <p>
                  {completedCount} completed, {errorCount} errors,{' '}
                  {(prs || []).length - completedCount - errorCount} remaining
                </p>
              </EuiText>

              <EuiSpacer size="xl" />

              <EuiBasicTable
                items={prs || []}
                columns={columns}
                rowHeader="number"
                tableLayout="auto"
              />
            </>
          )}

          {status === 'complete' && (
            <>
              <EuiCallOut
                title="Processing Complete!"
                color="success"
                iconType="check"
              >
                <p>
                  Successfully processed {completedCount} out of{' '}
                  {(prs || []).length} PRs.
                  {errorCount > 0 && ` ${errorCount} PRs failed to process.`}
                </p>
              </EuiCallOut>

              <EuiSpacer size="xl" />

              <EuiBasicTable
                items={prs || []}
                columns={columns}
                rowHeader="number"
                tableLayout="auto"
              />

              <EuiSpacer size="xl" />

              <EuiButton onClick={() => router.push('/')} fill>
                Back to Home
              </EuiButton>
            </>
          )}

          {status === 'error' && (
            <>
              <EuiCallOut title="Error" color="danger" iconType="error">
                <p>{errorMessage}</p>
              </EuiCallOut>

              <EuiSpacer size="m" />

              <EuiButton onClick={() => router.push('/')}>
                Back to Home
              </EuiButton>
            </>
          )}
        </EuiPanel>
      </EuiPageTemplate.Section>
    </EuiPageTemplate>
  );
}

export default function IngestPage() {
  return (
    <Suspense
      fallback={
        <EuiPageTemplate>
          <NavBar />
          <EuiPageTemplate.Section>
            <EuiPanel paddingSize="l">
              <EuiTitle size="l">
                <h1>Loading...</h1>
              </EuiTitle>
              <EuiSpacer size="m" />
              <EuiProgress size="m" color="primary" />
            </EuiPanel>
          </EuiPageTemplate.Section>
        </EuiPageTemplate>
      }
    >
      <IngestPageContent />
    </Suspense>
  );
}
