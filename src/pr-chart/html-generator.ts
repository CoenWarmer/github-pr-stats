import * as fs from 'fs';
import * as path from 'path';
import { VisTimelineData, PullRequestStats } from './types';
import { logger } from '../logger';
import { formatDuration, formatDurationInHours } from './utils';

export class HTMLGenerator {
  generateGanttHTML(
    data: VisTimelineData,
    pr: PullRequestStats,
    outputDir: string,
    prNumber: number
  ): void {
    // Calculate total build minutes from "Build running" items
    const buildRunningItems = data.items.filter(
      item => item.content === 'kibana-ci' && item.start && item.end
    );

    const totalBuildMinutes = buildRunningItems.reduce((total, item) => {
      if (item.start && item.end) {
        const startTime = new Date(item.start).getTime();
        const endTime = new Date(item.end).getTime();
        const durationMinutes = (endTime - startTime) / (1000 * 60);
        return total + durationMinutes;
      }
      return total;
    }, 0);

    // Calculate total time waited for approvals from "Awaiting code owner review" items
    const awaitingItems = data.items.filter(
      item =>
        item.content &&
        item.content.includes('Awaiting code owner review') &&
        item.start &&
        item.end
    );

    const totalWaitingMinutes = awaitingItems.reduce((total, item) => {
      if (item.start && item.end) {
        const startTime = new Date(item.start).getTime();
        const endTime = new Date(item.end).getTime();
        const durationMinutes = (endTime - startTime) / (1000 * 60);
        return total + durationMinutes;
      }
      return total;
    }, 0);

    // Convert to hours if over 60 minutes for better readability
    const formatTime = (minutes: number): string => {
      if (minutes > 780) {
        const days = Math.round(minutes / 1440);
        return `${days}d`;
      }
      if (minutes >= 60) {
        const hours = Math.round((minutes / 60) * 10) / 10; // Round to 1 decimal
        return `${hours}h`;
      }

      return `${Math.round(minutes)}m`;
    };

    // Calculate PR costliness metric
    const calculateCostliness = (): number => {
      // Normalize different factors to a common scale (0-100 points each)

      // 1. CI Time Cost (0-100 pts based on build minutes)
      // Average PR might have 30-60 min of CI time, 120+ is expensive
      const ciCost = Math.min(100, (totalBuildMinutes / 120) * 100);

      // 2. Waiting Time Cost (0-100 pts based on waiting time)
      // Average PR waits 24-48h for reviews, 168h+ (1 week) is expensive
      const waitingHours = totalWaitingMinutes / 60;
      const waitingCost = Math.min(100, (waitingHours / 168) * 100);

      // 3. Code Complexity Cost (0-100 pts based on lines changed)
      // Average PR changes 100-300 lines, 1500+ lines is expensive
      const linesChanged = pr.additions + pr.deletions;
      const complexityCost = Math.min(100, (linesChanged / 1500) * 100);

      // 4. Review Iteration Cost (0-100 pts based on back-and-forth)
      // Average PR has 2-5 commits and 5-15 review comments, 20+ comments is expensive
      const iterationFactor = pr.commits * 2 + pr.review_comments;
      const iterationCost = Math.min(100, (iterationFactor / 30) * 100);

      // 5. Duration Cost (0-100 pts based on turnaround time)
      // Average PR takes 24-72h, 336h+ (2 weeks) is expensive
      const durationCost = Math.min(
        100,
        (pr.turnaround_time_hours / 336) * 100
      );

      // Weighted average (weights can be adjusted based on what matters most)
      const totalCost =
        ciCost * 0.25 + // 25% - computational resources
        waitingCost * 0.3 + // 30% - human time/process delays
        complexityCost * 0.2 + // 20% - code risk/complexity
        iterationCost * 0.15 + // 15% - review overhead
        durationCost * 0.1; // 10% - opportunity cost

      return Math.round(totalCost);
    };

    const costliness = calculateCostliness();

    // Format costliness with color coding
    const formatCostliness = (
      score: number
    ): { value: string; color: string } => {
      if (score <= 30) {
        return { value: `${score}/100`, color: '#2E7D32' }; // Green - Low cost
      } else if (score <= 60) {
        return { value: `${score}/100`, color: '#F57C00' }; // Orange - Medium cost
      } else {
        return { value: `${score}/100`, color: '#C62828' }; // Red - High cost
      }
    };

    const costlinessFormatted = formatCostliness(costliness);

    const htmlContent = `<!DOCTYPE html>
<html>
<head>
    <title>PR #${prNumber} Timeline - ${pr.title}</title>
    <script type="text/javascript" src="https://unpkg.com/vis-timeline@7.7.0/standalone/umd/vis-timeline-graph2d.min.js"></script>
    <link href="https://unpkg.com/vis-timeline@7.7.0/styles/vis-timeline-graph2d.min.css" rel="stylesheet" type="text/css" />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style type="text/css">
        body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Helvetica', 'Arial', sans-serif; margin: 20px; }
        .timeline { border: 1px solid #ccc; }
        .vis-item.admin-event { background-color: #E3F2FD; border-color: #1976D2; }
        .vis-item.admin-event.draft { background-color: #FFF3E0; border-color: #F57C00; }
        .vis-item.admin-event.ready { background-color: #E8F5E8; border-color: #388E3C; }
        .vis-item.admin-event.issue-created { background-color: #E8EAF6; border-color: #3F51B5; }
        .vis-item.admin-event.issue-assigned { background-color: #E0F2F1; border-color: #00695C; }
        .vis-item.admin-event.issue-unassigned { background-color: #FFF3E0; border-color: #FF9800; }
        .vis-item.admin-event.issue-in-progress { background-color: #FFF3E0; border-color: #EF6C00; }
        .vis-item.admin-event.issue-closed { background-color: #E8F5E8; border-color: #2E7D32; }
        .vis-item.admin-event.clickable { 
            cursor: pointer; 
            transition: box-shadow 0.2s ease;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .vis-item.admin-event.clickable:hover { 
            box-shadow: 0 4px 8px rgba(0,0,0,0.15);
            transform: translateY(-1px);
        }
        .vis-item.dev-commits { background-color: #E8F5E8; border-color: #388E3C; }
        .vis-item.dev-commits.clickable { 
            cursor: pointer; 
            transition: box-shadow 0.2s ease;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .vis-item.dev-commits.clickable:hover { 
            background-color: #C8E6C9; 
            box-shadow: 0 4px 8px rgba(0,0,0,0.15);
            transform: translateY(-1px);
        }
                   .vis-item.review-approved { background-color: #C8E6C9; border-color: #2E7D32; }
                   .vis-item.review-changes_requested { background-color: #FFCDD2; border-color: #C62828; }
                   .vis-item.review-commented { background-color: #FFF3E0; border-color: #F57C00; }
                   .vis-item.review-approved.clickable {
                       cursor: pointer;
                       transition: box-shadow 0.2s ease;
                       box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                   }
                   .vis-item.review-approved.clickable:hover {
                       background-color: #A5D6A7;
                       box-shadow: 0 4px 8px rgba(0,0,0,0.15);
                       transform: translateY(-1px);
                   }
                   .vis-item.review-changes_requested.clickable {
                       cursor: pointer;
                       transition: box-shadow 0.2s ease;
                       box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                   }
                   .vis-item.review-changes_requested.clickable:hover {
                       background-color: #FFABAE;
                       box-shadow: 0 4px 8px rgba(0,0,0,0.15);
                       transform: translateY(-1px);
                   }
                   .vis-item.review-commented.clickable {
                       cursor: pointer;
                       transition: box-shadow 0.2s ease;
                       box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                   }
                   .vis-item.review-commented.clickable:hover {
                       background-color: #FFE0B2;
                       box-shadow: 0 4px 8px rgba(0,0,0,0.15);
                       transform: translateY(-1px);
                   }
        .vis-item.discussion-comment { background-color: #F3E5F5; border-color: #7B1FA2; }
        .vis-item.discussion-comment.clickable { 
            cursor: pointer; 
            transition: box-shadow 0.2s ease;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .vis-item.discussion-comment.clickable:hover { 
            background-color: #E1BEE7; 
            box-shadow: 0 4px 8px rgba(0,0,0,0.15);
            transform: translateY(-1px);
        }
        .vis-item.ci-success { background-color: #90EE90; border-color: #2E7D32; }
        .vis-item.ci-failure { background-color: #FFB6C1; border-color: #C62828; }
        .vis-item.ci-bot-comment { background-color: #E1F5FE; border-color: #0277BD; }
        .vis-item.merged { background-color: #81C784; border-color: #2E7D32; }
        .vis-item.closed { background-color: #FFAB91; border-color: #D84315; }
        .vis-item.awaiting-review { background-color: #FFF9C4; border-color: #F9A825; opacity: 0.7; }
        .vis-item.awaiting-review.pending { background-color: #FFECB3; border-color: #F57F17; }
        h1 { color: #333; }
        h1 a { color: #1976D2; text-decoration: none; }
        h1 a:hover { text-decoration: underline; }
        .pr-info { 
            background: #f5f5f5; 
            padding: 15px; 
            border-radius: 5px; 
            margin-bottom: 20px; 
            border-left: 4px solid #2196F3;
        }
        .stats {
            display: flex;
            gap: 20px;
            flex-wrap: wrap;
        }
        .stat {
            background: white;
            padding: 10px 15px;
            border-radius: 4px;
            border: 1px solid #ddd;
        }
        .stat-label {
            font-size: 12px;
            color: #666;
            display: block;
        }
        .stat-value {
            font-size: 18px;
            font-weight: bold;
            color: #333;
        }
        .stat[title] {
            cursor: help;
            border: 2px solid transparent;
            transition: border-color 0.2s ease;
        }
        .stat[title]:hover {
            border-color: #2196F3;
        }
        .issue-state {
            padding: 2px 6px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
        }
        .issue-state-open {
            background-color: #d73a49;
            color: white;
        }
        .issue-state-closed {
            background-color: #28a745;
            color: white;
        }
        .vis-item.feature-turnaround { 
            background-color: #E8F5E8; 
            border-color: #4CAF50; 
            border-width: 2px;
        }
        .vis-item.feature-turnaround.clickable {
            cursor: pointer;
            transition: box-shadow 0.2s ease;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .vis-item.feature-turnaround.clickable:hover {
            background-color: #C8E6C9;
            box-shadow: 0 4px 8px rgba(0,0,0,0.15);
            transform: translateY(-1px);
        }
        .timeline-controls {
            margin: 20px 0;
            text-align: center;
        }
        .zoom-button {
            background: #2196F3;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            margin: 0 5px;
            transition: background-color 0.2s ease;
        }
        .zoom-button:hover {
            background: #1976D2;
        }
        .zoom-button:active {
            background: #1565C0;
        }
    </style>
</head>
<body>
    <h1><a href="${pr.url}" target="_blank">PR #${prNumber}: ${pr.title}</a></h1>
    
    <div class="pr-info">
        <div style="margin-bottom: 10px;">
            <strong>Author:</strong> ${pr.author} | 
            <strong>Created:</strong> ${new Date(pr.created_at).toLocaleDateString()} | 
            <strong>Status:</strong> ${pr.state}${pr.merged_at ? ' (merged)' : ''}
        </div>
        
        ${
          pr.linked_issues && pr.linked_issues.length > 0
            ? `
        <div style="margin-bottom: 10px; padding: 8px; background: #f8f9fa; border-left: 4px solid #0366d6; border-radius: 4px;">
            <strong>🔗 Linked Issues (${pr.linked_issues.length}):</strong>
            <div style="margin-top: 5px;">
                ${pr.linked_issues
                  .map(
                    issue => `
                    <div style="margin: 3px 0;">
                        <a href="${issue.url}" target="_blank" style="color: #0366d6; text-decoration: none; font-weight: 500;">
                            #${issue.number}
                        </a>
                        <span style="color: #586069; margin: 0 5px;">•</span>
                        <span style="color: #24292e;">${issue.title}</span>
                        <span style="margin-left: 5px;">
                            <span class="issue-state issue-state-${issue.state.toLowerCase()}" title="${issue.state}">${issue.state}</span>
                            ${
                              issue.labels.length > 0
                                ? issue.labels
                                    .map(
                                      label =>
                                        `<span class="issue-label" style="background: #f1f8ff; color: #0366d6; padding: 1px 4px; border-radius: 3px; font-size: 11px; margin-left: 3px;">${label}</span>`
                                    )
                                    .join('')
                                : ''
                            }
                        </span>
                    </div>
                `
                  )
                  .join('')}
            </div>
        </div>
        `
            : ''
        }
        
        <div class="stats">
            <div class="stat">
                <span class="stat-label">PR Duration</span>
                <span class="stat-value">${formatDurationInHours(Math.round(pr.turnaround_time_hours))}h</span>
            </div>
            <div class="stat" title="Composite metric combining CI time (25%), waiting time (30%), code complexity (20%), review iterations (15%), and duration (10%). Measures delivery friction from technical, organizational, and process obstacles. Score: 0-30=Low, 31-60=Medium, 61+=High friction">
                <span class="stat-label">PR Delivery Friction</span>
                <span class="stat-value" style="color: ${costlinessFormatted.color}; font-weight: bold;">${costlinessFormatted.value}</span>
            </div>
            <div class="stat">
                <span class="stat-label">Commits</span>
                <span class="stat-value">${pr.commits}</span>
            </div>
            <div class="stat">
                <span class="stat-label">Comments</span>
                <span class="stat-value">${pr.comments}</span>
            </div>
            <div class="stat">
                <span class="stat-label">Review Comments</span>
                <span class="stat-value">${pr.review_comments}</span>
            </div>
            <div class="stat">
                <span class="stat-label">Files Changed</span>
                <span class="stat-value">${pr.changed_files}</span>
            </div>
            <div class="stat">
                <span class="stat-label">Additions</span>
                <span class="stat-value">+${pr.additions}</span>
            </div>
            <div class="stat">
                <span class="stat-label">Deletions</span>
                <span class="stat-value">-${pr.deletions}</span>
            </div>
            <div class="stat">
                <span class="stat-label">Total Build Minutes</span>
                <span class="stat-value">${formatTime(totalBuildMinutes)}</span>
            </div>
            <div class="stat">
                <span class="stat-label">Total time waited for approvals</span>
                <span class="stat-value">${formatTime(totalWaitingMinutes)}</span>
            </div>
        </div>
    </div>

    <div class="timeline-controls">
        <button class="zoom-button" onclick="zoomToPRProcess()">🔍 Zoom to PR Process</button>
        <button class="zoom-button" onclick="fitAllItems()">🗓️ Fit All</button>
    </div>

    <div id="timeline"></div>

    <script type="text/javascript">
        // Timeline data
        const groups = new vis.DataSet(${JSON.stringify(data.groups)});
        const items = new vis.DataSet(${JSON.stringify(data.items)});

        // Configuration options
        const options = {
            editable: false,
            margin: { item: 10, axis: 5 },
            orientation: 'top',
            showCurrentTime: false,
            zoomable: true,
            moveable: true,
            height: '500px',
            stack: false,
            format: {
                minorLabels: {
                    hour: 'HH:mm',
                    day: 'D MMM'
                },
                majorLabels: {
                    hour: 'ddd D MMMM',
                    day: 'MMMM YYYY'
                }
            }
        };

        // Create timeline
        const container = document.getElementById('timeline');
        const timeline = new vis.Timeline(container, items, groups, options);

        // Fit timeline to show all items with some padding
        timeline.fit();
        
        // Zoom control functions
        function zoomToPRProcess() {
            const prStart = new Date('${pr.created_at}');
            const prEnd = new Date('${pr.closed_at || pr.merged_at || new Date().toISOString()}');
            
            // Add some padding (5% of the PR duration on each side)
            const duration = prEnd.getTime() - prStart.getTime();
            const padding = duration * 0.05;
            
            const zoomStart = new Date(prStart.getTime() - padding);
            const zoomEnd = new Date(prEnd.getTime() + padding);
            
            timeline.setWindow(zoomStart, zoomEnd, {
                animation: {
                    duration: 500,
                    easingFunction: 'easeInOutCubic'
                }
            });
        }
        
        function fitAllItems() {
            timeline.fit({
                animation: {
                    duration: 500,
                    easingFunction: 'easeInOutCubic'
                }
            });
        }
        
        // Make functions globally accessible
        window.zoomToPRProcess = zoomToPRProcess;
        window.fitAllItems = fitAllItems;
        
        // Add click handler for items
        timeline.on('select', function (selection) {
            if (selection.items.length > 0) {
                const item = items.get(selection.items[0]);
                
                // Handle GitHub links for commits
                if (item && item.githubUrl) {
                    window.open(item.githubUrl, '_blank');
                }
                
                // Log selected item for debugging
                if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'development') {
                  console.log('Selected item:', item);
                }
            }
        });
    </script>
</body>
</html>`;

    const htmlPath = path.join(outputDir, `pr-${prNumber}-gantt.html`);
    fs.writeFileSync(htmlPath, htmlContent);
    logger.debug(`Gantt chart HTML saved to: ${htmlPath}`);
  }
}
