/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['winston'],
  transpilePackages: ['wx-react-gantt'],
  env: {
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  },
};

module.exports = nextConfig;
