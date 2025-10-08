// Time conversion utilities
type TimeUnit = 'ms' | 'seconds' | 'minutes' | 'hours' | 'days';

/**
 * Helper utility to format duration between two dates
 * @param startTime Start time as Date or ISO string
 * @param endTime End time as Date or ISO string
 * @returns Formatted duration string (e.g., "4.5h" or "2.3d")
 */
export function formatDurationBetweenDates(
  startTime: Date | string,
  endTime: Date | string
): string {
  const start = typeof startTime === 'string' ? new Date(startTime) : startTime;
  const end = typeof endTime === 'string' ? new Date(endTime) : endTime;

  const durationMs = end.getTime() - start.getTime();
  return formatDurationMs(durationMs, 1); // Use 1 decimal place for consistency
}

/**
 * Calculate PR complexity score based on multiple dimensions
 *
 * Formula:
 * PR_Complexity =
 *   0.3 * log(1 + LOC_added + LOC_deleted) +
 *   0.25 * log(1 + num_files_changed) +
 *   0.25 * (num_code_owners_involved / num_files_changed) +
 *   0.2 * log(1 + num_review_comments)
 *
 * @param pr PullRequestStats object
 * @returns Complexity score (typically 0-10 range)
 */
export function calculatePRComplexity(pr: {
  additions: number;
  deletions: number;
  changed_files: number;
  reviews: {
    review_comments: number;
    requested_teams?: string[];
  };
  codeowners?: { teams: string[]; individuals: string[] };
}): number {
  // Lines of code changed (additions + deletions)
  const locChanged = pr.additions + pr.deletions;

  // Number of files changed
  const filesChanged = pr.changed_files;

  // Number of code owners involved (teams + individuals)
  const codeOwnersTeams = pr.codeowners?.teams?.length || 0;
  const codeOwnersIndividuals = pr.codeowners?.individuals?.length || 0;
  const requestedTeams = pr.reviews.requested_teams?.length || 0;
  const numCodeOwners = Math.max(
    codeOwnersTeams + codeOwnersIndividuals,
    requestedTeams
  );

  // Number of review comments
  const reviewComments = pr.reviews.review_comments;

  // Calculate weighted components using natural logarithm
  const locComponent = 0.3 * Math.log(1 + locChanged);
  const filesComponent = 0.25 * Math.log(1 + filesChanged);
  const ownersComponent =
    filesChanged > 0 ? 0.25 * (numCodeOwners / filesChanged) : 0;
  const commentsComponent = 0.2 * Math.log(1 + reviewComments);

  // Sum all components
  const complexity =
    locComponent + filesComponent + ownersComponent + commentsComponent;

  return complexity;
}

/**
 * Format PR complexity score with descriptive label
 * @param complexity Complexity score
 * @returns Object with formatted value, label, and color
 */
export function formatPRComplexity(complexity: number): {
  value: string;
  label: string;
  color: string;
} {
  const rounded = complexity.toFixed(2);

  if (complexity <= 2) {
    return {
      value: rounded,
      label: 'Trivial',
      color: '#2E7D32', // Green
    };
  } else if (complexity <= 4) {
    return {
      value: rounded,
      label: 'Simple',
      color: '#689F38', // Light Green
    };
  } else if (complexity <= 6) {
    return {
      value: rounded,
      label: 'Moderate',
      color: '#F57C00', // Orange
    };
  } else if (complexity <= 8) {
    return {
      value: rounded,
      label: 'Complex',
      color: '#E64A19', // Deep Orange
    };
  } else {
    return {
      value: rounded,
      label: 'Very Complex',
      color: '#C62828', // Red
    };
  }
}

/**
 * Calculate delivery friction score
 * @param pr PullRequestStats object
 * @param totalBuildMinutes Total CI build minutes
 * @param totalWaitingMinutes Total waiting minutes
 * @returns Friction score (0-100)
 */
export function calculateDeliveryFriction(
  pr: {
    additions: number;
    deletions: number;
    commits: number;
    reviews: {
      review_comments: number;
    };
    metrics: { turnaround_time_hours: number };
  },
  totalBuildMinutes: number,
  totalWaitingMinutes: number
): number {
  // 1. CI Time Cost (0-100 pts based on build minutes)
  const ciCost = Math.min(100, (totalBuildMinutes / 120) * 100);

  // 2. Waiting Time Cost (0-100 pts based on waiting time)
  const waitingHours = totalWaitingMinutes / 60;
  const waitingCost = Math.min(100, (waitingHours / 168) * 100);

  // 3. Code Complexity Cost (0-100 pts based on lines changed)
  const linesChanged = pr.additions + pr.deletions;
  const complexityCost = Math.min(100, (linesChanged / 1500) * 100);

  // 4. Review Iteration Cost (0-100 pts based on back-and-forth)
  const iterationFactor = pr.commits * 2 + pr.reviews.review_comments;
  const iterationCost = Math.min(100, (iterationFactor / 30) * 100);

  // 5. Duration Cost (0-100 pts based on turnaround time)
  const durationCost = Math.min(
    100,
    (pr.metrics.turnaround_time_hours / 336) * 100
  );

  // Weighted average
  const totalCost =
    ciCost * 0.25 + // 25% - computational resources
    waitingCost * 0.3 + // 30% - human time/process delays
    complexityCost * 0.2 + // 20% - code risk/complexity
    iterationCost * 0.15 + // 15% - review overhead
    durationCost * 0.1; // 10% - opportunity cost

  return Math.round(totalCost);
}

