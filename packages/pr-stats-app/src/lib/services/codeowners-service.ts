import { Octokit } from '@octokit/rest';
import { logger } from '../logger';

/**
 * Service for parsing and matching CODEOWNERS files
 */
export class CodeOwnersService {
  private octokit: Octokit;

  constructor(octokit: Octokit) {
    this.octokit = octokit;
  }

  /**
   * Get code owners for a PR by analyzing changed files and CODEOWNERS patterns
   */
  async getCodeOwnersForPR(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<{ teams: string[]; individuals: string[] }> {
    try {
      // Get the list of files changed in the PR
      const { data: files } = await this.octokit.rest.pulls.listFiles({
        owner,
        repo,
        pull_number: prNumber,
        per_page: 100,
      });

      logger.debug(`Found ${files.length} changed files in PR #${prNumber}`);

      const allTeams = new Set<string>();
      const allIndividuals = new Set<string>();

      // Fetch and parse CODEOWNERS file
      let codeownersContent = '';
      try {
        const { data: file } = await this.octokit.rest.repos.getContent({
          owner,
          repo,
          path: '.github/CODEOWNERS',
          ref: `refs/pull/${prNumber}/head`,
        });

        if ('content' in file) {
          codeownersContent = Buffer.from(file.content, 'base64').toString(
            'utf-8'
          );
        }
      } catch (error) {
        logger.debug('CODEOWNERS file not found in .github/', {
          error: error instanceof Error ? error.message : String(error),
        });

        // Try alternate location
        try {
          const { data: file } = await this.octokit.rest.repos.getContent({
            owner,
            repo,
            path: 'CODEOWNERS',
            ref: `refs/pull/${prNumber}/head`,
          });

          if ('content' in file) {
            codeownersContent = Buffer.from(file.content, 'base64').toString(
              'utf-8'
            );
          }
        } catch (error2) {
          logger.debug('CODEOWNERS file not found in root', {
            error: error2 instanceof Error ? error2.message : String(error2),
          });
        }
      }

      if (codeownersContent) {
        // Parse CODEOWNERS file into rules
        const rules: Array<{ pattern: string; owners: string[] }> = [];
        const lines = codeownersContent.split('\n');

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#')) {
            const parts = trimmed.split(/\s+/);
            if (parts.length >= 2) {
              const pattern = parts[0];
              const owners = parts.slice(1);
              rules.push({ pattern, owners });
            }
          }
        }

        // Match each changed file against CODEOWNERS patterns
        for (const file of files) {
          logger.info(`Processing file: ${file.filename}`);

          const matchedOwners = this.matchFileToCodeOwners(
            file.filename,
            rules
          );

          if (matchedOwners.length > 0) {
            logger.info(`  ✓ Matched owners:`, matchedOwners);
          } else {
            logger.info(`  ✗ No owners matched`);
          }

          for (const owner of matchedOwners) {
            if (owner.startsWith('@')) {
              const name = owner.substring(1);
              if (name.includes('/')) {
                // Team (format: @org/team-name)
                const teamName = name.split('/')[1];
                allTeams.add(teamName);
              } else {
                // Individual (format: @username)
                allIndividuals.add(name);
              }
            }
          }
        }
      }

      logger.debug(`Found code owners for PR #${prNumber}`, {
        teams: Array.from(allTeams),
        individuals: Array.from(allIndividuals),
      });

      return {
        teams: Array.from(allTeams),
        individuals: Array.from(allIndividuals),
      };
    } catch (error) {
      logger.warn('Could not get code owners for PR', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { teams: [], individuals: [] };
    }
  }

  /**
   * Match a file path against CODEOWNERS patterns
   * Returns the owners for the most specific matching pattern
   */
  private matchFileToCodeOwners(
    filePath: string,
    rules: Array<{ pattern: string; owners: string[] }>
  ): string[] {
    let matchedOwners: string[] = [];

    // Process rules in order (later rules override earlier ones)
    for (const rule of rules) {
      if (this.matchPattern(filePath, rule.pattern)) {
        matchedOwners = rule.owners;
      }
    }

    return matchedOwners;
  }

  /**
   * Match a file path against a CODEOWNERS pattern
   * Supports glob patterns like *, **, ?, etc.
   */
  private matchPattern(filePath: string, pattern: string): boolean {
    // Convert CODEOWNERS pattern to regex
    // Handle special cases:
    // - * matches any string except /
    // - ** matches any string including /
    // - ? matches any single character except /
    // - / at the end matches directory
    // - / at the start matches from root
    // - patterns without / should match from root OR as substring

    let regexPattern = pattern;

    // Escape special regex characters except our wildcards
    regexPattern = regexPattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');

    // Replace ** with a placeholder
    regexPattern = regexPattern.replace(/\*\*/g, '<!DOUBLESTAR!>');

    // Replace * with [^/]*
    regexPattern = regexPattern.replace(/\*/g, '[^/]*');

    // Replace placeholder with .*
    regexPattern = regexPattern.replace(/<!DOUBLESTAR!>/g, '.*');

    // Replace ? with [^/]
    regexPattern = regexPattern.replace(/\?/g, '[^/]');

    // If pattern starts with /, match from start
    if (regexPattern.startsWith('/')) {
      regexPattern = '^' + regexPattern.substring(1);
    } else {
      // Otherwise, match from root (no leading slash in CODEOWNERS means root-relative)
      regexPattern = '^' + regexPattern;
    }

    // If pattern ends with /, it's a directory - match it and everything inside
    if (regexPattern.endsWith('/')) {
      regexPattern = regexPattern + '.*';
    } else {
      // Pattern doesn't end with / - match exact file OR directory with contents
      // e.g. "foo" matches "foo" (file) or "foo/bar.txt" (directory)
      regexPattern = regexPattern + '(/.*)?';
    }

    // Add end anchor
    regexPattern = regexPattern + '$';

    const regex = new RegExp(regexPattern);
    return regex.test(filePath);
  }
}
