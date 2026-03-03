/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "cdn.dsmcdn.com" },      // Trendyol
      { protocol: "https", hostname: "productimages.hepsiburada.net" }, // Hepsiburada
      { protocol: "https", hostname: "m.media-amazon.com" },  // Amazon
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
};

module.exports = nextConfig;
