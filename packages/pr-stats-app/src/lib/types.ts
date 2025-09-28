export interface TimelineEvent {
  type: string;
  date: string;
  end_date?: string;
  reviewer?: string;
  workflow_name?: string;
  state?: string;
  commit_count?: number;
  comment_author?: string;
  comment_content?: string;
  comment_url?: string;
  comment_id?: number;
  ci_conclusion?: string;
  ci_status?: string;
  build_url?: string;
  buildkite_build_id?: string;
  buildkite_pipeline_slug?: string;
  // Duration fields (calculated at data collection time)
  duration_ms?: number;
  duration_minutes?: number;
  duration_hours?: number;
  // Control visibility in frontend
  hidden_from_timeline?: boolean;
  submitted_at?: string;
  time_to_review_hours?: number;
  reviewer_teams?: string[];
  author_reviewer_relationship?: string;
  commits?: Array<{
    sha: string;
    message: string;
    author: string;
    date: string;
  }>;
  issue_number?: number;
  issue_title?: string;
  assignee?: string;
  requested_team?: string;
}

// Buildkite API Types
export interface BuildkiteBuild {
  id: string;
  number: number;
  state:
    | 'running'
    | 'scheduled'
    | 'passed'
    | 'failed'
    | 'blocked'
    | 'canceled'
    | 'canceling'
    | 'skipped'
    | 'not_run';
  blocked: boolean;
  message: string;
  commit: string;
  branch: string;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  url: string;
  web_url: string;
  pipeline: {
    id: string;
    slug: string;
    name: string;
    url: string;
    web_url: string;
  };
  jobs: BuildkiteJob[];
}

export interface BuildkiteJob {
  id: string;
  name: string | null;
  state:
    | 'waiting'
    | 'pending'
    | 'running'
    | 'passed'
    | 'failed'
    | 'blocked'
    | 'canceled'
    | 'skipped'
    | 'broken'
    | 'timed_out';
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  web_url: string;
  type: 'script' | 'waiter' | 'manual' | 'trigger';
}

export interface IssueLifecycleEvent {
  event_type: 'created' | 'assigned' | 'unassigned' | 'in_progress' | 'closed';
  date: string;
  actor?: string;
  assignee?: string;
}

export interface LinkedIssue {
  number: number;
  title: string;
  url: string;
  state: string;
  labels: string[];
  assignees: string[];
  created_at: string;
  closed_at: string | null;
  lifecycle_events: IssueLifecycleEvent[];
}

export interface PullRequestStats {
  id: string | number;
  url: string;
  state: string;
  additions: number;
  author: string;
  changed_files: number;
  created_at: string;
  headSha: string;
  closed_at: string | null;
  merged_at: string | null;
  updated_at: string;
  turnaround_time_hours: number;
  back_and_forth_count: number;
  comments: number;
  commits: number;
  deletions: number;
  review_comments: number;
  review_timings: ReviewTiming[];
  title: string;
  timeline: TimelineEvent[];
  codeowners?: { teams: string[]; individuals: string[] };
  linked_issues?: LinkedIssue[];
  requested_teams?: string[];
}

export interface ReviewTiming {
  reviewer: string;
  submitted_at: string;
  time_to_review_hours: number;
  state: string;
  author_teams: string[];
  reviewer_teams: string[];
  author_reviewer_relationship: string;
  time_to_new_commits_pushed?: number;
  time_to_author_response?: number;
  review_url?: string;
  review_id?: number;
}

// Timeline data structures for dnd-timeline
export interface TimelineGroup {
  id: string;
  content: string;
  order?: number;
}

export interface TimelineItem {
  id: string;
  group: string;
  start: string;
  end?: string;
  content: string;
  title?: string;
  className?: string;
  githubUrl?: string;
  slackUrl?: string;
  color?: string;
  isPointInTime?: boolean;
}

export interface TimelineData {
  groups: TimelineGroup[];
  items: TimelineItem[];
}

// Additional types for Next.js app
export interface PRFormData {
  owner: string;
  repo: string;
  prNumber: number;
}

export interface ApiResponse<T> {
  data?: T;
  error?: string;
  loading?: boolean;
}
