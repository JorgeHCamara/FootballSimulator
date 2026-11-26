import { hasLocale } from "next-intl";
import { notFound } from "next/navigation";
import { routing, type Locale } from "../i18n/routing.ts";
import { perfLog } from "./perfLog.ts";

/*
 * An address whose first segment isn't a language (/favicon.ico, /llms.txt,
 * /wp-login.php, /xmlrpc.php: files the proxy leaves alone, see src/proxy.ts)
 * still matches /[locale]. Checked first, before any data is read: a 404
 * (Next's not-found, kept by the CDN as /en/<unknown> is), and one [perf]
 * line with the path only. Without it the page ran on with a language it
 * doesn't have, failed, and answered 500 with a stack in the logs.
 */
export function requireLocale(locale: string): asserts locale is Locale {
  if (hasLocale(routing.locales, locale)) return;
  perfLog({ op: "not-a-locale", key: `/${locale}`, ms: 0, cache: "miss", status: 404 });
  notFound();
}
