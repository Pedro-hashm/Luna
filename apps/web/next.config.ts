import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));

const nextConfig: NextConfig = {
  experimental: {
    // Local Qwen responses can take longer than Next's 30s proxy default.
    proxyTimeout: 120_000,
  },
  turbopack: {
    root: workspaceRoot,
  },
  async rewrites() {
    const apiUrl = (process.env.API_URL ?? "http://localhost:8000").replace(/\/$/u, "");

    return [
      {
        source: "/api/:path*",
        destination: `${apiUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
