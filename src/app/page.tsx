'use client';

import { useState } from 'react';
import PRStats from '@/components/PRStats';
import Timeline from '@/components/Timeline';
import { PullRequestStats, ApiResponse, GanttData } from '@/lib/types';

export default function Home() {
  const [url, setUrl] = useState('');
  const [prData, setPrData] = useState<PullRequestStats | null>(null);
  const [timelineData, setTimelineData] = useState<GanttData | null>(null);
  const [loading, setLoading] = useState(false);
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

  const transformToGanttData = (pr: PullRequestStats): GanttData => {
    // Transform timeline events to wx-react-gantt tasks
    const tasks = pr.timeline
      .map((event, index) => {
        let taskName = event.type;
        let color = '#3B82F6'; // Default blue
        const startDate = new Date(event.date);
        let endDate = new Date(startDate.getTime() + 30 * 60 * 1000); // Default 30 min duration
        let progress = 100;

        // Categorize and customize events
        if (event.type.includes('commit') || event.type === 'commits_pushed') {
          color = '#3B82F6'; // Blue for commits
          taskName = `📝 ${event.commit_count || 1} commit${event.commit_count && event.commit_count > 1 ? 's' : ''}`;
          endDate = new Date(startDate.getTime() + 15 * 60 * 1000); // 15 min for commits
        } else if (event.type.includes('review')) {
          color = '#10B981'; // Green for reviews
          taskName = `👀 ${event.reviewer || 'Review'} - ${event.state || 'submitted'}`;
          // If we have review timing data, use it for duration
          if (event.time_to_review_hours) {
            endDate = new Date(
              startDate.getTime() + event.time_to_review_hours * 60 * 60 * 1000
            );
          } else {
            endDate = new Date(startDate.getTime() + 60 * 60 * 1000); // Default 1 hour
          }
          progress =
            event.state === 'APPROVED'
              ? 100
              : event.state === 'CHANGES_REQUESTED'
                ? 50
                : 75;
        } else if (event.type.includes('comment')) {
          color = '#F59E0B'; // Orange for comments
          taskName = `💬 ${event.comment_author || 'Comment'}`;
          endDate = new Date(startDate.getTime() + 5 * 60 * 1000); // 5 min for comments
        } else if (
          event.type.includes('ci_') ||
          event.type.includes('workflow')
        ) {
          color = '#8B5CF6'; // Purple for CI/CD
          taskName = `🔧 ${event.workflow_name || 'CI'} - ${event.ci_conclusion || event.ci_status || 'running'}`;
          endDate = new Date(startDate.getTime() + 45 * 60 * 1000); // 45 min for CI
          progress =
            event.ci_conclusion === 'success'
              ? 100
              : event.ci_conclusion === 'failure'
                ? 0
                : 50;
        } else if (event.type === 'opened') {
          color = '#059669'; // Emerald for PR lifecycle
          taskName = '🚀 PR Created';
          endDate = new Date(startDate.getTime() + 5 * 60 * 1000);
        } else if (event.type === 'closed' || event.type === 'merged') {
          color = event.type === 'merged' ? '#7C3AED' : '#EF4444'; // Purple for merged, red for closed
          taskName = event.type === 'merged' ? '✅ PR Merged' : '❌ PR Closed';
          endDate = new Date(startDate.getTime() + 5 * 60 * 1000);
        }

        return {
          id: `task_${index}`,
          text: taskName,
          start: startDate,
          end: endDate,
          progress,
          type: 'task' as const,
          color,
        };
      })
      .filter(task => task !== null); // Remove any null tasks

    // Add PR lifecycle overview as the main task
    const prStart = new Date(pr.created_at);
    const prEnd = new Date(pr.closed_at || pr.merged_at || new Date());

    tasks.unshift({
      id: 'pr_lifecycle',
      text: `📋 PR #${pr.id}: ${pr.title}`,
      start: prStart,
      end: prEnd,
      progress: pr.merged_at ? 100 : pr.closed_at ? 0 : 50,
      type: 'task' as const,
      color: pr.merged_at ? '#7C3AED' : pr.closed_at ? '#EF4444' : '#059669',
    });

    // Create links (dependencies) - simple sequential flow
    const links = tasks.slice(1).map((task, index) => ({
      id: `link_${index}`,
      source: index === 0 ? 'pr_lifecycle' : `task_${index - 1}`,
      target: task.id,
      type: 'finish_to_start' as const,
    }));

    // Define time scales for the Gantt chart
    const scales = [
      { unit: 'day' as const, step: 1, format: 'MMM dd' },
      { unit: 'hour' as const, step: 6, format: 'HH:mm' },
    ];

    return {
      tasks,
      links,
      scales,
    };
  };

  const fetchPRData = async () => {
    try {
      setLoading(true);
      setError(null);

      const { owner, repo, prNumber } = parseGitHubURL(url);

      const response = await fetch(`/api/pr/${owner}/${repo}/${prNumber}`);
      const result: ApiResponse<PullRequestStats> = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to fetch PR data');
      }

      if (result.data) {
        setPrData(result.data);
        setTimelineData(transformToGanttData(result.data));
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
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            📊 GitHub PR Stats
          </h1>
          <p className="text-gray-600 text-lg">
            Analyze pull request metrics and visualize the development timeline
          </p>
        </div>

        {/* URL Input Form */}
        <div className="max-w-4xl mx-auto mb-8">
          <form
            onSubmit={handleSubmit}
            className="bg-white p-6 rounded-lg shadow-md"
          >
            <div className="flex flex-col sm:flex-row gap-4">
              <input
                type="url"
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder="https://github.com/owner/repo/pull/123"
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                disabled={loading}
                required
              />
              <button
                type="submit"
                disabled={loading}
                className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? '⏳ Loading...' : '🔍 Analyze PR'}
              </button>
            </div>
            {error && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-red-600 text-sm">❌ {error}</p>
              </div>
            )}
          </form>
        </div>

        {/* Results */}
        {prData && (
          <div className="max-w-6xl mx-auto space-y-8">
            {/* PR Header */}
            <div className="bg-white p-6 rounded-lg shadow-md">
              <h2 className="text-2xl font-bold mb-2">
                <a
                  href={prData.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  {prData.title}
                </a>
              </h2>
              <div className="text-gray-600">
                PR #{prData.id} • Created{' '}
                {new Date(prData.created_at).toLocaleDateString()}
                {prData.merged_at && (
                  <span className="ml-2 px-2 py-1 bg-purple-100 text-purple-800 text-sm rounded-full font-medium">
                    ✅ Merged
                  </span>
                )}
                {prData.closed_at && !prData.merged_at && (
                  <span className="ml-2 px-2 py-1 bg-red-100 text-red-800 text-sm rounded-full font-medium">
                    ❌ Closed
                  </span>
                )}
              </div>
            </div>

            {/* PR Statistics */}
            <div>
              <h3 className="text-xl font-semibold mb-4">📈 Statistics</h3>
              <PRStats pr={prData} />
            </div>

            {/* Timeline */}
            {timelineData && (
              <div>
                <h3 className="text-xl font-semibold mb-4">⏱️ Timeline</h3>
                <div className="bg-white p-6 rounded-lg shadow-md">
                  <Timeline data={timelineData} pr={prData} />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Welcome message when no data */}
        {!prData && !loading && (
          <div className="max-w-4xl mx-auto text-center">
            <div className="bg-white p-8 rounded-lg shadow-md">
              <h2 className="text-2xl font-semibold text-gray-800 mb-4">
                🚀 Get Started
              </h2>
              <p className="text-gray-600 mb-4">
                Enter a GitHub pull request URL above to analyze its metrics and
                visualize the development timeline.
              </p>
              <div className="text-sm text-gray-500">
                <p>
                  Example:{' '}
                  <code className="bg-gray-100 px-2 py-1 rounded">
                    https://github.com/elastic/elasticsearch/pull/12345
                  </code>
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
