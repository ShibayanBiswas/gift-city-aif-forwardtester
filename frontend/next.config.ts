import type { NextConfig } from "next";

/**
 * Local default → http://127.0.0.1:8000
 * Vercel: set BACKEND_URL = https://YOUR-RENDER-SERVICE.onrender.com
 * (no trailing slash)
 */
const backend = (process.env.BACKEND_URL || "http://127.0.0.1:8000").replace(/\/$/, "");

const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${backend}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
