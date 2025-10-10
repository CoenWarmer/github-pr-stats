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

const JOB_DIR = process.env.NETLIFY
  ? '/tmp/pr-jobs'
  : path.join(process.cwd(), 'data', 'jobs');

function ensureJobDir() {
  if (!fs.existsSync(JOB_DIR)) {
    fs.mkdirSync(JOB_DIR, { recursive: true });
    logger.debug(`Created job directory: ${JOB_DIR}`);
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
