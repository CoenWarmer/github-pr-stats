# XRay - PR Timeline Stats

A monorepo with the following packages:

- pr-stats-app: A Next.js app that displays a Gantt chart of a GitHub Pull Request

## Features

- Display a timeline of a GitHub Pull Request, including:
  - **PR lifecycle**: Creation, ready for review, merged, closed, released (including serverless)
  - **Reviews**: Requested, dismissed, completed
  - **Issues**: Creation, assignment/unassignment, in progress, iteration, closure, release
  - **Commits**: Added, pushed, force pushed
  - **Comments**: PR comments, review comments, issue comments
  - **CI/CD**: Started, running, completed (success/failure), released

## Development

### Prerequisites

- Node.js 18+
- npm or yarn
- GitHub Personal Access Token
- Buildkite Personal Access Token

### Installation

1. Clone the repository
2. Run `yarn install` to install the dependencies
3. Run `yarn app:dev` to start the development server
4. Open [http://localhost:3000](http://localhost:3000) to see the app

## Usage

1. Go to [http://localhost:3000](http://localhost:3000)
2. Enter the PR details
3. Click "Analyze PR" to fetch and visualize the data
4. Explore the Timeline

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
