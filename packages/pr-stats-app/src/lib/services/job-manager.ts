import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../logger';

export interface PRJob {
  number: number;
  owner: string;
  repo: string;
  title: string;
  author: string;
  url: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  error?: string;
}

export interface JobStatus {
  jobId: string;
  status: 'running' | 'completed' | 'error';
  team: string;
  repo: string;
  totalPRs: number;
  processedPRs: number;
  completedPRs: number;
  errorPRs: number;
  prs: PRJob[];
  startedAt: string;
  completedAt?: string;
  error?: string;
}

// Detect if we're running on a serverless platform (Netlify, Vercel, AWS Lambda, etc.)
// These platforms only allow writes to /tmp
const isServerless =
  process.env.NETLIFY === 'true' ||
  process.env.VERCEL === '1' ||
  process.env.AWS_LAMBDA_FUNCTION_NAME ||
  process.env.CONTEXT || // Netlify sets this
  process.env.LAMBDA_TASK_ROOT; // AWS Lambda

const JOB_DIR = isServerless
  ? '/tmp/pr-jobs'
  : path.join(process.cwd(), 'data', 'jobs');

function ensureJobDir() {
  logger.info(`Using job directory: ${JOB_DIR}`, {
    isServerless,
    cwd: process.cwd(),
    env: {
      NETLIFY: process.env.NETLIFY,
      CONTEXT: process.env.CONTEXT,
      VERCEL: process.env.VERCEL,
    },
  });

  if (!fs.existsSync(JOB_DIR)) {
    try {
      fs.mkdirSync(JOB_DIR, { recursive: true });
      logger.info(`Created job directory: ${JOB_DIR}`);
    } catch (error) {
      logger.error(`Failed to create job directory: ${JOB_DIR}`, {
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }
}

function getJobFilePath(jobId: string): string {
  return path.join(JOB_DIR, `${jobId}.json`);
}

export function createJob(jobId: string, initialStatus: JobStatus): void {
  ensureJobDir();
  const filePath = getJobFilePath(jobId);
  fs.writeFileSync(filePath, JSON.stringify(initialStatus, null, 2));
  logger.info(`Job created: ${jobId}`);
}

export function updateJobStatus(
  jobId: string,
  updates: Partial<JobStatus>
): void {
  try {
    const filePath = getJobFilePath(jobId);
    if (!fs.existsSync(filePath)) {
      logger.warn(`Job file not found: ${jobId}`);
      return;
    }

    const currentStatus: JobStatus = JSON.parse(
      fs.readFileSync(filePath, 'utf-8')
    );
    const updatedStatus = { ...currentStatus, ...updates };
    fs.writeFileSync(filePath, JSON.stringify(updatedStatus, null, 2));
  } catch (error) {
    logger.error(`Error updating job status: ${jobId}`, {
      error: error instanceof Error ? error.message : error,
    });
  }
}

export function getJobStatus(jobId: string): JobStatus | null {
  try {
    ensureJobDir();
    const filePath = getJobFilePath(jobId);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (error) {
    logger.error(`Error reading job status: ${jobId}`, {
      error: error instanceof Error ? error.message : error,
    });
    return null;
  }
}

export function deleteJob(jobId: string): void {
  try {
    const filePath = getJobFilePath(jobId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      logger.info(`Job deleted: ${jobId}`);
    }
  } catch (error) {
    logger.error(`Error deleting job: ${jobId}`, {
      error: error instanceof Error ? error.message : error,
    });
  }
}
