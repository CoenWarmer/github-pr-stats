import { NextResponse } from 'next/server';
import { Octokit } from '@octokit/rest';
import { logger } from '@/lib/logger';

export async function GET() {
  try {
    const githubToken = process.env.GITHUB_TOKEN;
    const githubOwner = process.env.GITHUB_OWNER;

    if (!githubToken) {
      logger.error('GITHUB_TOKEN environment variable is not set');
      return NextResponse.json(
        { error: 'GitHub token is not configured' },
        { status: 500 }
      );
    }

    if (!githubOwner) {
      logger.error('GITHUB_OWNER environment variable is not set');
      return NextResponse.json(
        { error: 'GitHub owner is not configured' },
        { status: 500 }
      );
    }

    const octokit = new Octokit({ auth: githubToken });

    // Fetch all teams for the organization using pagination
    const teams = await octokit.paginate(octokit.rest.teams.list, {
      org: githubOwner,
      per_page: 100,
    });

    // Transform to simpler format
    const teamList = teams.map(team => ({
      slug: team.slug,
      name: team.name,
      description: team.description || '',
      id: team.id,
    }));

    logger.info(`Fetched ${teamList.length} teams for ${githubOwner}`);

    return NextResponse.json({
      teams: teamList,
      organization: githubOwner,
    });
  } catch (error) {
    logger.error('Error fetching teams', {
      error: error instanceof Error ? error.message : error,
    });

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to fetch teams',
      },
      { status: 500 }
    );
  }
}
