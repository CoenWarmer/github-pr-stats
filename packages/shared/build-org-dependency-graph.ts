/**
 * Build Mermaid graphs for:
 * 1) Team hierarchy (parent -> child)
 * 2) CODEOWNERS patterns -> teams
 *
 * Requirements:
 *   npm i @octokit/rest
 *
 * Auth:
 *   export GITHUB_TOKEN=ghp_...
 */

import { Octokit } from '@octokit/rest';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables from .env file
dotenv.config();

export type Team = { slug: string; name: string; parentSlug?: string | null };

type CodeownersRule = { pattern: string; teams: string[] };

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

export async function fetchTeamsWithParents(org: string): Promise<Team[]> {
  const query = `
    query($org:String!, $after:String) {
      organization(login:$org) {
        teams(first:100, after:$after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            slug
            name
            parentTeam { slug }
          }
        }
      }
    }
  `;

  const teams: Team[] = [];
  let after: string | null = null;

  do {
    const res: any = await octokit.request('POST /graphql', {
      query,
      variables: { org, after },
    });
    const page = res.data.data.organization.teams;
    for (const t of page.nodes) {
      teams.push({
        slug: t.slug,
        name: t.name,
        parentSlug: t.parentTeam?.slug ?? null,
      });
    }
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);

  return teams;
}

export async function fetchCodeowners(
  owner: string,
  repo: string,
  ref?: string
): Promise<string | null> {
  // Try common CODEOWNERS locations in priority order used by GitHub docs
  const candidates = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'];

  for (const path of candidates) {
    try {
      const res = await octokit.rest.repos.getContent({
        owner,
        repo,
        path,
        ref,
      });
      if (!Array.isArray(res.data) && 'content' in res.data) {
        const buf = Buffer.from(res.data.content, 'base64');
        return buf.toString('utf-8');
      }
    } catch (e: any) {
      if (e.status !== 404) throw e; // ignore not found, try next path
    }
  }
  return null;
}

export function parseCodeowners(raw: string, org: string): CodeownersRule[] {
  const rules: CodeownersRule[] = [];
  const lines = raw.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Split on whitespace: first token = pattern, rest = owners
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) continue;

    const pattern = parts[0];
    const owners = parts.slice(1);

    // Keep only team owners in the same org: @org/team-slug
    const teams = owners
      .filter(o => o.startsWith('@'))
      .map(o => o.replace(/^@/, '')) // remove @
      .filter(o => {
        // format could be org/team or org/Team-Name
        const [oOrg] = o.split('/', 1);
        return oOrg?.toLowerCase() === org.toLowerCase();
      })
      .map(o => {
        // normalize to lowercase slug after "org/"
        const slug = o.split('/')[1] || '';
        return slug.toLowerCase();
      })
      .filter(Boolean);

    if (teams.length > 0) {
      rules.push({ pattern, teams: Array.from(new Set(teams)) });
    }
  }
  return rules;
}

