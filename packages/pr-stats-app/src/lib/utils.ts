/**
 * Helper utility to format duration for display
 * @param startTime Start time as Date or ISO string
 * @param endTime End time as Date or ISO string
 * @returns Formatted duration string (e.g., "4.5h" or "2.3d")
 */
export function formatDuration(
  startTime: Date | string,
  endTime: Date | string
): string {
  const start = typeof startTime === 'string' ? new Date(startTime) : startTime;
  const end = typeof endTime === 'string' ? new Date(endTime) : endTime;

  const durationMs = end.getTime() - start.getTime();
  const durationHours = durationMs / (1000 * 60 * 60);

  if (durationHours < 12) {
    // Show in hours with 1 decimal place if under 12 hours
    return `${durationHours.toFixed(1)}h`;
  } else {
    // Show in days with 1 decimal place if over 12 hours
    const durationDays = durationHours / 24;
    return `${durationDays.toFixed(1)}d`;
  }
}

/**
 * Helper utility to format duration for display in hours
 * @returns Formatted duration string (e.g., "4.5h" or "2.3d")
 */
export function formatDurationInHours(hours: number): string {
  if (hours < 12) {
    // Show in hours with 1 decimal place if under 12 hours
    return `${hours.toFixed(1)}h`;
  } else {
    // Show in days with 1 decimal place if over 12 hours
    const durationDays = hours / 24;
    return `${durationDays.toFixed(1)}d`;
  }
}

/**
 * Format time in minutes to a more readable format
 * @param minutes Time in minutes
 * @returns Formatted time string (e.g., "4.5h", "2.3d")
 */
export function formatTime(minutes: number): string {
  if (minutes > 780) {
    // More than 13 hours (780 minutes)
    const days = Math.round(minutes / 1440); // 1440 minutes in a day
    return `${days}d`;
  }
  if (minutes >= 60) {
    const hours = Math.round((minutes / 60) * 10) / 10; // Round to 1 decimal
    return `${hours}h`;
  }
  return `${Math.round(minutes)}m`;
}

/**
 * Calculate delivery friction score
 * @param pr PullRequestStats object
 * @param totalBuildMinutes Total CI build minutes
 * @param totalWaitingMinutes Total waiting minutes
 * @returns Friction score (0-100)
 */
export function calculateDeliveryFriction(
  pr: any,
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
  const iterationFactor = pr.commits * 2 + pr.review_comments;
  const iterationCost = Math.min(100, (iterationFactor / 30) * 100);

  // 5. Duration Cost (0-100 pts based on turnaround time)
  const durationCost = Math.min(100, (pr.turnaround_time_hours / 336) * 100);

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

