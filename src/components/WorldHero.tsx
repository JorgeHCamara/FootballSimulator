import { getTranslations } from "next-intl/server";
import { HOW_STEPS, worldFacts } from "../lib/worldHero.ts";
import { Icon } from "./Icon.tsx";
import { WorldHeroCta } from "./WorldHeroCta.tsx";

/*
 * My World's hero, in the home page's style (.site-hero in globals.css): a
 * pill badge, the page's one H1, the intro, a button to the game below, a
 * facts line counted from the config (so it never names a league), and a
 * glass card with how a world is played. All server-rendered but the
 * button's label, which follows the browser's saved world.
 */
export async function WorldHero() {
  const t = await getTranslations("World");
  const facts = worldFacts();
  return (
    <section className="site-hero relative -mx-4 -mt-6 overflow-hidden text-white sm:mx-0 sm:mt-0 sm:rounded-3xl sm:ring-1 sm:ring-white/10" data-testid="world-hero">
      <div className="relative mx-auto max-w-[40rem] px-5 pt-10 pb-8 sm:px-8 sm:py-14 lg:grid lg:max-w-none lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-center lg:gap-12 lg:px-12 lg:py-20">
        <div>
          <p className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-300" data-testid="world-hero-badge">
            <Icon name="globe" size={14} className="shrink-0" />
            {t("hero.badge")}
          </p>
          <h1 className="site-hero-title mt-4 font-extrabold tracking-tight text-pretty text-white">{t("title")}</h1>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-zinc-300 text-pretty sm:text-base lg:text-lg" data-testid="world-hero-intro">
            {t("intro")}
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <WorldHeroCta start={t("hero.start")} resume={t("hero.continue")} />
          </div>
          {/* Two groups, each on its own line on phones; a dot stays with the item before it, so none ever starts a line. */}
          <p className="mt-5 grid gap-y-1 text-xs text-zinc-400 sm:flex sm:flex-wrap sm:gap-x-1.5" data-testid="world-hero-facts">
            <span className="flex flex-wrap gap-x-1.5 gap-y-1 min-[360px]:flex-nowrap">
              <span className="whitespace-nowrap">
                {t("hero.countries", { count: facts.countries })}
                <span aria-hidden> ·</span>
              </span>
              <span className="whitespace-nowrap">
                {t("hero.leagues", { count: facts.leagues })}
                <span aria-hidden> ·</span>
              </span>
              <span className="whitespace-nowrap">
                {t("hero.cups", { count: facts.cups })}
                <span className="hidden sm:inline" aria-hidden>
                  {" "}
                  ·
                </span>
              </span>
            </span>
            <span className="flex gap-x-1.5 whitespace-nowrap">
              <span>
                {t("hero.saved")}
                <span aria-hidden> ·</span>
              </span>
              <span>{t("hero.noSignup")}</span>
            </span>
          </p>
        </div>
        <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.06] p-4 shadow-2xl shadow-black/40 backdrop-blur-md sm:p-5 lg:mt-0" data-testid="world-hero-how">
          <h2 className="text-sm font-bold text-white">{t("how.title")}</h2>
          <ol className="mt-3 space-y-3">
            {HOW_STEPS.map((step, i) => (
              <li key={step.key} className="flex items-start gap-3" data-testid="world-hero-step">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-400/15 text-emerald-300" aria-hidden>
                  <Icon name={step.icon} size={16} />
                </span>
                <span className="min-w-0 text-sm leading-relaxed text-zinc-300">
                  <span className="mr-1.5 text-xs font-bold tabular-nums text-zinc-500">{i + 1}</span>
                  {t(`how.${step.key}`)}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
