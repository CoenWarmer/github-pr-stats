import crypto from 'crypto';
import { config } from './config';

export function verifyGithubSignature(
  payload: unknown,
  signature: string | undefined
): boolean {
  if (!config.githubWebhookSecret) {
    console.warn(
      'No GitHub webhook secret configured - skipping signature verification'
    );
    return true;
  }

  if (!signature) {
    return false;
  }

  const hmac = crypto.createHmac('sha256', config.githubWebhookSecret);
  const digest = 'sha256=' + hmac.update(JSON.stringify(payload)).digest('hex');

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
}

export function verifyBuildkiteToken(token: string | undefined): boolean {
  if (!config.buildkiteWebhookToken) {
    console.warn(
      'No Buildkite webhook token configured - skipping verification'
    );
    return true;
  }

  return token === config.buildkiteWebhookToken;
}
