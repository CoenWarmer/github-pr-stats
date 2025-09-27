import * as fs from 'fs';
import { logger } from '../shared/logger';

export class FileUtils {
  static ensureDirectoryExists(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  static getFileSize(filePath: string): string {
    const stats = fs.statSync(filePath);
    return `${(stats.size / 1024).toFixed(2)} KB`;
  }
}

export class BrowserUtils {
  static async openInBrowser(filePath: string): Promise<void> {
    try {
      logger.info('🚀 Opening Gantt chart in browser');

      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      const platform = process.platform;
      let command: string;

      if (platform === 'darwin') {
        command = `open "${filePath}"`;
      } else if (platform === 'win32') {
        command = `start "${filePath}"`;
      } else {
        command = `xdg-open "${filePath}"`;
      }

      await execAsync(command).catch(err => {
        logger.error('Error opening browser', { error: err.message });
        logger.info(`📋 Open ${filePath} in your browser`);
      });

      setTimeout(() => {
        logger.info('✅ Chart should open in browser shortly');
      }, 1000);
    } catch (error) {
      logger.error('❌ Error opening browser', { error });
      logger.info(`📋 Open ${filePath} in your browser`);
    }
  }
}

/**
 * Helper utility to format duration for display
 * @param startTime Start time as Date or ISO string
 * @param endTime End time as Date or ISO string
 * @returns Formatted duration string (e.g., "4.5h" or "2.3d")
 */
export function formatDuration(
  startTime: Date | string,
  endTime: Date | string
): string {
  const start = typeof startTime === 'string' ? new Date(startTime) : startTime;
  const end = typeof endTime === 'string' ? new Date(endTime) : endTime;

  const durationMs = end.getTime() - start.getTime();
  const durationHours = durationMs / (1000 * 60 * 60);

  if (durationHours < 12) {
    // Show in hours with 1 decimal place if under 12 hours
    return `${durationHours.toFixed(1)}h`;
  } else {
    // Show in days with 1 decimal place if over 12 hours
    const durationDays = durationHours / 24;
    return `${durationDays.toFixed(1)}d`;
  }
}

/**
 * Helper utility to format duration for display in hours
 * @returns Formatted duration string (e.g., "4.5h" or "2.3d")
 */
export function formatDurationInHours(hours: number): string {
  if (hours < 12) {
    // Show in hours with 1 decimal place if under 12 hours
    return `${hours.toFixed(1)}h`;
  } else {
    // Show in days with 1 decimal place if over 12 hours
    const durationDays = hours / 24;
    return `${durationDays.toFixed(1)}d`;
  }
}
