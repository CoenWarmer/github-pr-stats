'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  EuiPageTemplate,
  EuiButton,
  EuiFieldText,
  EuiFlexGroup,
  EuiEmptyPrompt,
  EuiFlexItem,
  EuiComboBox,
  EuiFormRow,
  EuiSpacer,
  EuiDatePickerRange,
  EuiDatePicker,
  EuiPanel,
} from '@elastic/eui';
import type { EuiComboBoxOptionOption } from '@elastic/eui';
import moment, { Moment } from 'moment';
import { NavBar } from './NavBar';

interface Team {
  slug: string;
  name: string;
  description: string;
  id: number;
}

export default function ClientOnlyPage() {
  const router = useRouter();
  const [url, setUrl] = useState(
    'https://github.com/elastic/kibana/pull/236422'
  );
  const [error, setError] = useState<string | null>(null);

  // Team selection state
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeams, setSelectedTeams] = useState<
    EuiComboBoxOptionOption<string>[]
  >([]);
  const [isLoadingTeams, setIsLoadingTeams] = useState(false);

  // Date range state (default to last 30 days)
  const [startDate, setStartDate] = useState<Moment | null>(
    moment().subtract(30, 'days')
  );
  const [endDate, setEndDate] = useState<Moment | null>(moment());

  // Repository filter (optional, comma-separated)
  const [repos, setRepos] = useState<string>('kibana');

  // Fetch teams on mount
  useEffect(() => {
    const fetchTeams = async () => {
      setIsLoadingTeams(true);
      try {
        const response = await fetch('/api/teams');
        if (!response.ok) {
          throw new Error('Failed to fetch teams');
        }
        const data = await response.json();
        setTeams(data.teams || []);
      } catch (err) {
        console.error('Error fetching teams:', err);
        setError(err instanceof Error ? err.message : 'Failed to load teams');
      } finally {
        setIsLoadingTeams(false);
      }
    };

    fetchTeams();
  }, []);

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
    <EuiPageTemplate>
      <NavBar />

      <EuiPageTemplate.Section>
        <EuiFlexGroup>
          <EuiFlexItem>
            <EuiPanel
              paddingSize="l"
              style={{ display: 'flex', alignItems: 'center' }}
            >
              <EuiEmptyPrompt
                iconType="searchProfilerApp"
                title={<h2>Inspect a PR Timeline</h2>}
                body={
                  <p>
                    Enter a GitHub pull request URL below to analyze its metrics
                    and visualize the development timeline.
                  </p>
                }
                actions={
                  <form onSubmit={handleSubmit}>
                    <EuiFormRow label="GitHub PR URL" fullWidth>
                      <EuiFieldText
                        type="url"
                        value={url}
                        onChange={e => setUrl(e.target.value)}
                        placeholder="https://github.com/owner/repo/pull/123"
                        fullWidth
                        required
                      />
                    </EuiFormRow>
                    <EuiFormRow fullWidth>
                      <EuiButton type="submit" fill fullWidth disabled={!url}>
                        Inspect
                      </EuiButton>
                    </EuiFormRow>
                    <EuiSpacer size="l" />
                  </form>
                }
              />
            </EuiPanel>
          </EuiFlexItem>
          <EuiFlexItem>
            <EuiPanel
              paddingSize="l"
              style={{ display: 'flex', alignItems: 'center' }}
            >
              <EuiEmptyPrompt
                iconType="indexOpen"
                title={<h2>Ingest PR Stats for a Team</h2>}
                body={
                  <p>
                    Select one or more teams to ingest PR stats for those teams.
                  </p>
                }
                actions={
                  <form
                    onSubmit={e => {
                      e.preventDefault();
                      if (selectedTeams.length === 0) {
                        setError('Please select at least one team');
                        return;
                      }

                      const teamSlugs = selectedTeams
                        .map(t => t.value)
                        .filter(Boolean)
                        .join(',');
                      const start = startDate?.format('YYYY-MM-DD') || '';
                      const end = endDate?.format('YYYY-MM-DD') || '';
                      const reposParam = repos.trim()
                        ? `&repos=${encodeURIComponent(repos.trim())}`
                        : '';

                      // Navigate to ingestion progress page
                      router.push(
                        `/ingest?teams=${encodeURIComponent(teamSlugs)}&start=${start}&end=${end}${reposParam}`
                      );
                    }}
                    style={{ width: '100%', maxWidth: '600px' }}
                  >
                    <EuiFormRow
                      label="Teams"
                      helpText="Select one or more teams to analyze"
                      fullWidth
                    >
                      <EuiComboBox
                        placeholder="Select teams..."
                        options={teams.map(team => ({
                          label: team.name,
                          value: team.slug,
                          'data-test-subj': `team-${team.slug}`,
                        }))}
                        selectedOptions={selectedTeams}
                        onChange={setSelectedTeams}
                        isLoading={isLoadingTeams}
                        fullWidth
                      />
                    </EuiFormRow>

                    <EuiSpacer size="m" />

                    <EuiFormRow
                      label="Date Range"
                      helpText="Select the date range for PRs to analyze"
                      fullWidth
                    >
                      <EuiDatePickerRange
                        startDateControl={
                          <EuiDatePicker
                            selected={startDate}
                            onChange={setStartDate}
                            startDate={startDate}
                            endDate={endDate}
                            aria-label="Start date"
                            showTimeSelect
                            dateFormat="MMM D YYYY"
                          />
                        }
                        endDateControl={
                          <EuiDatePicker
                            selected={endDate}
                            onChange={setEndDate}
                            startDate={startDate}
                            endDate={endDate}
                            aria-label="End date"
                            showTimeSelect
                            dateFormat="MMM D YYYY"
                          />
                        }
                      />
                    </EuiFormRow>

                    <EuiSpacer size="m" />

                    <EuiFormRow
                      label="Repositories (optional)"
                      helpText="Comma-separated list of repo names (e.g., 'kibana' or 'kibana,elasticsearch'). Leave empty for all repos."
                      fullWidth
                    >
                      <EuiFieldText
                        placeholder="e.g., kibana"
                        value={repos}
                        onChange={e => setRepos(e.target.value)}
                        fullWidth
                      />
                    </EuiFormRow>

                    <EuiSpacer size="m" />

                    <EuiButton
                      type="submit"
                      fill
                      disabled={selectedTeams.length === 0}
                      fullWidth
                    >
                      Ingest Team PRs
                    </EuiButton>

                    {error && (
                      <div style={{ marginTop: '16px' }}>
                        <p style={{ color: '#BD271E' }}>❌ {error}</p>
                      </div>
                    )}
                  </form>
                }
              />
            </EuiPanel>
          </EuiFlexItem>
        </EuiFlexGroup>
      </EuiPageTemplate.Section>
    </EuiPageTemplate>
  );
}