/** Mermaid helpers */
function mermaidEscape(label: string): string {
  // Minimal escaping for quotes/backticks that can break Mermaid labels
  return label.replace(/"/g, '\\"').replace(/`/g, '\\`');
}

export function teamsHierarchyToMermaid(teams: Team[]): string {
  // graph TD with parent --> child
  // Use stable node ids: t_<slug>
  const lines: string[] = ['graph TD'];

  // Declare nodes with readable labels
  for (const t of teams) {
    const id = `t_${t.slug}`;
    const label = mermaidEscape(t.name || t.slug);
    lines.push(`${id}["${label}"]`);
  }

  // Edges parent --> child
  for (const t of teams) {
    if (t.parentSlug) {
      lines.push(`t_${t.parentSlug} --> t_${t.slug}`);
    }
  }

  return lines.join('\n');
}

export function codeownersToTeamsMermaid(
  rules: CodeownersRule[],
  teams: Team[]
): string {
  // graph TD with pattern --> team
  // Deduplicate pattern nodes; link to team nodes that exist in org
  const existing = new Set(teams.map(t => t.slug));
  const lines: string[] = ['graph TD'];

  // Declare team nodes (some teams may not be referenced; harmless but useful context)
  for (const t of teams) {
    const id = `t_${t.slug}`;
    const label = mermaidEscape(t.name || t.slug);
    lines.push(`${id}["${label}"]`);
  }

  // Patterns can be many; build ids p_<index> with a label showing the glob
  let pIndex = 0;
  for (const rule of rules) {
    const pid = `p_${pIndex++}`;
    const plabel = mermaidEscape(rule.pattern);
    lines.push(`${pid}(["\`${plabel}\`"])`); // styled as a “subroutine” node

    // Edges to teams that actually exist in the org
    const targetTeams = rule.teams.filter(slug => existing.has(slug));
    for (const slug of targetTeams) {
      lines.push(`${pid} --> t_${slug}`);
    }
  }

  return lines.join('\n');
}

/** Team relationship analysis */
export function analyzeTeamRelationship(
  authorTeams: string[],
  reviewerTeams: string[],
  teams: Team[]
): 'same-team' | 'intra-team' | 'intra-department' | 'cross-department' {
  // If any team matches exactly, it's same team
  const authorTeamSet = new Set(authorTeams);
  const reviewerTeamSet = new Set(reviewerTeams);

  for (const authorTeam of authorTeams) {
    if (reviewerTeamSet.has(authorTeam)) {
      return 'same-team';
    }
  }

  // Build team hierarchy map
  const teamMap = new Map<string, Team>();
  teams.forEach(team => teamMap.set(team.slug, team));

  // Check for intra-team relationships (parent-child within same team hierarchy)
  for (const authorTeam of authorTeams) {
    for (const reviewerTeam of reviewerTeams) {
      if (areInSameTeamHierarchy(authorTeam, reviewerTeam, teamMap)) {
        return 'intra-team';
      }
    }
  }

  // Check for intra-department (same top-level parent)
  for (const authorTeam of authorTeams) {
    for (const reviewerTeam of reviewerTeams) {
      if (areInSameDepartment(authorTeam, reviewerTeam, teamMap)) {
        return 'intra-department';
      }
    }
  }

  return 'cross-department';
}

function areInSameTeamHierarchy(
  team1: string,
  team2: string,
  teamMap: Map<string, Team>
): boolean {
  const team1Obj = teamMap.get(team1);
  const team2Obj = teamMap.get(team2);

  if (!team1Obj || !team2Obj) return false;

  // Check if one is parent/ancestor of the other
  return isAncestor(team1, team2, teamMap) || isAncestor(team2, team1, teamMap);
}

function areInSameDepartment(
  team1: string,
  team2: string,
  teamMap: Map<string, Team>
): boolean {
  const topLevel1 = getTopLevelParent(team1, teamMap);
  const topLevel2 = getTopLevelParent(team2, teamMap);

  return topLevel1 === topLevel2 && topLevel1 !== null;
}

function isAncestor(
  ancestor: string,
  descendant: string,
  teamMap: Map<string, Team>
): boolean {
  let current = teamMap.get(descendant);

  while (current?.parentSlug) {
    if (current.parentSlug === ancestor) {
      return true;
    }
    current = teamMap.get(current.parentSlug);
  }

  return false;
}

function getTopLevelParent(
  teamSlug: string,
  teamMap: Map<string, Team>
): string | null {
  let current = teamMap.get(teamSlug);

  if (!current) return null;

  while (current.parentSlug) {
    const parent = teamMap.get(current.parentSlug);
    if (!parent) break;
    current = parent;
  }

  return current.slug;
}

/** Write mermaid content to markdown files */
export function writeMarkdownFile(
  filename: string,
  title: string,
  mermaidContent: string,
  description?: string
): void {
  const content = `# ${title}

${description ? `${description}\n\n` : ''}## Diagram

\`\`\`mermaid
${mermaidContent}
\`\`\`

## Generated

This file was automatically generated on ${new Date().toISOString()}.
`;

  const outputPath = path.join(process.cwd(), filename);
  fs.writeFileSync(outputPath, content, 'utf-8');
  console.log(`✓ Written: ${outputPath}`);
}

/** ---- Main example ----
 * Configure via environment variables or modify the values below.
 */
async function main() {
  const org = process.env.GITHUB_OWNER || 'my-org'; // <- your org login
  const owner = process.env.GITHUB_OWNER || 'my-org'; // <- owner of the repo (often same as org)
  const repo = process.env.GITHUB_REPO || 'my-repo'; // <- repository name
  const ref = undefined; // <- optionally pin to a branch/sha (e.g., "main")

  if (!process.env.GITHUB_TOKEN) {
    throw new Error('GITHUB_TOKEN is required (needs read:org and repo read).');
  }

  // 1) Teams (with parents)
  const teams = await fetchTeamsWithParents(org);

  // 2) CODEOWNERS
  const raw = await fetchCodeowners(owner, repo, ref);
  if (!raw) {
    console.error('No CODEOWNERS file found in the repo.');
  }

  const rules = raw ? parseCodeowners(raw, org) : [];

  // 3) Mermaid outputs
  const mermaidHierarchy = teamsHierarchyToMermaid(teams);
  const mermaidCodeowners = codeownersToTeamsMermaid(rules, teams);

  // Print to stdout (pipe into a .md or Mermaid renderer of your choice)
  console.log('\n--- Team hierarchy (Mermaid) ---\n');
  console.log(mermaidHierarchy);

  console.log('\n--- CODEOWNERS → Teams (Mermaid) ---\n');
  console.log(mermaidCodeowners);

  // 4) Write to markdown files
  console.log('\n--- Writing to markdown files ---\n');

  writeMarkdownFile(
    'team-hierarchy.md',
    'Team Hierarchy',
    mermaidHierarchy,
    `This diagram shows the hierarchical structure of teams in the **${org}** organization. Parent teams are connected to their child teams with arrows.`
  );

  writeMarkdownFile(
    'codeowners-teams.md',
    'CODEOWNERS → Teams Mapping',
    mermaidCodeowners,
    `This diagram shows how file patterns in the CODEOWNERS file map to teams in the **${org}** organization for the **${repo}** repository. Each pattern is represented as a rounded rectangle, with arrows pointing to the teams responsible for those files.`
  );
}

// Only run main if this file is executed directly, not when imported
if (require.main === module) {
  main().catch(e => {
    console.error(e);
    process.exit(1);
  });
}
