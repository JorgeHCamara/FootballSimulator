import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Leaves room for the football-data.org rate-limit wait (up to ~65s, twice)
  // when many league pages are generated at once during a build.
  staticPageGenerationTimeout: 180,
};

export default withNextIntl(nextConfig);
