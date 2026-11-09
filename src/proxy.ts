import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing.ts";

export default createMiddleware(routing);

export const config = {
  // Only addresses without a language: "/" and old links such as "/premier-league", sent to their
  // language's address (the visitor's language, or English). Every page's address starts with its
  // language (localePrefix "always"), and every page and route sets its language itself
  // (setRequestLocale, or the locale from its params), so those addresses skip the proxy: on Vercel it
  // runs ahead of the cache, so it would be a function run for every page view and every link prefetch.
  // Also skipped: API routes, Next internals and files with an extension. The languages are listed by
  // hand (a matcher must be a literal); src/lib/proxyMatcher.test.ts checks them against routing.locales.
  matcher: "/((?!api|_next|_vercel|apple-icon|(?:en|pt|es)(?:/|$)|.*\\..*).*)",
};
