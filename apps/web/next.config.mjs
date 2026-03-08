/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  serverExternalPackages: ['playwright', 'better-sqlite3', 'geoip-lite', 'cron'],
  experimental: {
    instrumentationHook: true,
  },
};

export default nextConfig;
