import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /* config options here */
  // 允许开发服务器在所有域名下访问（生产环境不影响）
  allowedDevOrigins: ['*'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
