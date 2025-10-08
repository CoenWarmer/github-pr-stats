# PR Timeline Stats - Next.js App

A modern web application for visualizing GitHub Pull Request timelines and analyzing development workflows. Built with Next.js, TypeScript, and Vis.js.

## Features

- 📊 **Interactive Timeline Visualization** - See PR lifecycle events in a visual timeline
- 🔍 **Detailed Analytics** - Review patterns, delivery friction metrics, and turnaround times
- 📋 **Issue Tracking** - Linked issue lifecycle events and feature turnaround times
- 💬 **Review Analysis** - Code owner reviews, discussions, and approval workflows
- 🔧 **CI/CD Integration** - Build status and deployment pipeline visualization
- 📈 **Delivery Friction Metrics** - Composite scoring of development bottlenecks

## Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn
- GitHub Personal Access Token

### Installation

1. **Clone and navigate to the app:**

   ```bash
   cd pr-stats-app
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Set up environment variables:**

   ```bash
   # Create .env.local file
   echo "GITHUB_TOKEN=your_github_token_here" > .env.local
   ```

   Get your GitHub token at: https://github.com/settings/tokens
   Required scopes: `repo`, `read:org`

4. **Run the development server:**

   ```bash
   npm run dev
   ```

5. **Open your browser:**
   Visit [http://localhost:3000](http://localhost:3000)

## Usage

1. **Enter PR Details:**

   - Owner: `elastic`
   - Repository: `kibana`
   - PR Number: `221010`

2. **Click "Analyze PR"** to fetch and visualize the data

3. **Explore the Timeline:**

   - **Feature Turnaround** - Full issue-to-closure lifecycle
   - **Administrative** - PR lifecycle, issue assignments
   - **Development** - Code commits and changes
   - **CI/CD** - Build and deployment pipeline
   - **Review Sections** - Code owner and reviewer feedback
   - **Discussion** - Comments and conversations

4. **Use Timeline Controls:**
   - 🔍 **Zoom to PR Process** - Focus on PR creation to closure
   - 🗓️ **Fit All** - Show complete timeline including linked issues

## Timeline Rows Explained

- **⏱️ Feature Turnaround** - Complete feature development from issue creation to closure
- **📋 Administrative** - PR events, issue assignments, state changes
- **👨‍💻 Development** - Commits, code changes, development work
- **🔧 CI/CD** - Build results, test runs, deployment status
- **👥 Team Reviews** - Code owner team reviews and approvals
- **👤 Individual Reviews** - Individual code owner reviews
- **👥 Additional Reviewers** - Non-code-owner reviewer feedback
- **💭 Discussion** - Comments, questions, and conversations

## Metrics

### Delivery Friction Score

Composite metric (0-100) measuring development obstacles:

- **CI Time** (25%) - Build and test duration
- **Waiting Time** (30%) - Review and approval delays
- **Code Complexity** (20%) - Lines changed and file count
- **Review Iterations** (15%) - Back-and-forth feedback cycles
- **Duration** (10%) - Overall turnaround time

### Score Ranges

- **0-30** 🟢 Low friction - Smooth delivery
- **31-60** 🟡 Medium friction - Some bottlenecks
- **61+** 🔴 High friction - Significant obstacles

## API Routes

### `GET /api/pr/[owner]/[repo]/[prNumber]`

Fetches comprehensive PR data including:

- Timeline events and commits
- Review timings and approvals
- CI/CD pipeline results
- Linked issue lifecycle events
- Code owner information

## Development

### Project Structure

```
src/
├── app/                 # Next.js app router
│   ├── api/            # API routes
│   └── page.tsx        # Main page
├── components/         # React components
│   ├── Timeline.tsx    # Vis.js timeline wrapper
│   └── PRStats.tsx     # Statistics display
└── lib/               # Core libraries
    ├── github-collector.ts  # GitHub API integration
    ├── timeline-transformer.ts  # Data transformation
    ├── types.ts        # TypeScript interfaces
    ├── utils.ts        # Utility functions
    └── logger.ts       # Winston logging
```

### Scripts

- `npm run dev` - Development server with Turbopack
- `npm run build` - Production build
- `npm run start` - Start production server
- `npm run lint` - ESLint code checking

## Environment Variables

```bash
# Required
GITHUB_TOKEN=your_personal_access_token

# Optional
LOG_LEVEL=info          # error, warn, info, debug
NODE_ENV=development    # development, production
```

## Migration from CLI Tool

This Next.js app replaces the original CLI tool with:

✅ **Web Interface** - No command line needed
✅ **Real-time Visualization** - Interactive timeline  
✅ **Modern UI** - Clean, responsive design
✅ **Easy Sharing** - Share URLs to specific PRs
✅ **Better Performance** - API routes and caching

The core functionality and metrics remain the same, just with a better user experience.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details
