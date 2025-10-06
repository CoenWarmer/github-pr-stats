// Base event interface with only truly common fields
interface BaseTimelineEvent {
  date: string;
  end_date?: string;
  url?: string;
  hidden_from_timeline?: boolean;
  // Duration fields (calculated at data collection time)
  duration_ms?: number;
  duration_minutes?: number;
  duration_hours?: number;
}

// Mixin interfaces for shared field groups
interface ReviewFields {
  reviewer?: string;
  state?: string;
  time_to_review_hours?: number;
  reviewer_teams?: string[];
  author_reviewer_relationship?: string;
  submitted_at?: string;
  review_body?: string; // Review comment/body content
}

interface CiFields {
  workflow_name?: string;
  ci_conclusion?: string;
  ci_status?: string;
  buildkite_build_id?: string;
  buildkite_pipeline_slug?: string;
}

interface CommentFields {
  comment_author?: string;
  comment_content?: string;
  comment_id?: number;
}

interface CommitFields {
  commit_count?: number;
  commits?: Array<{
    sha: string;
    message: string;
    full_message?: string;
    body?: string;
    author: string;
    date: string;
  }>;
}

interface IssueFields {
  issue_number?: number;
  issue_title?: string;
  assignee?: string;
}

// PR lifecycle events
export interface PrOpenedEvent extends BaseTimelineEvent {
  type: 'opened';
}

export interface PrClosedEvent extends BaseTimelineEvent {
  type: 'closed';
}

export interface PrMergedEvent extends BaseTimelineEvent {
  type: 'merged';
}

export interface PrReadyForReviewEvent extends BaseTimelineEvent {
  type: 'ready_for_review';
}

export interface PrDraftEvent extends BaseTimelineEvent {
  type: 'draft';
}

export interface PrOpenedDraftEvent extends BaseTimelineEvent {
  type: 'opened_draft';
}

// Commit events
export interface CommitEvent extends BaseTimelineEvent {
  type: 'commit';
}

export interface CommitsAddedEvent extends BaseTimelineEvent, CommitFields {
  type: 'commits_added';
}

export interface CommitsPushedEvent extends BaseTimelineEvent, CommitFields {
  type: 'commits_pushed';
}

export interface HeadRefForcePushedEvent extends BaseTimelineEvent {
  type: 'head_ref_force_pushed';
}

// Comment events
export interface CommentAddedEvent extends BaseTimelineEvent, CommentFields {
  type: 'comment_added';
}

export interface ReviewCommentAddedEvent
  extends BaseTimelineEvent,
    CommentFields {
  type: 'review_comment_added';
}

export interface IssueCommentEvent extends BaseTimelineEvent, CommentFields {
  type: 'issue_comment';
}

// Review events
export interface ReviewEvent extends BaseTimelineEvent, ReviewFields {
  type: 'review';
}

export interface ReviewRequestedEvent extends BaseTimelineEvent {
  type: 'review_requested';
  reviewer?: string;
}

export interface ReviewDismissedEvent extends BaseTimelineEvent {
  type: 'review_dismissed';
  reviewer?: string;
}

export interface AwaitingReviewEvent extends BaseTimelineEvent {
  type: 'awaiting_review';
  reviewer?: string;
}

export interface TeamReviewRequestedEvent extends BaseTimelineEvent {
  type: 'team_review_requested';
  requested_team?: string;
}

// CI/CD events
export interface CiStartedEvent extends BaseTimelineEvent, CiFields {
  type: 'ci_started';
}

export interface CiRunEvent extends BaseTimelineEvent, CiFields {
  type: 'ci_run';
}

export interface CiCompletedEvent extends BaseTimelineEvent, CiFields {
  type: 'ci_completed';
}

// Issue events
export interface IssueCreatedEvent extends BaseTimelineEvent, IssueFields {
  type: 'issue_created';
}

export interface IssueAssignedEvent extends BaseTimelineEvent, IssueFields {
  type: 'issue_assigned';
}

export interface IssueUnassignedEvent extends BaseTimelineEvent, IssueFields {
  type: 'issue_unassigned';
}

export interface IssueClosedEvent extends BaseTimelineEvent, IssueFields {
  type: 'issue_closed';
}

export interface IssueInProgressEvent extends BaseTimelineEvent, IssueFields {
  type: 'issue_in_progress';
}

export interface IssueIterationEvent extends BaseTimelineEvent, IssueFields {
  type: 'issue_iteration';
  workflow_name?: string; // Reused for iteration title
  comment_content?: string; // Reused for project title
}

// Release events
export interface ReleasedEvent extends BaseTimelineEvent {
  type: 'released';
  release_tag?: string;
}

// Union type of all possible timeline events
export type TimelineEvent =
  | PrOpenedEvent
  | PrClosedEvent
  | PrMergedEvent
  | PrReadyForReviewEvent
  | PrDraftEvent
  | PrOpenedDraftEvent
  | CommitEvent
  | CommitsAddedEvent
  | CommitsPushedEvent
  | HeadRefForcePushedEvent
  | CommentAddedEvent
  | ReviewCommentAddedEvent
  | IssueCommentEvent
  | ReviewEvent
  | ReviewRequestedEvent
  | ReviewDismissedEvent
  | AwaitingReviewEvent
  | TeamReviewRequestedEvent
  | CiStartedEvent
  | CiRunEvent
  | CiCompletedEvent
  | IssueCreatedEvent
  | IssueAssignedEvent
  | IssueUnassignedEvent
  | IssueClosedEvent
  | IssueInProgressEvent
  | IssueIterationEvent
  | ReleasedEvent;

