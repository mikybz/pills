import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  output: "standalone",
  // Version-skew protection: a client-side navigation that reaches a newer build does
  // a full reload. From the build-time version (Dockerfile); Next allows no dots.
  deploymentId: process.env.NEXT_PUBLIC_APP_VERSION?.replaceAll(".", "-"),
  async headers() {
    return [
      {
        // Always fetch a fresh service worker so notification handlers update.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
