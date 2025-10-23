import type { Request, Response, Router } from 'express';
import { config } from '../config.js';

export function registerHealthRoute(app: Router): void {
  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'healthy',
      receivers: {
        github: !!config.githubWebhookSecret,
        buildkite: !!config.buildkiteWebhookToken,
      },
    });
  });
}
