import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Storefront product imagery is served from Shopify's CDN — required
    // for next/image to optimise remote images rather than refusing them.
    remotePatterns: [
      { protocol: "https", hostname: "cdn.shopify.com" },
    ],
  },
};

export default nextConfig;
