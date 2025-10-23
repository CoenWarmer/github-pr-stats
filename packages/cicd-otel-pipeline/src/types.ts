import type { components } from '@octokit/openapi-types';

// GitHub API types
export type PullRequest = components['schemas']['pull-request'];
export type Review = components['schemas']['pull-request-review'];
export type ReviewComment =
  components['schemas']['pull-request-review-comment'];
export type Release = components['schemas']['release'];

// CODEOWNERS types
export interface CodeownersRule {
  pattern: string;
  owners: string[];
}

export interface FileDetail {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
  owners: string[];
}

export interface CodeownersData {
  fileDetails?: FileDetail[];
  allOwners?: string[];
}

// OpenTelemetry Log types
export interface LogRecord {
  timestamp: number;
  severityNumber: number;
  severityText: string;
  body: string;
  attributes: Record<string, string | number | boolean>;
}

// GitHub Event types
export interface PREvent {
  action: string;
  number: number;
  pull_request: PullRequest;
  repository: {
    full_name: string;
  };
}

export interface ReviewEvent {
  action: string;
  review: Review;
  pull_request: PullRequest;
  repository: {
    full_name: string;
  };
}

export interface ReviewCommentEvent {
  action: string;
  comment: ReviewComment;
  pull_request: PullRequest;
  repository: {
    full_name: string;
  };
}

export interface ReleaseEvent {
  action: string;
  release: Release;
  repository: {
    full_name: string;
  };
}

// Buildkite Event types
export interface BuildkiteBuildEvent {
  event: string;
  build: {
    id: string;
    number: number;
    state: string;
    message: string;
    branch: string;
    commit: string;
    url: string;
    web_url: string;
    started_at?: string;
    finished_at?: string;
    created_at: string;
    pipeline: {
      name: string;
      slug: string;
      repository: string;
    };
    creator: {
      name: string;
      email: string;
    };
    jobs?: Array<{
      id: string;
      name: string;
      state: string;
      started_at?: string;
      finished_at?: string;
      exit_status?: number;
    }>;
    pull_request?: {
      id: string;
      number: number;
      repository: string;
    };
  };
}

// Buildkite API types (for backfill)
export interface BuildkiteApiBuild {
  id: string;
  number: number;
  state: string;
  message: string;
  branch: string;
  commit: string;
  url: string;
  web_url: string;
  started_at?: string;
  finished_at?: string;
  created_at: string;
  pipeline: {
    name: string;
    slug: string;
    repository: string;
  };
  creator: {
    name: string;
    email: string;
  };
  jobs?: Array<{
    id: string;
    name: string;
    state: string;
    started_at?: string;
    finished_at?: string;
    exit_status?: number;
  }>;
  pull_request?: {
    id: string;
    repository: string;
  };
}
