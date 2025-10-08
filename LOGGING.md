# Logging Configuration

This project uses [Winston](https://github.com/winstonjs/winston) for structured logging.

## Log Levels

The application uses the following log levels (in order of severity):

1. **error** - Critical errors that need immediate attention
2. **warn** - Warning conditions that should be noted
3. **info** - General information about application flow
4. **debug** - Detailed information for debugging purposes

## Configuration

Logging is configured in `src/logger.ts` and includes:

- **Console output**: Colorized logs to the terminal
- **File output**:
  - `error.log` - Contains only error-level logs
  - `combined.log` - Contains all log levels

## Environment Variables

- `LOG_LEVEL`: Sets the minimum log level (default: `info`)
  - Set to `debug` for verbose logging during development
  - Set to `warn` or `error` for production environments
- `NODE_ENV`: When set to `development`, automatically enables debug logging

## Examples

```bash
# Run with debug logging using CLI flag (recommended)
npm run pr-timeline -- 221010 --debug

# Run with debug logging using environment variable
LOG_LEVEL=debug npm run pr-timeline -- 221010

# Run with minimal logging (errors and warnings only)
LOG_LEVEL=warn npm run pr-timeline -- 221010

# Combine CLI options
npm run pr-timeline -- 221010 --debug --open
```

## CLI Debug Flag

The `--debug` (or `-d`) flag provides a convenient way to enable debug logging without setting environment variables:

```bash
# Enable debug logging for a single run
npm run pr-timeline -- 221010 --debug

# Short form
npm run pr-timeline -- 221010 -d
```

**Note**: When using npm scripts, you need to use `--` to pass arguments through to the underlying script.

## Log Format

Logs are formatted as:

```
YYYY-MM-DD HH:mm:ss [LEVEL]: message {metadata}
```

Example:

```
2025-09-22 15:01:14 [INFO]: Generating Gantt chart visualization {"prNumber":221010}
2025-09-22 15:01:15 [WARN]: Could not fetch PR-level check runs {"error":"No commit found for SHA: controls/options-list/select-deselect-all"}
```

## Structured Logging

The application uses structured logging with contextual metadata for better searchability and debugging:

- **User actions**: Include relevant IDs (PR numbers, user names)
- **API calls**: Include URLs, response codes, timing
- **Errors**: Include error messages and stack traces
- **Performance**: Include counts, durations, file sizes

This makes it easy to filter and search logs in production environments.
