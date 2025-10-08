import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load environment variables from the monorepo root
dotenv.config({ path: path.resolve(__dirname, '../..', '.env') });

/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['winston'],
  turbopack: {
    root: path.resolve(__dirname, '../..'),
  },
  env: {
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  },
};

export default nextConfig;
