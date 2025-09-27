'use client';

import { useState } from 'react';
import PRStats from '@/components/PRStats';
import Timeline from '@/components/Timeline';
import {
  EuiPageTemplate,
  EuiTitle,
  EuiText,
  EuiSpacer,
  EuiButton,
  EuiFieldText,
  EuiFlexGroup,
  EuiPanel,
  EuiIcon,
  EuiEmptyPrompt,
  EuiFlexItem,
} from '@elastic/eui';
import { PullRequestStats, ApiResponse, TimelineData } from '@/lib/types';
import { transformToTimelineData } from '@/lib/timeline-transformer';

export default function ClientOnlyPage() {
  const [url, setUrl] = useState(
    'https://github.com/elastic/kibana/pull/236422'
  );
  const [prData, setPrData] = useState<PullRequestStats | null>(null);
  const [timelineData, setTimelineData] = useState<TimelineData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<{
    cached: boolean;
    timestamp: number;
  } | null>(null);

  const parseGitHubURL = (url: string) => {
    const match = url.match(/github\.com\/([^\/]+)\/([^\/]+)\/pull\/(\d+)/);
    if (!match) {
      throw new Error(
        'Invalid GitHub PR URL. Expected format: https://github.com/owner/repo/pull/123'
      );
    }
    return {
      owner: match[1],
      repo: match[2],
      prNumber: parseInt(match[3]),
    };
  };

  const fetchPRData = async (forceRefresh: boolean = false) => {
    try {
      setLoading(true);
      setError(null);

      const { owner, repo, prNumber } = parseGitHubURL(url);

      const apiUrl = `/api/pr/${owner}/${repo}/${prNumber}${forceRefresh ? '?force=true' : ''}`;
      const response = await fetch(apiUrl);
      const result: ApiResponse<PullRequestStats> & {
        cached?: boolean;
        timestamp?: number;
      } = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to fetch PR data');
      }

      if (result.data) {
        setPrData(result.data);
        setTimelineData(transformToTimelineData(result.data));
        setLastFetch({
          cached: result.cached || false,
          timestamp: result.timestamp || Date.now(),
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setPrData(null);
      setTimelineData(null);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (url.trim()) {
      fetchPRData();
    }
  };

  return (
    <EuiPageTemplate restrictWidth="1200px">
      <EuiPageTemplate.Header
        pageTitle="📊 GitHub PR Stats"
        description="Analyze pull request metrics and visualize the development timeline"
      />

      <EuiPageTemplate.Section>
        {/* Results */}
        {prData && (
          <div>
            {/* PR Header */}
            <EuiPanel hasBorder hasShadow={false}>
              <EuiTitle size="m">
                <h2>
                  <a
                    href={prData.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {prData.title}

                    <EuiIcon type="externalLink" />
                  </a>
                </h2>
              </EuiTitle>
              <EuiSpacer size="s" />
              <EuiText color="subdued">
                <p>
                  PR #{prData.id} • Created{' '}
                  {new Date(prData.created_at).toLocaleDateString()}
                  {prData.merged_at && <span>✅ Merged</span>}
                  {prData.closed_at && !prData.merged_at && (
                    <span>❌ Closed</span>
                  )}
                </p>
              </EuiText>

              <div>
                <strong>Author:</strong> {prData.author} |{' '}
                <strong>Created:</strong>{' '}
                {new Date(prData.created_at).toLocaleDateString()} |{' '}
                <strong>Status:</strong> {prData.state}
                {prData.merged_at ? ' (merged)' : ''}
              </div>

              <EuiSpacer size="s" />

              <EuiFlexGroup justifyContent="spaceBetween" alignItems="center">
                <EuiFlexItem grow={false}>
                  {lastFetch && (
                    <EuiText size="s" color="subdued">
                      <p>
                        {lastFetch.cached ? '📦 Cached data' : '🔄 Fresh data'}{' '}
                        • Last updated:{' '}
                        {new Date(lastFetch.timestamp).toLocaleTimeString()}
                      </p>
                    </EuiText>
                  )}
                </EuiFlexItem>
                <EuiFlexItem grow={false}>
                  <EuiButton
                    size="s"
                    iconType="refresh"
                    onClick={() => fetchPRData(true)}
                    isLoading={loading}
                    disabled={loading}
                  >
                    Force Refresh
                  </EuiButton>
                </EuiFlexItem>
              </EuiFlexGroup>
            </EuiPanel>

            {/* PR Statistics */}
            <div>
              <EuiTitle size="s">
                <h3>📈 Statistics</h3>
              </EuiTitle>
              <EuiSpacer size="m" />
              <PRStats pr={prData} />
            </div>

            {/* Timeline */}
            {timelineData && (
              <div>
                <EuiTitle size="s">
                  <h3>⏱️ Timeline</h3>
                </EuiTitle>
                <EuiSpacer size="m" />
                <div>
                  <Timeline data={timelineData} pr={prData} />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Welcome message when no data */}
        {!prData && !loading && (
          <EuiEmptyPrompt
            iconType="searchProfilerApp"
            title={<h2>Get Started</h2>}
            body={
              <p>
                Enter a GitHub pull request URL above to analyze its metrics and
                visualize the development timeline.
              </p>
            }
            actions={
              <form onSubmit={handleSubmit}>
                <EuiFlexGroup>
                  <EuiFieldText
                    type="url"
                    value={url}
                    onChange={e => setUrl(e.target.value)}
                    placeholder="https://github.com/owner/repo/pull/123"
                    disabled={loading}
                    required
                  />
                  <EuiButton
                    type="submit"
                    disabled={loading}
                    isLoading={loading}
                  >
                    {loading ? '⏳ Loading...' : '🔍 Analyze PR'}
                  </EuiButton>

                  {error && (
                    <div>
                      <p>❌ {error}</p>
                    </div>
                  )}
                </EuiFlexGroup>
              </form>
            }
            footer={
              <>
                <EuiText size="s" color="subdued">
                  <p>
                    Example:{' '}
                    <code>
                      https://github.com/elastic/elasticsearch/pull/12345
                    </code>
                  </p>
                </EuiText>
              </>
            }
          />
        )}
      </EuiPageTemplate.Section>
    </EuiPageTemplate>
  );
}
