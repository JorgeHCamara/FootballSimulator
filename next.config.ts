import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { tracingExcludes, tracingIncludes } from "./src/config/fileTracing.ts";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Leaves room for the football-data.org rate-limit wait (up to ~65s, twice)
  // when many league pages are generated at once during a build.
  staticPageGenerationTimeout: 180,
  // Files the server functions read from disk at run time, each route only its own (src/config/fileTracing.ts):
  // Past Winners' history, the odds snapshots, the stored xG, the card images' fonts and the site's own crests.
  outputFileTracingIncludes: tracingIncludes(),
  // …and the card images' files out of the pages that only import a card's module (its size, for their metadata).
  outputFileTracingExcludes: tracingExcludes(),
  experimental: {
    // Generate all pages in one worker so each league is fetched once per build
    // (see getLeagueData), keeping deploys under the API's 10 requests/minute.
    staticGenerationMinPagesPerWorker: 100,
  },
};

export default withNextIntl(nextConfig);