// Helper type that allows accessing any field (for transformers/processors)
// This is useful when you need to access optional fields without type guards
export type AnyTimelineEvent = BaseTimelineEvent &
  Partial<ReviewFields> &
  Partial<CiFields> &
  Partial<CommentFields> &
  Partial<CommitFields> &
  Partial<IssueFields> & {
    type: TimelineEvent['type'];
    requested_team?: string;
    release_tag?: string;
  };

// Type guard helpers for narrowing TimelineEvent types
export function hasWorkflowName(
  event: TimelineEvent
): event is
  | CiStartedEvent
  | CiRunEvent
  | CiCompletedEvent
  | IssueIterationEvent {
  return 'workflow_name' in event;
}

export function hasCiConclusion(
  event: TimelineEvent
): event is CiRunEvent | CiCompletedEvent {
  return 'ci_conclusion' in event;
}

export function hasCiStatus(
  event: TimelineEvent
): event is CiStartedEvent | CiRunEvent | CiCompletedEvent {
  return 'ci_status' in event;
}

export function hasReviewer(
  event: TimelineEvent
): event is
  | ReviewEvent
  | ReviewRequestedEvent
  | ReviewDismissedEvent
  | AwaitingReviewEvent {
  return 'reviewer' in event;
}

export function hasReviewerTeams(event: TimelineEvent): event is ReviewEvent {
  return 'reviewer_teams' in event;
}

export function hasState(event: TimelineEvent): event is ReviewEvent {
  return 'state' in event;
}

export function hasCommentContent(
  event: TimelineEvent
): event is
  | CommentAddedEvent
  | ReviewCommentAddedEvent
  | IssueCommentEvent
  | IssueIterationEvent {
  return 'comment_content' in event;
}

export function hasCommentAuthor(
  event: TimelineEvent
): event is CommentAddedEvent | ReviewCommentAddedEvent | IssueCommentEvent {
  return 'comment_author' in event;
}

export function hasCommitCount(
  event: TimelineEvent
): event is CommitsAddedEvent | CommitsPushedEvent {
  return 'commit_count' in event;
}

export function hasIssueNumber(
  event: TimelineEvent
): event is
  | IssueCreatedEvent
  | IssueAssignedEvent
  | IssueUnassignedEvent
  | IssueClosedEvent
  | IssueInProgressEvent
  | IssueIterationEvent {
  return 'issue_number' in event;
}

export function hasIssueTitle(
  event: TimelineEvent
): event is
  | IssueCreatedEvent
  | IssueAssignedEvent
  | IssueUnassignedEvent
  | IssueClosedEvent
  | IssueInProgressEvent
  | IssueIterationEvent {
  return 'issue_title' in event;
}

export function hasRequestedTeam(
  event: TimelineEvent
): event is TeamReviewRequestedEvent {
  return 'requested_team' in event;
}

export function hasReleaseTag(event: TimelineEvent): event is ReleasedEvent {
  return 'release_tag' in event;
}

export function hasTimeToReviewHours(
  event: TimelineEvent
): event is ReviewEvent {
  return 'time_to_review_hours' in event;
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
  end_date?: string;
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
  project_iteration?: {
    projectTitle: string;
    projectNumber?: number;
    iterationTitle: string;
    iterationId?: string;
    iterationStartDate: string;
    iterationEndDate: string;
  };
}

export interface PullRequestStats {
  id: string | number;
  title: string;
  url: string;
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  author: string;
  author_teams: string[];
  state: string;
  draft?: boolean;
  linked_issues?: LinkedIssue[];
  commits: number;
  additions: number;
  deletions: number;
  changed_files: number;
  codeowners?: { teams: string[]; individuals: string[] };
  closed_at: string | null;
  headSha: string;
  mergeCommitSha?: string | null;

  timeline: TimelineEvent[];

  // Review fields
  reviews: {
    comments: number;
    back_and_forth_count: number;
    requested_teams?: string[];
    review_comments: number;
    review_timings: ReviewTiming[];
  };

  build_stats: {
    total_builds?: number;
    completed_builds?: number;
    failed_builds?: number;
    successful_builds?: number;
    total_build_time_ms?: number;
  };

  // Calculated metrics
  metrics: {
    run_start_time?: string;
    run_end_time?: string;
    turnaround_time_hours: number;
    complexity?: number;
    delivery_friction?: number;
    total_team_review_time_ms?: number;
  };
}

export interface ReviewTiming {
  reviewer: string;
  submitted_at: string;
  time_to_review_hours: number;
  state: string;
  reviewer_teams: string[];
  author_reviewer_relationship:
    | 'same-team'
    | 'intra-team'
    | 'intra-department'
    | 'cross-department'
    | 'additional-reviewer';
  time_to_new_commits_pushed?: number;
  time_to_author_response?: number;
  url?: string;
  review_id?: number;
  body?: string; // Review comment/body
}

// Timeline data structures for dnd-timeline
export interface TimelineGroup {
  id: string;
  content: string;
  order?: number;
  collapsed?: boolean;
}

export interface TimelineItem {
  id: string;
  group: string;
  start: string;
  end?: string;
  content: string;
  emoji: string;
  title?: string;
  className?: string;
  url?: string;
  slackUrl?: string;
  color?: string;
  isPointInTime?: boolean;
  commentContent?: string;
  commentAuthor?: string;
  reviewBody?: string; // Review comment/body for review events
  eventType?: TimelineEvent['type']; // Original event type from TimelineEvent
  // Commit fields for commit events
  commits?: Array<{
    sha: string;
    message: string;
    full_message?: string;
    body?: string;
    author: string;
    date: string;
  }>;
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
  cached?: boolean;
  timestamp?: number;
}
