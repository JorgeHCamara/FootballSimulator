import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { LEAGUES } from "../../config/leagues.ts";
import { Link } from "../../i18n/navigation.ts";

const FLAGS: Record<string, string> = { PL: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", PD: "🇪🇸", BL1: "🇩🇪", SA: "🇮🇹", FL1: "🇫🇷", BSA: "🇧🇷" };

export default function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);
  const t = useTranslations("Home");

  const features = [
    { icon: "✍️", title: t("featurePredictTitle"), body: t("featurePredictBody") },
    { icon: "🎲", title: t("featureSimulateTitle"), body: t("featureSimulateBody") },
    { icon: "📊", title: t("featureChancesTitle"), body: t("featureChancesBody") },
  ];

  return (
    <div className="space-y-10">
      <section className="pt-4 text-center">
        <h1 className="text-3xl font-extrabold tracking-tight text-balance sm:text-4xl">{t("heading")}</h1>
        <p className="mx-auto mt-3 max-w-2xl text-zinc-600 text-pretty dark:text-zinc-400">{t("subheading")}</p>
      </section>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {LEAGUES.map((l) => (
          <li key={l.code}>
            <Link
              href={`/${l.slug}`}
              className="group flex items-center gap-4 rounded-xl border border-zinc-200 bg-white p-4 transition hover:border-pitch-500 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
            >
              <span className="text-3xl" aria-hidden>
                {FLAGS[l.code]}
              </span>
              <span className="flex-1">
                <span className="block font-bold">{l.name}</span>
                <span className="text-xs text-zinc-500">{t("teams", { count: l.teams })}</span>
              </span>
              <span className="rounded-lg bg-pitch-600 px-3 py-1.5 text-sm font-semibold text-white group-hover:bg-pitch-700">
                {t("open")}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <ul className="grid gap-4 sm:grid-cols-3">
        {features.map((f) => (
          <li key={f.title} className="rounded-xl bg-pitch-50 p-4 dark:bg-pitch-900/30">
            <span className="text-2xl" aria-hidden>
              {f.icon}
            </span>
            <h2 className="mt-2 font-bold">{f.title}</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{f.body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
