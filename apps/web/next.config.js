const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      { source: "/sign-in", destination: "/login", permanent: false },
      { source: "/sign-up", destination: "/register", permanent: false },
    ];
  },
  turbopack: {
    root: path.join(__dirname, "../.."),
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "cdn.dsmcdn.com" },      // Trendyol
      { protocol: "https", hostname: "productimages.hepsiburada.net" }, // Hepsiburada
      { protocol: "https", hostname: "m.media-amazon.com" },  // Amazon
    ],
  },
  eslint: {
    // Linting is handled in CI via eslint directly; skip during next build
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Type checking is handled in CI via tsc; skip during next build to avoid
    // errors from devDependency-only files (vitest.config.ts etc.)
    ignoreBuildErrors: true,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
};

module.exports = nextConfig;
