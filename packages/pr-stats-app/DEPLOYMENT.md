# Deploying PR Stats App to Netlify

This guide covers deploying the PR Stats App to Netlify.

## Prerequisites

1. **Netlify account** - Sign up at [netlify.com](https://www.netlify.com)
2. **GitHub Personal Access Token** with scopes:
   - `repo` (full control of private repositories)
   - `read:org` (read org and team membership)

   Get yours at: https://github.com/settings/tokens

## Deployment Steps

### 1. Connect Your Repository

1. Log into Netlify
2. Click "Add new site" → "Import an existing project"
3. Connect to your GitHub repository
4. Select the repository containing this app

### 2. Configure Build Settings

Netlify should auto-detect settings from `netlify.toml`, but verify:

- **Base directory:** `packages/pr-stats-app`
- **Build command:** `npm run build`
- **Publish directory:** `.next`
- **Node version:** `20`

### 3. Set Environment Variables

Go to: **Site settings** → **Environment variables** → **Add a variable**

**Required:**

```
GITHUB_TOKEN=ghp_your_github_token_here
```

**Optional:**

```
BUILDKITE_TOKEN=your_buildkite_token
BUILDKITE_ORG_SLUG=your_org_slug
LOG_LEVEL=info
```

### 4. Deploy

1. Click "Deploy site"
2. Wait for build to complete (~2-3 minutes)
3. Your app will be live at: `https://your-site-name.netlify.app`

## Important Notes

### Caching on Netlify

- The app uses file-based caching in `/tmp` on Netlify
- Cache is **ephemeral** and cleared between function invocations
- This means cache may not persist as long as locally
- Consider using a persistent cache service (Redis, KV store) for production

### Environment Variables

- Only variables set in Netlify UI are available in production
- Local `.env.local` files are NOT deployed
- Use `env.template` as a reference for required variables

### Serverless Function Limits

- **Free tier:** 125,000 requests/month, 100 hours run time
- **Function timeout:** 10 seconds (free), 26 seconds (Pro)
- GitHub API calls can be slow - consider upgrading if timeouts occur

### Next.js on Netlify

This app uses:

- Next.js 15 with App Router
- Server-side API routes (converted to Netlify Functions)
- Client-side React components
- SSR disabled for main page (`'use client'`)

## Troubleshooting

### Build Failures

**Error: Missing GITHUB_TOKEN**

- Solution: Add `GITHUB_TOKEN` to environment variables in Netlify UI

**Error: Module not found**

- Solution: Clear cache and redeploy
- Or check `package.json` dependencies

**Error: Build timeout**

- Solution: Monorepo builds can be slow - ensure `base` directory is set correctly

### Runtime Issues

**Error: GITHUB_TOKEN not defined**

- Check environment variables are set in Netlify UI
- Restart site if variables were just added

**Cache not working**

- Expected behavior on Netlify (ephemeral filesystem)
- Cache will reset between cold starts
- Use `?force=true` query parameter to bypass cache

**Function timeout**

- PRs with many events may timeout on free tier
- Upgrade to Pro for 26-second timeout
- Or optimize by reducing API calls

## Monitoring

View logs in Netlify:

1. Go to your site dashboard
2. Click "Functions" tab
3. Select a function to view logs
4. Or check "Deploy logs" for build issues

## Custom Domain (Optional)

1. Go to **Site settings** → **Domain management**
2. Click "Add custom domain"
3. Follow DNS configuration instructions
4. SSL certificate is automatically provisioned

## Further Optimization

### For Production Use:

1. **Add a persistent cache:**

   ```bash
   npm install @upstash/redis
   ```

   Or use Netlify Blobs/KV

2. **Rate limiting:**
   - Implement request throttling
   - Use GitHub API wisely

3. **Error monitoring:**
   - Add Sentry or similar service
   - Track API failures

4. **Performance:**
   - Enable ISR (Incremental Static Regeneration)
   - Add loading states
   - Implement pagination for large PRs

## Support

For issues specific to:

- **Netlify deployment:** Check [Netlify docs](https://docs.netlify.com)
- **Next.js on Netlify:** See [Next.js on Netlify](https://docs.netlify.com/frameworks/next-js/overview/)
- **This app:** Open an issue in the repository
