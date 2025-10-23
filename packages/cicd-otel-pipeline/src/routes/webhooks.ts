import type { Request, Response, Router } from 'express';
import { verifyGithubSignature, verifyBuildkiteToken } from '../security.js';
import {
  handleGithubPREvent,
  handleGithubReviewEvent,
  handleGithubReviewCommentEvent,
  handleGithubReleaseEvent,
} from '../github/handlers.js';
import { handleBuildkiteBuildEvent } from '../buildkite/handlers.js';

export function registerWebhookRoutes(app: Router): void {
  // GitHub webhook endpoint
  app.post('/webhook/github', async (req: Request, res: Response) => {
    const signature = req.headers['x-hub-signature-256'] as string | undefined;
    const event = req.headers['x-github-event'] as string;

    if (!verifyGithubSignature(req.body, signature)) {
      console.error('Invalid GitHub webhook signature');
      return res.status(401).send('Unauthorized');
    }

    try {
      switch (event) {
        case 'pull_request':
          await handleGithubPREvent(req.body);
          console.log(
            `[GitHub] Processed PR #${req.body.number} (${req.body.action})`
          );
          break;

        case 'pull_request_review':
          await handleGithubReviewEvent(req.body);
          console.log(
            `[GitHub] Processed PR #${req.body.pull_request.number} review (${req.body.action})`
          );
          break;

        case 'pull_request_review_comment':
          await handleGithubReviewCommentEvent(req.body);
          console.log(
            `[GitHub] Processed PR #${req.body.pull_request.number} review comment (${req.body.action})`
          );
          break;

        case 'release':
          await handleGithubReleaseEvent(req.body);
          console.log(`[GitHub] Processed release (${req.body.action})`);
          break;

        default:
          console.log(`[GitHub] Ignoring event type: ${event}`);
          return res.status(200).send('OK');
      }

      res.status(200).send('OK');
    } catch (error) {
      console.error('[GitHub] Error processing webhook:', error);
      res.status(500).send('Internal Server Error');
    }
  });

  // Buildkite webhook endpoint
  app.post('/webhook/buildkite', async (req: Request, res: Response) => {
    const token = req.headers['x-buildkite-token'] as string | undefined;

    if (!verifyBuildkiteToken(token)) {
      console.error('Invalid Buildkite webhook token');
      return res.status(401).send('Unauthorized');
    }

    try {
      await handleBuildkiteBuildEvent(req.body);
      console.log(
        `[Buildkite] Processed build #${req.body.build.number} (${req.body.build.state})`
      );

      res.status(200).send('OK');
    } catch (error) {
      console.error('[Buildkite] Error processing webhook:', error);
      res.status(500).send('Internal Server Error');
    }
  });
}
