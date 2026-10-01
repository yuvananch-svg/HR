import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  env: {
    NEXT_PUBLIC_VERCEL_ENV: process.env.VERCEL_ENV ?? "local",
  },
};

export default nextConfig;
