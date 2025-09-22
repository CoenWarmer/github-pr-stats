import { CLIOptions } from './types';
import { logger } from '../logger';

export class CLI {
  static parseArgs(): CLIOptions {
    const args = process.argv.slice(2);

    if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
      CLI.showHelp();
      process.exit(0);
    }

    const prNumber = parseInt(args[0]);
    if (isNaN(prNumber)) {
      logger.error('PR number must be a valid integer', { input: args[0] });
      process.exit(1);
    }

    const options: CLIOptions = { prNumber };

    for (let i = 1; i < args.length; i++) {
      const arg = args[i];

      switch (arg) {
        case '--output':
        case '-o':
          options.output = args[++i];
          break;
        case '--open':
          options.open = true;
          break;
        case '--debug':
        case '-d':
          options.debug = true;
          break;
        default:
          logger.error('Unknown CLI option', { option: arg });
          process.exit(1);
      }
    }

    return options;
  }

  private static showHelp(): void {
    console.log(`
Usage: npm run gantt <pr-number> [options]

Options:
  --output, -o <path>    Output directory (default: data/pr-timeline)
  --open                 Open visualization in browser after generation  
  --debug, -d            Enable debug logging for verbose output
  --help, -h            Show this help message

Examples:
  npm run pr-timeline 12345                    # Generate pr-timeline chart
  npm run pr-timeline 12345 --open            # Generate and open in browser
  npm run pr-timeline 12345 --output ./charts # Save to custom directory
  npm run pr-timeline 12345 --debug           # Generate with debug logging

Description:
  Generates an interactive Gantt chart visualization of a GitHub Pull Request
  timeline showing parallel tracks for:
  - 📋 Administrative events (opened, merged, closed)
  - 👨‍💻 Development activity (commits)
  - 🔧 CI/CD pipelines (builds, tests, deployments)
  - 💬 Code reviews (approvals, change requests)
  - 💭 Discussion (comments, review comments)

Requirements:
  - Set GITHUB_TOKEN environment variable
  - Set GITHUB_OWNER and GITHUB_REPO (optional, defaults to elastic/elasticsearch)
`);
  }
}
