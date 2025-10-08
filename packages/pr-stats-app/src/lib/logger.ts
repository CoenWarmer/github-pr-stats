import winston from 'winston';

// Define log levels
const logLevels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

// Create custom format for console (with colors)
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize(),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let log = `${timestamp} [${level}]: ${message}`;

    // Add metadata if present
    if (Object.keys(meta).length > 0) {
      log += ` ${JSON.stringify(meta)}`;
    }

    return log;
  })
);

// Create custom format for files (no colors)
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let log = `${timestamp} [${level.toUpperCase()}]: ${message}`;

    // Add metadata if present
    if (Object.keys(meta).length > 0) {
      log += ` ${JSON.stringify(meta)}`;
    }

    return log;
  })
);

// Create the logger with transports appropriate for Next.js
const transports: winston.transport[] = [
  // Console transport (with colors)
  new winston.transports.Console({
    format: consoleFormat,
  }),
];

// Only add file transports in server environment
if (typeof window === 'undefined') {
  transports.push(
    // File transport for errors (no colors)
    new winston.transports.File({
      filename: 'error.log',
      level: 'error',
      format: fileFormat,
    }),
    // File transport for all logs (no colors)
    new winston.transports.File({
      filename: 'combined.log',
      format: fileFormat,
    })
  );
}

// Create the logger
export const logger = winston.createLogger({
  levels: logLevels,
  level: process.env.LOG_LEVEL || 'info',
  transports,
});

// Add debug logging in development
if (process.env.NODE_ENV === 'development') {
  logger.level = 'debug';
}

export default logger;

