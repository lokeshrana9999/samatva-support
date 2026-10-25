import type { NextConfig } from "next";

// cacheComponents stays off: every page here reads the auth cookie, so the
// request-time model is simpler and nothing is worth prerendering yet.
const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
