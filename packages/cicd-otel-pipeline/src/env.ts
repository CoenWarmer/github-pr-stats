// Load environment variables from root .env file
// This must be imported FIRST before any other modules
import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from project root (../../../.env from src/env.ts)
const envPath = resolve(__dirname, '../../../.env');
console.log(`[dotenv] Loading from: ${envPath}`);
const result = dotenvConfig({ path: envPath });
if (result.error) {
  console.error(`[dotenv] Error loading .env:`, result.error);
  console.error(`[dotenv] Make sure .env exists at project root`);
} else {
  console.log(
    `[dotenv] Loaded ${Object.keys(result.parsed || {}).length} variables`
  );
}
