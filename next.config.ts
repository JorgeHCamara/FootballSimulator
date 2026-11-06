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
    "/*/*/team/**": ["./src/assets/fonts/**/*"],
    "/*/*/match/**": ["./src/assets/fonts/**/*"],
    // Odds reports read the snapshots at run time (src/lib/oddsReports.ts), as do the league pages' links to them and the sitemap.
    "/*/*/odds": ["./src/assets/fonts/**/*", "./src/data/snapshots/**/*"],
    "/*/*/odds/**": ["./src/assets/fonts/**/*", "./src/data/snapshots/**/*"],
    "/*/odds": ["./src/data/snapshots/**/*"],
    "/*/*": ["./src/data/snapshots/**/*"],
    "/sitemap.xml": ["./src/data/snapshots/**/*"],
    // Leagues whose ratings use xG read it at run time (src/lib/xgStore.ts), on every page that builds their model.
    // Série C's crests are the site's own files: the card images read them from disk (crestDataUri).
    "/**": ["./src/data/xg/**/*", "./public/crests/serie-c/**/*"],
  },
  experimental: {
    // Generate all pages in one worker so each league is fetched once per build
    // (see getLeagueData), keeping deploys under the API's 10 requests/minute.
    staticGenerationMinPagesPerWorker: 100,
  },
};

export default withNextIntl(nextConfig);
