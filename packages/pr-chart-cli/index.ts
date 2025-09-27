#!/usr/bin/env node

import * as dotenv from 'dotenv';
import { CLI } from './src/cli';
import { PRGanttGenerator } from './src/gantt-generator';
import { logger } from '../shared/logger';

// Load environment variables from repo root
dotenv.config({ path: '../../.env' });

async function main() {
  try {
    const options = CLI.parseArgs();

    // Set log level to debug if debug flag is provided
    if (options.debug) {
      logger.level = 'debug';
      logger.debug('Debug logging enabled via CLI flag');
    }

    const generator = new PRGanttGenerator();
    await generator.run(options);
  } catch (error) {
    logger.error('Fatal error', {
      error: error instanceof Error ? error.message : error,
    });
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { PRGanttGenerator };
