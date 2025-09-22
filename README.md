# GitHub PR Stats with Elasticsearch

A TypeScript application that collects GitHub Pull Request statistics and indexes them into Elasticsearch for analysis and visualization.

## Features

- Fetches comprehensive **merged** PR data from GitHub repositories using Octokit
- **Team Information**: Captures which teams users belong to within the organization
- **CODEOWNERS Integration**: Identifies code owners tagged in PRs based on changed files
- **Review Timing Analysis**: Tracks time-to-review for each reviewer including their team affiliations
- Indexes PR statistics into Elasticsearch with proper mappings
- Provides aggregated statistics and analytics including team-based metrics
- Rate limiting to respect GitHub API limits
- TypeScript support with full type safety

## Prerequisites

- Node.js (v16 or higher)
- Elasticsearch instance (local or remote)
- GitHub Personal Access Token

## Installation

1. Install dependencies:

```bash
npm install
```

2. Copy the environment file and configure it:

```bash
cp .env.example .env
```

3. Edit `.env` and add your GitHub token and Elasticsearch URL:

```bash
GITHUB_TOKEN=your_github_token_here
ELASTICSEARCH_URL=http://localhost:9200
ELASTICSEARCH_API_KEY=your_elasticsearch_api_key_here  # For Elastic Cloud
GITHUB_OWNER=owner_name
GITHUB_REPO=repo_name
```

## Usage

### Development Mode

Run the script directly with ts-node:

```bash
npm run dev
```

### Production Build

Build and run the compiled JavaScript:

```bash
npm run build
npm start
```

### Organization Dependency Graphs

Generate Mermaid diagrams for team hierarchy and CODEOWNERS mapping:

```bash
npm run build-graphs
```

This will create two markdown files:

- `team-hierarchy.md` - Shows the organizational team structure
- `codeowners-teams.md` - Maps CODEOWNERS file patterns to teams

### Code Formatting

Format code with Prettier:

```bash
npm run format
```

Check if code is properly formatted:

```bash
npm run format:check
```

## Configuration

The script can be configured via environment variables in a `.env` file:

- `GITHUB_TOKEN` (required): Your GitHub Personal Access Token
- `ELASTICSEARCH_URL` (optional): Elasticsearch endpoint (default: http://localhost:9200)
- `ELASTICSEARCH_API_KEY` (optional): API key for Elastic Cloud authentication
- `GITHUB_OWNER` (optional): Repository owner (default: elastic)
- `GITHUB_REPO` (optional): Repository name (default: elasticsearch)

## Data Structure

The script collects the following statistics for **merged PRs only**:

- **Basic PR Information**: ID, number, title, state, dates (created, updated, closed, merged)
- **Author Information**: Username, ID, and team memberships
- **CODEOWNERS**: List of code owners (users/teams) tagged for the changed files
- **Review Timing Data**: For each review:
- **Review Timing Data**: For each review:
  - Reviewer username and team memberships
  - Time from PR creation to review submission (in hours)
  - Review state (APPROVED, CHANGES_REQUESTED, COMMENTED)
  - **Team relationship**: Analysis of the organizational relationship between PR author and reviewer:
    - `same-team`: Both author and reviewer are in the same team
    - `intra-team`: Different teams but within the same team hierarchy (parent-child relationship)
    - `intra-department`: Different teams but under the same top-level department
    - `cross-department`: Completely different organizational branches
- **Code Changes**: Additions, deletions, changed files, commits
- **Engagement Metrics**: Comments, review comments

## Elasticsearch Index

The data is indexed with the following mapping:

- `id`: PR ID (long)
- `number`: PR number (long)
- `title`: PR title (text)
- `state`: PR state (keyword)
- `url`: Direct link to the PR (keyword)
- `created_at`, `updated_at`, `closed_at`, `merged_at`: Dates
- `user.login`: Author username (keyword)
- `user.id`: Author ID (long)
- `user.team`: Author's team memberships (keyword)
- `codeowners`: Array of code owner usernames (keyword array)
- `reviews`: Nested array with reviewer, teams, timing, state, and team relationship for each review
- `additions`, `deletions`, `changed_files`, `commits`: Numeric metrics
- `review_comments`, `comments`: Engagement metrics

## Analytics

The script provides comprehensive aggregated statistics including:

- PR state distribution
- Average code changes metrics
- Top contributors and their teams
- Code owner team analysis
- Review timing statistics:
  - Average time to review
  - Review time percentiles (50th, 75th, 90th, 95th)
  - Reviewer team breakdown
  - Review outcome distribution
- PR creation trends over time

## Rate Limiting

The script includes a 100ms delay between API calls to respect GitHub's rate limits. For large repositories, consider adjusting this delay or running the script in smaller batches.

## GitHub Token Permissions

The script requires a GitHub Personal Access Token with the following scopes:

- `repo`: Full repository access (required for PR data and CODEOWNERS)
- `read:org`: Read organization membership (required for team information)

**Note**: To access team membership information, your token must have organization member permissions. If you don't have these permissions, the script will still work but team information will be empty arrays.

## License

ISC
