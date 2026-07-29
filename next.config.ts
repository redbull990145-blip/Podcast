import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    // Podcast artwork comes from arbitrary third-party hosts (Libsyn, Megaphone,
    // Simplecast, self-hosted feeds...). We cannot enumerate them, so allow any
    // https host but keep optimization on.
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
};

export default nextConfig;
