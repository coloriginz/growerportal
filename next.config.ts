import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfjs-dist", "pdfmake"],
  outputFileTracingIncludes: {
    "/api/fust/vouchers": ["./node_modules/pdfjs-dist/**/*"],
    "/api/fust/grower-invoices": ["./node_modules/pdfmake/**/*"],
    "/api/fust/grower-invoices/preview": ["./node_modules/pdfmake/**/*"],
  },
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
