import type { SiteLocale } from "../config/leagues.ts";
import type { TeamId } from "../engine/types.ts";
import { isOpen, outcomeChance, outcomeRace, type Outcome, type RaceRow } from "./chancePages.ts";
import type { HeadlineChance, LeagueOutlook } from "./clubOutlook.ts";
import { clubStanding, type LoadedClub, type LoadedLeague } from "./clubPage.ts";
import { listOf, percent, placeRange } from "./clubText.ts";
import type { FaqItem } from "./site.ts";

/*
 * The words of the chance pages (src/lib/chancePages.ts), in the page's
 * language: headings, the lead, the FAQ. Pure, given the translators.
 */

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** The `Chances`, `Club` and `Zones` messages. */
export interface ChanceTranslators {
  t: Translate;
  tc: Translate;
  tz: Translate;
}

/** The messages' key for an outcome: the title as a play-off ("the MLS Cup") has its own words. */
export function outcomeKey(outcome: Outcome, headline: HeadlineChance | undefined): { key: string; name: string } {
  return outcome === "title" && headline?.kind === "playoffWin" ? { key: "titlePlayoff", name: headline.name ?? "" } : { key: outcome, name: "" };
}

/** A league's outcome key, from any of its clubs (they all have the same headline kinds). */
export function leagueOutcomeKey(outlook: Pick<LeagueOutlook, "clubs">, outcome: Outcome) {
  const first = [...outlook.clubs.values()].find((c) => outcomeChance(c, outcome));
  return outcomeKey(outcome, first && outcomeChance(first, outcome));
}

/** "{club} win the title in 64% of 10,000 simulated seasons." (the club page's own sentence, for one chance). */
function chanceSentence(club: string, h: HeadlineChance, count: string, lang: SiteLocale, { tc, tz }: ChanceTranslators) {
  return tc("summaryChances", { club, count, clauses: tc(`clause.${h.kind}`, { pct: percent(h.chance, lang), zone: tz(h.zone), name: h.name ?? "" }) });
}

/** The shared FAQ answers: how the chances are worked out, how often, and that they aren't betting odds. */
function commonFaq(league: string, count: string, key: string, name: string, { t }: ChanceTranslators): FaqItem[] {
  return [
    { q: t("faq.howQ"), a: t("faq.howA", { league, count, verb: t(`faq.verb.${key}`, { name }) }) },
    { q: t("faq.updateQ"), a: t("faq.updateA") },
    { q: t("faq.oddsQ"), a: t("faq.oddsA") },
  ];
}

export interface LeagueChanceText {
  h1: string;
  title: string;
  description: string;
  /** The race, likeliest first: every club with a chance, and how many more have none. */
  rows: RaceRow[];
  rest: number;
  lead: string;
  tableTitle: string;
  key: string;
  name: string;
  faq: FaqItem[];
}

/** A league's chance page: "Premier League 2026/27 title odds", the race, its FAQ. */
export function leagueChanceText(loaded: LoadedLeague, outcome: Outcome, lang: SiteLocale, names: (id: TeamId) => string, tr: ChanceTranslators): LeagueChanceText {
  const { t } = tr;
  const { league, outlook, season } = loaded;
  const { key, name } = leagueOutcomeKey(outlook, outcome);
  const count = new Intl.NumberFormat(lang).format(outlook.iterations);
  const values = { league: league.name, season, name };
  const h1 = t(`league.h1.${key}`, values);
  const race = outcomeRace(outlook, outcome);
  const rows = race.filter((r) => r.chance > 0);
  const leader = rows[0];
  const leaderHeadline = leader && outcomeChance(outlook.clubs.get(leader.teamId)!, outcome);
  const next = rows.slice(1, 3).map((r) => `${names(r.teamId)} (${percent(r.chance, lang)})`);
  const lead = outlook.complete
    ? t("league.complete", { season })
    : [leader && leaderHeadline ? chanceSentence(names(leader.teamId), leaderHeadline, count, lang, tr) : "", next.length ? t("league.next", { list: listOf(next, lang) }) : ""].filter(Boolean).join(" ");
  const question = t(`league.question.${key}`, values);
  const topic = t(`topic.${key}`, { name });
  return {
    h1,
    title: t("league.metaTitle", { h1 }),
    description: [question, lead, t("league.metaTail", { topic })].filter(Boolean).join(" "),
    rows,
    rest: race.length - rows.length,
    lead,
    tableTitle: t("league.tableTitle", { topic }),
    key,
    name,
    faq: [{ q: question, a: lead }, ...commonFaq(league.name, count, key, name, tr)],
  };
}

export interface ClubChanceText {
  h1: string;
  description: string;
  /** "Title chance", and the chance ("64%"). */
  label: string;
  pct: string;
  /** Where it stands, its chance of this, its likely finish. */
  lead: string[];
  key: string;
  name: string;
  /** Search engines get the page while the outcome is still open for the club (see isOpen). */
  indexable: boolean;
  faq: FaqItem[];
}

/** A club's chance page: "Arsenal's chances of winning the Premier League 2026/27", its FAQ. Undefined when the league has no such outcome. */
export function clubChanceText(loaded: LoadedClub, outcome: Outcome, lang: SiteLocale, tr: ChanceTranslators): ClubChanceText | undefined {
  const { t, tc } = tr;
  const { league, outlook, club, team, season } = loaded;
  const h = outcomeChance(club, outcome);
  if (!h) return undefined;
  const { key, name } = outcomeKey(outcome, h);
  const count = new Intl.NumberFormat(lang).format(outlook.iterations);
  const values = { club: team.name, league: league.name, season, name };
  const label = t(`chanceLabel.${key}`, { name });
  const pct = percent(h.chance, lang);
  const standing = clubStanding(loaded, lang, tc);
  const chance = outlook.complete ? "" : chanceSentence(team.shortName, h, count, lang, tr);
  const likely = outlook.complete
    ? ""
    : tc("summaryLikeliest", { range: placeRange(club.likelyRange.from, club.likelyRange.to, lang), pct: percent(club.likelyRange.chance, lang), avgPoints: Math.round(club.averagePoints) });
  const lead = [standing, chance, likely].filter(Boolean);
  return {
    h1: t(`club.h1.${key}`, values),
    description: t("club.metaDescription", { ...values, label, pct, count }),
    label,
    pct,
    lead,
    key,
    name,
    indexable: !outlook.complete && isOpen(h.chance),
    faq: [
      { q: t(`club.question.${key}`, values), a: [chance, standing].filter(Boolean).join(" ") },
      ...(likely ? [{ q: t("club.finishQuestion", values), a: likely }] : []),
      ...commonFaq(league.name, count, key, name, tr),
    ],
  };
}
