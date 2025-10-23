import type {
  PREvent,
  ReviewEvent,
  ReviewCommentEvent,
  ReleaseEvent,
} from '../types';
import { getUserTeams, getCodeownersForPR } from './helpers';
import { tracing } from '../otel';
import { fetchBuildsForPR } from '../buildkite/api';
import { processBuildkiteBuild } from '../buildkite/handlers';

export async function handleGithubPREvent(event: PREvent): Promise<void> {
  const { action, number, pull_request, repository } = event;
  const [owner, repo] = repository.full_name.split('/');

  const authorTeams = await getUserTeams(owner, pull_request.user.login);
  const codeownersData = await getCodeownersForPR(owner, repo, number);

  const prAttributes: Record<string, string | number | boolean> = {
    'event.type': 'github.pull_request',
    'event.source': 'github',
    'github.action': action,
    'github.pr.number': number,
    'github.pr.id': pull_request.id,
    'github.pr.title': pull_request.title,
    'github.pr.state': pull_request.state,
    'github.pr.url': pull_request.html_url,
    'github.pr.author': pull_request.user.login,
    'github.repository': repository.full_name,
    'github.pr.base_branch': pull_request.base.ref,
    'github.pr.head_branch': pull_request.head.ref,
    'github.pr.created_at': pull_request.created_at,
    'github.pr.updated_at': pull_request.updated_at,
  };

  if (authorTeams.length > 0) {
    prAttributes['github.pr.author_teams'] = authorTeams.join(',');
  }

  if (codeownersData.allOwners && codeownersData.allOwners.length > 0) {
    prAttributes['github.pr.codeowners_all'] =
      codeownersData.allOwners.join(',');
  }

  if (pull_request.merged_at) {
    prAttributes['github.pr.merged_at'] = pull_request.merged_at;
  }

  if (pull_request.closed_at) {
    prAttributes['github.pr.closed_at'] = pull_request.closed_at;
  }

  if (pull_request.draft !== undefined) {
    prAttributes['github.pr.draft'] = pull_request.draft;
  }

  // Add direct link for easy navigation from APM
  prAttributes['url'] = pull_request.html_url;
  prAttributes['http.url'] = pull_request.html_url;

  // For 'opened' action, start a new trace (root span)
  let rootSpan;
  if (action === 'opened') {
    const prCreatedAt = new Date(pull_request.created_at);
    const { span } = tracing.startTrace(
      `PR #${number}: ${pull_request.title}`,
      prAttributes,
      prCreatedAt
    );
    rootSpan = span;
  }
  // For 'closed' or other terminal actions, emit as event
  else if (action === 'closed' || action === 'reopened') {
    tracing.emitEvent(
      `PR #${number} ${action}`,
      prAttributes,
      new Date(pull_request.updated_at)
    );
  } else {
    // Other actions (synchronized, edited, etc.) are events
    tracing.emitEvent(`PR #${number} ${action}`, prAttributes, new Date());
  }

  // Create child spans for file changes
  if (codeownersData.fileDetails) {
    let totalAdditions = 0;
    let totalDeletions = 0;
    let totalChanges = 0;

    for (const fileDetail of codeownersData.fileDetails) {
      totalAdditions += fileDetail.additions;
      totalDeletions += fileDetail.deletions;
      totalChanges += fileDetail.changes;

      const fileAttributes: Record<string, string | number | boolean> = {
        'event.type': 'github.pull_request.file',
        'event.source': 'github',
        'github.pr.number': number,
        'github.repository': repository.full_name,
        'github.file.path': fileDetail.filename,
        'github.file.status': fileDetail.status,
        'github.file.additions': fileDetail.additions,
        'github.file.deletions': fileDetail.deletions,
        'github.file.changes': fileDetail.changes,
      };

      if (fileDetail.owners && fileDetail.owners.length > 0) {
        fileAttributes['github.file.codeowners'] = fileDetail.owners.join(',');
      }

      // Emit file change as event span
      tracing.emitEvent(
        `PR #${number} file ${action}: ${fileDetail.filename}`,
        fileAttributes,
        new Date(pull_request.updated_at)
      );
    }

    // Add aggregate stats to PR attributes
    prAttributes['github.pr.total_additions'] = totalAdditions;
    prAttributes['github.pr.total_deletions'] = totalDeletions;
    prAttributes['github.pr.total_changes'] = totalChanges;
    prAttributes['github.pr.file_count'] = codeownersData.fileDetails.length;
  }

  // Create child spans for codeowner team reviews
  // Each team that owns files in this PR needs to review and approve
  if (
    rootSpan &&
    codeownersData.allOwners &&
    codeownersData.allOwners.length > 0
  ) {
    const prCreatedAt = new Date(pull_request.created_at);
    const uniqueTeams = new Set(codeownersData.allOwners);

    for (const teamName of uniqueTeams) {
      const teamReviewAttributes: Record<string, string | number | boolean> = {
        'event.type': 'github.codeowner_review',
        'event.source': 'github',
        'github.pr.number': number,
        'github.repository': repository.full_name,
        'github.codeowner.team': teamName,
        'review.status': 'pending',
        // Add PR URL for easy navigation
        url: pull_request.html_url,
        'http.url': pull_request.html_url,
      };

      // Create a span for this team's review (starts when PR is opened)
      // Use deterministic span type for idempotent backfills
      const teamSpan = tracing.createSpan(
        `Review by ${teamName}`,
        teamReviewAttributes,
        rootSpan,
        prCreatedAt,
        `team:${teamName}` // Deterministic span type
      );

      // Store the span so we can end it when the team approves
      tracing.storeTeamReviewSpan(
        number,
        repository.full_name,
        teamName,
        teamSpan
      );

      console.log(
        `📋 Started review tracking for ${teamName} on PR #${number}`
      );
    }
  }

  // Fetch and link Buildkite builds for this PR
  if (rootSpan && action === 'opened') {
    try {
      const builds = await fetchBuildsForPR(
        repository.full_name,
        pull_request.head.ref, // PR branch
        number,
        pull_request.head.sha // Commit SHA (most reliable for Buildkite lookup)
      );

      console.log(
        `[Buildkite] Found ${builds.length} builds for PR #${number} (commit: ${pull_request.head.sha.substring(0, 8)})`
      );

      for (const build of builds) {
        await processBuildkiteBuild(
          build,
          rootSpan,
          repository.full_name,
          number
        );
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.warn(
        `[Buildkite] Error fetching builds for PR #${number}:`,
        message
      );
    }
  }

  // End the root span so it gets exported to Elasticsearch
  // Use the PR's last update time as the end time
  if (rootSpan) {
    // Small delay to ensure child spans are flushed
    await new Promise(resolve => setTimeout(resolve, 100));

    const endTime = pull_request.merged_at
      ? new Date(pull_request.merged_at)
      : pull_request.closed_at
        ? new Date(pull_request.closed_at)
        : new Date(pull_request.updated_at);

    tracing.endTrace(rootSpan, 'OK', endTime);
  }
}

export async function handleGithubReviewEvent(
  event: ReviewEvent
): Promise<void> {
  const { action, review, pull_request, repository } = event;
  const [owner] = repository.full_name.split('/');

  if (!review.user) {
    console.warn(`[GitHub] Review without user, skipping`);
    return;
  }

  const reviewerTeams = await getUserTeams(owner, review.user.login);

  // Construct review URL
  const reviewUrl = `${pull_request.html_url}#pullrequestreview-${review.id}`;

  const reviewAttributes: Record<string, string | number | boolean> = {
    'event.type': 'github.pull_request_review',
    'event.source': 'github',
    'github.action': action,
    'github.pr.number': pull_request.number,
    'github.repository': repository.full_name,
    'github.review.id': review.id,
    'github.review.state': review.state,
    'github.review.user': review.user.login,
    // Add review URL for easy navigation
    url: reviewUrl,
    'http.url': reviewUrl,
  };

  if (review.submitted_at) {
    reviewAttributes['github.review.submitted_at'] = review.submitted_at;
  }

  if (reviewerTeams.length > 0) {
    reviewAttributes['github.review.reviewer_teams'] = reviewerTeams.join(',');
  }

  if (review.body) {
    reviewAttributes['github.review.body'] = review.body;
  }

  // Emit review as event span (child of PR trace)
  const timestamp = review.submitted_at
    ? new Date(review.submitted_at)
    : new Date();
  tracing.emitEvent(
    `PR #${pull_request.number} review ${action}: ${review.state}`,
    reviewAttributes,
    timestamp
  );

  // If this is an approval, end the team review span(s) for the reviewer's team(s)
  if (review.state === 'APPROVED' && reviewerTeams.length > 0) {
    for (const teamName of reviewerTeams) {
      // Check if this team has an active review span for this PR
      const teamSpan = tracing.getTeamReviewSpan(
        pull_request.number,
        repository.full_name,
        teamName
      );

      if (teamSpan) {
        // End the team review span at the approval timestamp
        tracing.endTeamReviewSpan(
          pull_request.number,
          repository.full_name,
          teamName,
          timestamp
        );
      }
    }
  }
}

export async function handleGithubReviewCommentEvent(
  event: ReviewCommentEvent
): Promise<void> {
  const { action, comment, pull_request, repository } = event;
  const [owner] = repository.full_name.split('/');

  const commenterTeams = await getUserTeams(owner, comment.user.login);

  const commentAttributes: Record<string, string | number | boolean> = {
    'event.type': 'github.pull_request_review_comment',
    'event.source': 'github',
    'github.action': action,
    'github.pr.number': pull_request.number,
    'github.repository': repository.full_name,
    'github.comment.id': comment.id,
    'github.comment.user': comment.user.login,
    'github.comment.path': comment.path,
    'github.comment.created_at': comment.created_at,
  };

  if (commenterTeams.length > 0) {
    commentAttributes['github.comment.commenter_teams'] =
      commenterTeams.join(',');
  }

  if (comment.body) {
    commentAttributes['github.comment.body'] = comment.body;
  }

  // Emit comment as event span
  tracing.emitEvent(
    `PR #${pull_request.number} comment ${action}`,
    commentAttributes,
    new Date(comment.created_at)
  );
}

export async function handleGithubReleaseEvent(
  event: ReleaseEvent
): Promise<void> {
  const { action, release, repository } = event;

  const releaseAttributes: Record<string, string | number | boolean> = {
    'event.type': 'github.release',
    'event.source': 'github',
    'github.action': action,
    'github.repository': repository.full_name,
    'github.release.id': release.id,
    'github.release.tag_name': release.tag_name,
    'github.release.name': release.name || release.tag_name,
    'github.release.prerelease': release.prerelease,
    'github.release.draft': release.draft,
    'github.release.created_at': release.created_at,
  };

  if (release.published_at) {
    releaseAttributes['github.release.published_at'] = release.published_at;
  }

  // Create a trace for the release (releases are independent transactions)
  const releaseDate = new Date(release.published_at || release.created_at);
  const { span } = tracing.startTrace(
    `Release ${release.tag_name}: ${release.name || release.tag_name}`,
    releaseAttributes,
    releaseDate
  );

  // End the trace immediately (releases are point-in-time events)
  tracing.endTrace(span, 'OK');
}
