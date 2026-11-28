import { useTranslations } from "next-intl";
import { COMPETITIONS } from "../config/competitions.ts";
import { flagSpriteUrl } from "../lib/flagSprite.tsx";
import { SITE_PAGES, type SitePage } from "../lib/site.ts";
import { FooterLeagues, type FooterLeague } from "./FooterLeagues.tsx";
import { IntentLink } from "./IntentLink.tsx";

/** Each site page's label in the Footer messages. */
const LABELS = { about: "about", "how-it-works": "howItWorks", privacy: "privacy", contact: "contact" } as const satisfies Record<SitePage, string>;

export function SiteFooter() {
  const t = useTranslations("Footer");
  const seo = useTranslations("Seo");
  return (
    <footer className="mt-16 border-t border-zinc-200 py-8 text-xs text-zinc-500 dark:border-zinc-800">
      <div className="mx-auto max-w-6xl px-4">
        <nav aria-label={seo("otherLeagues")}>
          <FooterLeagues leagues={COMPETITIONS.map((l): FooterLeague => [l.code, l.slug, l.name, l.flag])} sprite={flagSpriteUrl()} />
        </nav>
        <ul className="mt-6 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm" data-testid="site-links">
          {SITE_PAGES.map((page) => (
            <li key={page}>
              <IntentLink href={`/${page}`} className="text-zinc-600 hover:text-pitch-700 hover:underline dark:text-zinc-400 dark:hover:text-pitch-100">
                {t(LABELS[page])}
              </IntentLink>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-center">{t("disclaimer")}</p>
        <p className="mt-1 text-center text-[11px] text-zinc-400 dark:text-zinc-500">
          © {new Date().getFullYear()} FootSimu ·{" "}
          <a href="https://www.football-data.org/" className="hover:text-zinc-600 hover:underline dark:hover:text-zinc-300" rel="noopener">
            {t("attribution")}
          </a>{" "}
          ·{" "}
          <a href="https://www.thesportsdb.com/" className="hover:text-zinc-600 hover:underline dark:hover:text-zinc-300" rel="noopener">
            {t("crestCredit")}
          </a>
        </p>
      </div>
    </footer>
  );
}
