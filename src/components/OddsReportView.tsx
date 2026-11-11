import { getTranslations } from "next-intl/server";
import type { SiteLocale } from "../config/leagues.ts";
import type { TeamId } from "../engine/types.ts";
import { Link } from "../i18n/navigation.ts";
import { IntentLink } from "./IntentLink.tsx";
import { percent } from "../lib/clubText.ts";
import { matchPath, matchSlug } from "../lib/matchSlug.ts";
import type { LoadedReport } from "../lib/oddsPage.ts";
import { clubGames, latestReportPath, moversCardSections, reportPath, resultOfRound, type Category, type Change } from "../lib/oddsReports.ts";
import { dateLocale, reportText, type Translate } from "../lib/oddsText.ts";
import { HREFLANG, SITE_NAME, SITE_URL } from "../lib/site.ts";
import { Flag } from "./Flag.tsx";
import { Icon } from "./Icon.tsx";
import { JsonLd } from "./JsonLd.tsx";
import { RaceChart } from "./RaceChart.tsx";
import { ShareCardBlock } from "./ShareCardBlock.tsx";
import { ShareMenu } from "./ShareMenu.tsx";
import { TeamBadge } from "./TeamBadge.tsx";
import { zoneHex } from "./zones.ts";

const card = "rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900";

