export interface Config {
  port: number;
  githubWebhookSecret?: string;
  buildkiteWebhookToken?: string;
  buildkiteApiToken?: string;
  buildkiteOrganization?: string;
  githubToken?: string;
  otlpEndpoint: string;
  serviceName: string;
}

export const config: Config = {
  port: parseInt(process.env.PORT || '3000'),
  githubWebhookSecret: process.env.GITHUB_WEBHOOK_SECRET,
  buildkiteWebhookToken: process.env.BUILDKITE_WEBHOOK_TOKEN,
  buildkiteApiToken:
    process.env.BUILDKITE_API_TOKEN || process.env.BUILDKITE_TOKEN,
  buildkiteOrganization:
    process.env.BUILDKITE_ORGANIZATION ||
    process.env.BUILDKITE_ORG_SLUG ||
    'elastic',
  githubToken: process.env.GITHUB_TOKEN,
  otlpEndpoint: process.env.OTLP_ENDPOINT || 'http://localhost:4318/v1/logs',
  serviceName: process.env.SERVICE_NAME || 'telemetry-pipeline',
};
