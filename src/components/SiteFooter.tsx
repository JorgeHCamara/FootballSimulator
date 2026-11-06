import { useTranslations } from "next-intl";
import { COMPETITIONS } from "../config/competitions.ts";
import { Link } from "../i18n/navigation.ts";
import { Flag } from "./Flag.tsx";

export function SiteFooter() {
  const t = useTranslations("Footer");
  const seo = useTranslations("Seo");
  return (
    <footer className="mt-16 border-t border-zinc-200 py-8 text-xs text-zinc-500 dark:border-zinc-800">
      <div className="mx-auto max-w-6xl px-4">
        <nav aria-label={seo("otherLeagues")}>
          <ul className="flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm">
            {COMPETITIONS.map((l) => (
              <li key={l.code}>
                <Link href={`/${l.slug}`} className="flex items-center gap-1.5 text-zinc-600 hover:text-pitch-700 dark:text-zinc-400 dark:hover:text-pitch-100">
                  <Flag code={l.flag} width={16} />
                  {l.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <ul className="mt-6 flex justify-center gap-x-5 text-sm" data-testid="site-links">
          {(["about", "privacy", "contact"] as const).map((page) => (
            <li key={page}>
              <Link href={`/${page}`} className="text-zinc-600 hover:text-pitch-700 hover:underline dark:text-zinc-400 dark:hover:text-pitch-100">
                {t(page)}
              </Link>
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
