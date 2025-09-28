'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  EuiPageTemplate,
  EuiButton,
  EuiFieldText,
  EuiFlexGroup,
  EuiEmptyPrompt,
} from '@elastic/eui';

export default function ClientOnlyPage() {
  const router = useRouter();
  const [url, setUrl] = useState(
    'https://github.com/elastic/kibana/pull/236422'
  );
  const [error, setError] = useState<string | null>(null);

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (url.trim()) {
      try {
        const { owner, repo, prNumber } = parseGitHubURL(url);
        router.push(`/pr/${owner}/${repo}/${prNumber}`);
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Invalid GitHub URL');
      }
    }
  };

  return (
    <EuiPageTemplate restrictWidth="1200px">
      <EuiPageTemplate.Header
        pageTitle="📊 GitHub PR Stats"
        description="Analyze pull request metrics and visualize the development timeline"
      />

      <EuiPageTemplate.Section>
        <EuiEmptyPrompt
          iconType="searchProfilerApp"
          title={<h2>Get Started</h2>}
          body={
            <p>
              Enter a GitHub pull request URL below to analyze its metrics and
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
                  required
                />
                <EuiButton type="submit" fill>
                  🔍 Analyze PR
                </EuiButton>
              </EuiFlexGroup>

              {error && (
                <div style={{ marginTop: '16px' }}>
                  <p style={{ color: '#BD271E' }}>❌ {error}</p>
                </div>
              )}
            </form>
          }
        />
      </EuiPageTemplate.Section>
    </EuiPageTemplate>
  );
}
