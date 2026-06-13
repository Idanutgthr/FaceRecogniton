/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        fs: false,
        canvas: false,
        path: false,
        os: false,
      };
    }
    return config;
  },
};

export default nextConfig;
