import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: ["@remixicon/react", "recharts", "date-fns"],
  },
  webpack: (config) => {
    config.watchOptions = {
      ...config.watchOptions,
      ignored: [
        "**/node_modules/**",
        "**/src/generated/**",
        "**/.next/**",
      ],
      poll: false,
      aggregateTimeout: 1000,
    };
    // Reduce memory: disable persistent caching in dev
    config.cache = {
      type: "memory",
    };
    return config;
  },
};

export default nextConfig;
