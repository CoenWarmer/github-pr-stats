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
