import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Leaves room for the football-data.org rate-limit wait (up to ~65s, twice)
  // when many league pages are generated at once during a build.
  staticPageGenerationTimeout: 180,
  // The share card reads Inter from src/assets/fonts (next/og needs the files).
  outputFileTracingIncludes: {
    "/*/*/share/**": ["./src/assets/fonts/**/*"],
  },
  experimental: {
    // Generate all pages in one worker so each league is fetched once per build
    // (see getLeagueData), keeping deploys under the API's 10 requests/minute.
    staticGenerationMinPagesPerWorker: 100,
  },
};

export default withNextIntl(nextConfig);
