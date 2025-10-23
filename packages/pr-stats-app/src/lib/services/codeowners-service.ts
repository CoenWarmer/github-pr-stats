import { Octokit } from '@octokit/rest';
import { logger } from '../logger';

/**
 * Cache structure for CODEOWNERS file
 */
export interface CodeOwnersCache {
  content: string;
  rules: Array<{ pattern: string; owners: string[] }>;
  branch: string;
  lastFetchTime: number;
}

/**
 * Service for parsing and matching CODEOWNERS files
 */
export class CodeOwnersService {
  private octokit: Octokit;

  constructor(octokit: Octokit) {
    this.octokit = octokit;
  }

  /**
   * Build a cache of CODEOWNERS file from main branch
   * This should be called once at the start of a batch job
   */
  async buildCodeOwnersCache(
    owner: string,
    repo: string,
    branch: string = 'main'
  ): Promise<CodeOwnersCache> {
    try {
      logger.info(
        `Building CODEOWNERS cache for ${owner}/${repo} (branch: ${branch})`
      );

      // Fetch CODEOWNERS content from main branch
      let codeownersContent = '';
      const paths = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'];

      for (const path of paths) {
        try {
          const { data: file } = await this.octokit.rest.repos.getContent({
            owner,
            repo,
            path,
            ref: branch,
          });

          if ('content' in file) {
            codeownersContent = Buffer.from(file.content, 'base64').toString(
              'utf-8'
            );
            logger.info(`Found CODEOWNERS at ${path}`);
            break;
          }
        } catch (error) {
          logger.debug(`CODEOWNERS not found at ${path}`);
          continue;
        }
      }

      if (!codeownersContent) {
        logger.warn(
          `No CODEOWNERS file found in ${owner}/${repo} (branch: ${branch})`
        );
        return {
          content: '',
          rules: [],
          branch,
          lastFetchTime: Date.now(),
        };
      }

      // Parse CODEOWNERS into rules
      const rules = this.parseCodeOwnersContent(codeownersContent);

      logger.info(
        `CODEOWNERS cache built successfully with ${rules.length} rules`
      );

      return {
        content: codeownersContent,
        rules,
        branch,
        lastFetchTime: Date.now(),
      };
    } catch (error) {
      logger.error('Error building CODEOWNERS cache', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        content: '',
        rules: [],
        branch,
        lastFetchTime: Date.now(),
      };
    }
  }

  /**
   * Parse CODEOWNERS content into rules
   */
  private parseCodeOwnersContent(
    content: string
  ): Array<{ pattern: string; owners: string[] }> {
    const rules: Array<{ pattern: string; owners: string[] }> = [];
    const lines = content.split('\n');

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

    return rules;
  }

  /**
   * Get code owners for a PR by analyzing changed files and CODEOWNERS patterns
   * @param codeOwnersCache Optional pre-built cache for batch processing
   */
  async getCodeOwnersForPR(
    owner: string,
    repo: string,
    prNumber: number,
    codeOwnersCache?: CodeOwnersCache
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

      // Use cache if available, otherwise fetch from PR head
      let rules: Array<{ pattern: string; owners: string[] }> = [];

      if (codeOwnersCache && codeOwnersCache.rules.length > 0) {
        // Use cached rules from main branch
        logger.debug(`Using CODEOWNERS cache for PR #${prNumber}`);
        rules = codeOwnersCache.rules;
      } else {
        // Fetch and parse CODEOWNERS file from PR head (original behavior)
        logger.debug(`Fetching CODEOWNERS from PR head for PR #${prNumber}`);
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
          rules = this.parseCodeOwnersContent(codeownersContent);
        }
      }

      if (rules.length > 0) {
        // Match each changed file against CODEOWNERS patterns
        for (const file of files) {
          logger.debug(`Processing file: ${file.filename}`);

          const matchedOwners = this.matchFileToCodeOwners(
            file.filename,
            rules
          );

          if (matchedOwners.length > 0) {
            logger.debug(`  ✓ Matched owners:`, matchedOwners);
          } else {
            logger.debug(`  ✗ No owners matched`);
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