/**
 * Format delivery friction score with color coding
 * @param score Friction score (0-100)
 * @returns Object with formatted value and color
 */
export function formatDeliveryFriction(score: number): {
  value: string;
  color: string;
} {
  if (score <= 30) {
    return { value: `${score}/100`, color: '#2E7D32' }; // Green - Low cost
  } else if (score <= 60) {
    return { value: `${score}/100`, color: '#F57C00' }; // Orange - Medium cost
  } else {
    return { value: `${score}/100`, color: '#C62828' }; // Red - High cost
  }
}

/**
 * Utility to safely handle GitHub URLs
 * @param url URL to open
 */
export function openGitHubUrl(url: string): void {
  if (typeof window !== 'undefined') {
    window.open(url, '_blank');
  }
}

/**
 * Converts time from one unit to another
 * @param value - The time value to convert
 * @param fromUnit - The unit to convert from
 * @param toUnit - The unit to convert to
 * @returns The converted time value
 */
export function convertTime(
  value: number,
  fromUnit: TimeUnit,
  toUnit: TimeUnit
): number {
  // Convert to milliseconds first
  let milliseconds: number;

  switch (fromUnit) {
    case 'ms':
      milliseconds = value;
      break;
    case 'seconds':
      milliseconds = value * 1000;
      break;
    case 'minutes':
      milliseconds = value * 1000 * 60;
      break;
    case 'hours':
      milliseconds = value * 1000 * 60 * 60;
      break;
    case 'days':
      milliseconds = value * 1000 * 60 * 60 * 24;
      break;
    default:
      throw new Error(`Unknown time unit: ${fromUnit}`);
  }

  // Convert from milliseconds to target unit
  switch (toUnit) {
    case 'ms':
      return milliseconds;
    case 'seconds':
      return milliseconds / 1000;
    case 'minutes':
      return milliseconds / (1000 * 60);
    case 'hours':
      return milliseconds / (1000 * 60 * 60);
    case 'days':
      return milliseconds / (1000 * 60 * 60 * 24);
    default:
      throw new Error(`Unknown time unit: ${toUnit}`);
  }
}

/**
 * Formats a duration in milliseconds to a human-readable string
 * @param durationMs - Duration in milliseconds
 * @param precision - Number of decimal places (default: 0)
 * @returns Formatted duration string with appropriate unit
 */
export function formatDurationMs(
  durationMs: number,
  precision: number = 0
): string {
  if (durationMs === 0) {
    return 'Point in time (no duration)';
  }

  const seconds = durationMs / 1000;
  const minutes = seconds / 60;
  const hours = minutes / 60;
  const days = hours / 24;

  if (days >= 1) {
    return `${days.toFixed(precision)} day${days >= 2 ? 's' : ''}`;
  } else if (hours >= 1) {
    const wholeHours = Math.floor(hours);
    const remainingMinutes = Math.round((hours - wholeHours) * 60);
    if (remainingMinutes > 0) {
      return `${wholeHours}h ${remainingMinutes}m`;
    }
    return `${wholeHours}h`;
  } else if (minutes >= 1) {
    return `${Math.round(minutes)} minute${Math.round(minutes) !== 1 ? 's' : ''}`;
  } else {
    return `${Math.round(seconds)} second${Math.round(seconds) !== 1 ? 's' : ''}`;
  }
}

/**
 * Unified duration formatter that handles different input types
 * @param input - Can be milliseconds (number), minutes (with 'minutes' unit), or hours (with 'hours' unit)
 * @param unit - Optional unit specification ('ms', 'minutes', 'hours')
 * @param precision - Number of decimal places (default: 0)
 * @returns Formatted duration string
 */
export function formatDuration(
  input: number,
  unit: 'ms' | 'minutes' | 'hours' = 'ms',
  precision: number = 0
): string {
  let durationMs: number;

  switch (unit) {
    case 'minutes':
      durationMs = input * 60 * 1000;
      break;
    case 'hours':
      durationMs = input * 60 * 60 * 1000;
      break;
    case 'ms':
    default:
      durationMs = input;
      break;
  }

  return formatDurationMs(durationMs, precision);
}

/**
 * Converts a duration to the most appropriate time breakdown
 * @param durationMs - Duration in milliseconds
 * @returns Object with breakdown of time units
 */
export function getTimeBreakdown(durationMs: number): {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  milliseconds: number;
} {
  const days = Math.floor(durationMs / (1000 * 60 * 60 * 24));
  const hours = Math.floor(
    (durationMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)
  );
  const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((durationMs % (1000 * 60)) / 1000);
  const milliseconds = Math.floor(durationMs % 1000);

  return { days, hours, minutes, seconds, milliseconds };
}