/** One league's "what changed" report for a round: movers, every club's chances, the round's key game, the race so far. */
export async function OddsReportView({ loaded, locale }: { loaded: LoadedReport; locale: string }) {
  const lang = (["en", "pt", "es"].includes(locale) ? locale : "en") as SiteLocale;
  const { report, games, teams, league, latest } = loaded;
  const { t, round, season, h1, topic, race, leader, name, count, description } = await reportText(loaded, lang);
  const seo = (await getTranslations({ locale: lang, namespace: "Seo" })) as unknown as Translate;
  const pct = (share: number) => percent(share, lang);
  const previousRound = report.previous ? t("round", { n: report.previous.round }) : undefined;
  const perClub = clubGames(games);
  const path = latest ? latestReportPath(league) : reportPath(league, report.snapshot.round);
  const pageUrl = `${SITE_URL}/${locale}${path}`;
  const leaguePath = `/${league.slug}`;
  const date = new Intl.DateTimeFormat(dateLocale(lang), { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${report.snapshot.date}T12:00:00Z`));

  const clubLink = (id: TeamId, label = name(id)) => {
    const page = teams.get(id)?.page;
    return page ? (
      <IntentLink href={page} className="hover:underline">
        {label}
      </IntentLink>
    ) : (
      <span>{label}</span>
    );
  };

  /** A sentence about one club's change: its result in the round, when it had one. */
  const sentence = (c: Change, category: Category) => {
    const up = (c.delta ?? 0) > 0;
    const values = { club: name(c.teamId), topic: topic(category), from: pct(c.before ?? 0), to: pct(c.now) };
    const own = perClub.get(c.teamId) ?? [];
    if (own.length === 1) {
      const g = own[0]!;
      const outcome = g.goalsFor > g.goalsAgainst ? "win" : g.goalsFor === g.goalsAgainst ? "draw" : "loss";
      const score = `${Math.max(g.goalsFor, g.goalsAgainst)}–${Math.min(g.goalsFor, g.goalsAgainst)}`;
      const result = t(`result.${outcome}${g.home ? "Home" : "Away"}`, { opponent: name(g.opponentId), score });
      return t(up ? "rise" : "fall", { ...values, result });
    }
    if (own.length === 0 && games.length) return t(up ? "riseIdle" : "fallIdle", values);
    return t(up ? "riseOther" : "fallOther", values);
  };
  const leaderSentence = leader ? t("leader", { club: name(leader.teamId), race: race(report.lead), pct: pct(leader.values[report.lead.kind]!.now) }) : "";

  // The round's key game, and each of its clubs' biggest change.
  const key = report.previous ? resultOfRound(report, games) : undefined;
  const keyHref = (() => {
    if (!key) return undefined;
    const slug = matchSlug(league, key.fixture, teams.get(key.fixture.homeId), teams.get(key.fixture.awayId));
    return slug ? matchPath(league, slug) : undefined;
  })();
  const biggest = (id: TeamId) => {
    const row = report.rows.find((r) => r.teamId === id);
    const pick = report.categories
      .map((c) => ({ c, change: row?.values[c.kind] }))
      .filter((x) => x.change?.delta)
      .sort((a, b) => Math.abs(b.change!.delta!) - Math.abs(a.change!.delta!))[0];
    return pick ? sentence(pick.change!, pick.c) : undefined;
  };
  const keyScore = key ? `${key.fixture.result!.home}–${key.fixture.result!.away}` : "";
  const keyLead = key ? t("resultLead", { home: name(key.fixture.homeId), away: name(key.fixture.awayId), score: keyScore }) : "";
  const summary = [leaderSentence, keyLead].filter(Boolean).join(" ");

  const delta = (c: Change | undefined, category: Category, size: "sm" | "xs" = "xs") => {
    if (c?.delta === undefined) return null;
    const text = size === "sm" ? "text-sm" : "text-xs";
    if (c.delta === 0) return <span className={`${text} tabular-nums text-zinc-400`}>±0</span>;
    // Up is good, except for relegation.
    const good = category.kind === "relegation" ? c.delta < 0 : c.delta > 0;
    return (
      <span className={`inline-flex items-center gap-0.5 ${text} font-semibold tabular-nums ${good ? "text-pitch-700 dark:text-pitch-300" : "text-red-600 dark:text-red-400"}`}>
        <Icon name={c.delta > 0 ? "trending-up" : "trending-down"} size={size === "sm" ? 14 : 12} strokeWidth={2.5} />
        {t("deltaPoints", { sign: c.delta > 0 ? "+" : "−", n: Math.abs(c.delta) })}
      </span>
    );
  };
  const categoryName = (c: Category) => (c.kind === "continental" ? topic(c) : t(`category.${c.kind}`));
  const shortNames = (await getTranslations({ locale: lang, namespace: "Odds" })).raw("short") as Record<string, string>;
  const phoneName = (c: Category) => shortNames[c.zone] ?? categoryName(c);
  const shareProps = {
    path: `/${locale}${path}`,
    imagePath: `/${locale}${path}/opengraph-image`,
    title: t("shareTitle", { h1 }),
    text: t("shareText", { round }),
    league: league.code,
    imageName: `footsimu-${league.slug}-matchday-${report.snapshot.round}.png`,
    content: "report",
  };

  const roundPath = `/${locale}${reportPath(league, report.snapshot.round)}`;
  const moversShare = moversCardSections(report).length
    ? {
        path: roundPath,
        imagePath: `${roundPath}/movers-image`,
        title: t("moversCardAlt", { league: league.name, round }),
        text: t("shareText", { round }),
        league: league.code,
        imageName: `footsimu-${league.slug}-matchday-${report.snapshot.round}-movers.png`,
        content: "movers",
      }
    : undefined;

  return (
    <div className="space-y-6" data-testid="odds-report" data-round={report.snapshot.round}>
      <JsonLd
        data={[
          {
            "@type": "Article",
            headline: h1,
            description,
            datePublished: report.snapshot.date,
            dateModified: report.snapshot.date,
            inLanguage: HREFLANG[locale],
            url: pageUrl,
            mainEntityOfPage: pageUrl,
            image: `${pageUrl}/opengraph-image`,
            author: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
            publisher: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
            about: { "@type": "SportsOrganization", name: league.name, sport: "Soccer", url: `${SITE_URL}/${locale}${leaguePath}` },
          },
          {
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: seo("breadcrumbHome"), item: `${SITE_URL}/${locale}` },
              { "@type": "ListItem", position: 2, name: league.simulatorName[lang], item: `${SITE_URL}/${locale}${leaguePath}` },
              { "@type": "ListItem", position: 3, name: h1, item: pageUrl },
            ],
          },
        ]}
      />

      <nav aria-label={seo("breadcrumb")} className="flex min-w-0 items-center text-xs text-zinc-500">
        <Link href="/" className="shrink-0 hover:underline">
          {seo("breadcrumbHome")}
        </Link>
        <Icon name="chevron-right" size={12} className="mx-1 shrink-0" />
        <Link href={leaguePath} className="truncate hover:underline">
          {league.simulatorName[lang]}
        </Link>
        <Icon name="chevron-right" size={12} className="mx-1 shrink-0" />
        <span className="truncate">{round}</span>
      </nav>

      <header className="space-y-3">
        <Link
          href={leaguePath}
          className="inline-flex max-w-full items-center gap-2 rounded-full bg-pitch-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-pitch-700 hover:bg-pitch-100 dark:bg-pitch-900/40 dark:text-pitch-100"
        >
          <Flag code={league.flag} width={18} />
          <span className="truncate">
            {league.name} {season}
          </span>
        </Link>
        <h1 className="text-2xl font-extrabold tracking-tight break-words sm:text-3xl">{h1}</h1>
        <p className="flex items-center gap-1.5 text-sm text-zinc-600 dark:text-zinc-400">
          <Icon name="calendar-days" size={16} className="shrink-0" />
          {t("asOf", { date })}
          {latest && <span className="ml-1 rounded-full bg-pitch-600 px-2 py-0.5 text-[11px] font-bold text-white">{t("latest")}</span>}
        </p>
        {summary && (
          <p className="max-w-3xl text-sm leading-relaxed text-zinc-700 dark:text-zinc-300" data-testid="odds-summary">
            {summary}
          </p>
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Link href={leaguePath} className="flex h-11 items-center justify-center gap-2 rounded-lg bg-pitch-600 px-4 text-sm font-semibold text-white hover:bg-pitch-700" data-testid="odds-simulate">
            <Icon name="dices" size={18} />
            {t("simulate")}
          </Link>
          <div className="hidden sm:block">
            <ShareMenu {...shareProps} variant="inline" />
          </div>
          <div className="sm:hidden">
            <ShareMenu {...shareProps} variant="bar" />
          </div>
        </div>
      </header>

      <section className="space-y-3" data-testid="odds-movers">
        <h2 className="text-xl font-bold tracking-tight">{t("moversTitle")}</h2>
        {!report.previous ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{t("firstReport")}</p>
        ) : report.modelChange ? (
          // The previous report is another model's: its chances aren't comparable with these.
          <div className={`${card} flex gap-3`} data-testid="odds-model-change">
            <Icon name="info" size={20} className="mt-0.5 shrink-0 text-pitch-700 dark:text-pitch-300" />
            <div className="space-y-1">
              <p className="text-sm font-semibold">{t("modelChangeTitle")}</p>
              <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{t("modelChange", { previous: previousRound ?? "" })}</p>
            </div>
          </div>
        ) : (
          <>
            <div className="grid gap-3 lg:grid-cols-3">
              {report.movers.map((m) => {
                const sentences = [m.up[0] && sentence(m.up[0], m.category), m.down[0] && sentence(m.down[0], m.category)].filter(Boolean);
                const list = (changes: Change[], dir: "up" | "down") => (
                  <div className="min-w-0">
                    <p className="mb-1 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-zinc-500">
                      <Icon name={dir === "up" ? "trending-up" : "trending-down"} size={14} />
                      {t(dir)}
                    </p>
                    {changes.length ? (
                      <ul className="space-y-1.5">
                        {changes.map((c) => {
                          const team = teams.get(c.teamId);
                          return (
                            <li key={c.teamId} className="flex items-center gap-2 text-sm" data-testid="odds-mover">
                              {team && <TeamBadge team={team} size={18} />}
                              <span className="min-w-0 flex-1 truncate font-medium">{clubLink(c.teamId)}</span>
                              <span className="shrink-0 text-right">
                                <span className="flex items-center justify-end gap-0.5 text-xs tabular-nums text-zinc-500">
                                  {pct(c.before ?? 0)}
                                  <Icon name="arrow-right" size={11} className="shrink-0" />
                                  <span className="font-semibold text-zinc-800 dark:text-zinc-200">{pct(c.now)}</span>
                                </span>
                                {delta(c, m.category)}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="text-xs text-zinc-500">–</p>
                    )}
                  </div>
                );
                return (
                  <div key={m.category.kind} className={card} data-testid="odds-category" data-kind={m.category.kind}>
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-bold">
                      <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: zoneHex(m.category.zone) }} />
                      {categoryName(m.category)}
                    </h3>
                    {/* Up, then down: each club's name with room to show in full. */}
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
                      {list(m.up, "up")}
                      {list(m.down, "down")}
                    </div>
                    <p className="mt-3 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400" data-testid="odds-sentences">
                      {sentences.length ? sentences.join(" ") : t("noMoves")}
                      {m.category.kind === report.lead.kind && leaderSentence ? ` ${leaderSentence}` : ""}
                    </p>
                  </div>
                );
              })}
            </div>
            {previousRound && <p className="text-xs text-zinc-500">{t("moversNote", { round: previousRound })}</p>}
            {/* The round's biggest-movers card (cached by its round), to share or download. */}
            {moversShare && (
              <ShareCardBlock
                title={t("moversShareTitle")}
                body={t("moversShareBody")}
                alt={t("moversCardAlt", { league: league.name, round })}
                share={moversShare}
                testId="odds-movers-share"
              />
            )}
          </>
        )}
      </section>

      {report.previous && !report.modelChange && (
        <section className="space-y-3" data-testid="odds-result">
          <h2 className="text-xl font-bold tracking-tight">{t("resultTitle")}</h2>
          <div className={card}>
            {key ? (
              <>
                {/* Name, crest, score, crest, name. */}
                <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
                  <span className="flex min-w-0 items-center justify-end gap-2 text-right">
                    <span className="min-w-0 break-words text-sm font-bold sm:text-base">{clubLink(key.fixture.homeId, teams.get(key.fixture.homeId)?.name ?? "")}</span>
                    {teams.get(key.fixture.homeId) && <TeamBadge team={teams.get(key.fixture.homeId)!} size={28} />}
                  </span>
                  <span className="rounded-lg bg-zinc-100 px-3 py-1.5 text-xl font-extrabold tabular-nums dark:bg-zinc-800" data-testid="odds-result-score">
                    {keyScore}
                  </span>
                  <span className="flex min-w-0 items-center gap-2">
                    {teams.get(key.fixture.awayId) && <TeamBadge team={teams.get(key.fixture.awayId)!} size={28} />}
                    <span className="min-w-0 break-words text-sm font-bold sm:text-base">{clubLink(key.fixture.awayId, teams.get(key.fixture.awayId)?.name ?? "")}</span>
                  </span>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
                  {[keyLead, biggest(key.fixture.homeId), biggest(key.fixture.awayId)].filter(Boolean).join(" ")}
                </p>
                {keyHref && (
                  <IntentLink href={keyHref} className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-pitch-700 hover:underline dark:text-pitch-300" data-testid="odds-result-link">
                    <Icon name="chart-column" size={16} />
                    {t("matchPreview")}
                  </IntentLink>
                )}
                <p className="mt-2 text-xs text-zinc-500">{t("resultNote")}</p>
              </>
            ) : (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">{t("resultNone")}</p>
            )}
          </div>
        </section>
      )}

      <section className="space-y-3" data-testid="odds-race">
        <h2 className="text-xl font-bold tracking-tight">{t("chartTitle", { race: race(report.lead) })}</h2>
        <div className={card}>
          <RaceChart
            rounds={report.race.rounds}
            series={report.race.series.map((s) => ({ name: name(s.teamId), values: s.values }))}
            locale={lang}
            modelChanges={report.race.modelChanges}
            labels={{ round: t("chartRound"), table: t("chartTable"), caption: t("chartNote", { topic: topic(report.lead) }), modelChange: t("chartModelChange") }}
          />
          <p className="mt-3 text-xs text-zinc-500">
            {t("chartNote", { topic: topic(report.lead) })}
            {report.race.modelChanges.length ? ` ${t("chartModelNote", { round: t("round", { n: report.race.modelChanges.at(-1)! }) })}` : ""}
          </p>
        </div>
      </section>

      <section className="space-y-3" data-testid="odds-table">
        <h2 className="text-xl font-bold tracking-tight">{t("tableTitle")}</h2>
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <table className="w-full table-fixed text-sm">
            <thead className="bg-zinc-100 text-xs text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300">
              <tr>
                <th className="w-8 py-2 pl-3 text-left">{t("position")}</th>
                <th className="py-2 pl-1 text-left">{t("club")}</th>
                <th className="hidden w-12 py-2 text-right sm:table-cell">{t("points")}</th>
                {report.categories.map((c) => (
                  <th key={c.kind} className="w-[4.75rem] py-2 pr-2 text-right align-bottom sm:w-28 sm:pr-3">
                    {/* Whole words only (two lines at most on phones): "Champions / League". */}
                    <span className="block text-[10px] leading-tight sm:text-xs" data-testid="odds-column" title={categoryName(c)}>
                      {/* Phones: a short name where the full one doesn't fit ("Rebaix.", "ACL Elite"). */}
                      <span className="sm:hidden">{phoneName(c)}</span>
                      <span className="hidden sm:inline">{categoryName(c)}</span>
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => {
                const team = teams.get(row.teamId);
                return (
                  <tr key={row.teamId} className="border-t border-zinc-200/70 dark:border-zinc-800" data-testid="odds-row">
                    <td className="py-2 pl-3 font-semibold tabular-nums text-zinc-600 dark:text-zinc-300">{row.position}</td>
                    <td className="py-2 pl-1">
                      <span className="flex min-w-0 items-center gap-2">
                        {team && <TeamBadge team={team} size={18} />}
                        <span className="truncate font-medium">
                          <span className="sm:hidden">{clubLink(row.teamId, team?.shortName ?? "")}</span>
                          <span className="hidden sm:inline">{clubLink(row.teamId, team?.name ?? "")}</span>
                        </span>
                      </span>
                    </td>
                    <td className="hidden py-2 text-right font-semibold tabular-nums sm:table-cell">{row.points}</td>
                    {report.categories.map((c) => {
                      const v = row.values[c.kind]!;
                      return (
                        <td key={c.kind} className="py-2 pr-2 text-right align-top sm:pr-3">
                          <span className="block font-semibold tabular-nums">{pct(v.now)}</span>
                          {delta(v, c)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-zinc-500">
          {previousRound && !report.modelChange ? t("tableNote", { round, count, previous: previousRound }) : t("tableNoteFirst", { round, count })}
        </p>
      </section>

      <section className="space-y-3" data-testid="odds-archive">
        <h2 className="text-xl font-bold tracking-tight">{t("archiveTitle")}</h2>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {[...report.all].reverse().map((s) => {
            const current = s.round === report.snapshot.round;
            const day = new Intl.DateTimeFormat(dateLocale(lang), { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${s.date}T12:00:00Z`));
            return (
              <li key={s.round}>
                <IntentLink
                  href={reportPath(league, s.round)}
                  aria-current={current ? "page" : undefined}
                  className={`flex flex-col rounded-lg border px-3 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 ${current ? "border-pitch-600 bg-pitch-50 dark:bg-pitch-900/30" : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"}`}
                >
                  <span className="font-semibold">{t("round", { n: s.round })}</span>
                  <span className="text-xs text-zinc-500">{day}</span>
                </IntentLink>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

