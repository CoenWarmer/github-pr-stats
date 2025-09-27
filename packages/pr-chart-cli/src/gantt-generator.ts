import * as fs from 'fs';
import * as path from 'path';
import { PRDataFetcher } from './pr-data-fetcher';
import { PRTimelineToVisJS } from './timeline-transformer';
import { HTMLGenerator } from './html-generator';
import { FileUtils, BrowserUtils } from '../utils';
import { CLIOptions } from '../types';
import { logger } from '../../shared/logger';

export class PRGanttGenerator {
  private dataFetcher: PRDataFetcher;
  private transformer: PRTimelineToVisJS;
  private htmlGenerator: HTMLGenerator;

  constructor() {
    const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
    const SLACK_TOKEN = process.env.SLACK_TOKEN || '';

    if (!GITHUB_TOKEN) {
      throw new Error('GITHUB_TOKEN environment variable is required');
    }

    this.dataFetcher = new PRDataFetcher(GITHUB_TOKEN, SLACK_TOKEN);
    this.transformer = new PRTimelineToVisJS();
    this.htmlGenerator = new HTMLGenerator();
  }

  async generateGanttFile(
    prNumber: number,
    options: CLIOptions
  ): Promise<{ filePath: string }> {
    logger.info(`🚀 Generating visualization for PR #${prNumber}`);

    const OWNER = process.env.GITHUB_OWNER || 'elastic';
    const REPO = process.env.GITHUB_REPO || 'kibana';

    const prData = await this.dataFetcher.getPRFromGitHub(
      OWNER,
      REPO,
      prNumber
    );
    if (!prData) {
      throw new Error(
        `PR #${prNumber} not found or could not be fetched from GitHub`
      );
    }

    logger.info(`Timeline events collected: ${prData.timeline.length}`);

    const eventCounts = prData.timeline.reduce(
      (counts, event) => {
        counts[event.type] = (counts[event.type] || 0) + 1;
        return counts;
      },
      {} as Record<string, number>
    );

    logger.debug(`Event breakdown: ${JSON.stringify(eventCounts)}`);

    const data = this.transformer.transformPRsToTimeline([prData], OWNER, REPO);
    const filename = `pr-${prNumber}-gantt.json`;

    const outputDir = options.output || path.join('data', 'pr-timeline');
    const filePath = path.join(outputDir, filename);

    FileUtils.ensureDirectoryExists(outputDir);

    // Save JSON data
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

    // Generate HTML file
    this.htmlGenerator.generateGanttHTML(data, prData, outputDir, prNumber);

    return { filePath };
  }

  async run(options: CLIOptions): Promise<void> {
    try {
      const { filePath } = await this.generateGanttFile(
        options.prNumber,
        options
      );

      logger.info('✅ PR visualization generated successfully');

      const htmlFile = filePath.replace('.json', '.html');

      if (options.open) {
        await BrowserUtils.openInBrowser(htmlFile);
      } else {
        logger.info(
          `To view the chart, open file: ${htmlFile} or use --open flag to open automatically`
        );
      }
    } catch (error) {
      logger.error(`Error generating chart visualization: ${error}`);
      process.exit(1);
    }
  }
}
