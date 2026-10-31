import { useTranslations } from "next-intl";

export function SiteFooter() {
  const t = useTranslations("Footer");
  return (
    <footer className="mt-16 border-t border-zinc-200 py-6 text-center text-xs text-zinc-500 dark:border-zinc-800">
      <p>
        <a href="https://www.football-data.org/" className="underline hover:text-zinc-700 dark:hover:text-zinc-300" rel="noopener">
          {t("attribution")}
        </a>
      </p>
      <p className="mt-1">{t("disclaimer")}</p>
    </footer>
  );
}
