import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { BrandMark } from "../components/BrandMark.tsx";
import { zoneHex } from "../components/zones.ts";
import type { LeagueConfig, ZoneKind } from "../config/leagues.ts";
import type { Team, TeamId } from "../engine/types.ts";
import { OG_SIZE } from "./ogImage.tsx";
import { cardRows, legendKinds, type ScenarioOutcome } from "./scenario.ts";

const PITCH_700 = "#166534";

/**
 * The same link always shows the same card: browsers keep it a day, the CDN
 * keeps the first rendering (no re-simulating on every crawler visit).
 */
export const CARD_HEADERS = { "Cache-Control": "public, max-age=86400, s-maxage=31536000, stale-while-revalidate=86400" };
const PITCH_900 = "#0b3b20";

/** Inter, bundled (src/assets/fonts, SIL Open Font License): next/og needs the font files themselves. */
let fonts: Promise<{ name: string; data: Buffer; weight: 400 | 600 | 700 | 800; style: "normal" }[]> | null = null;
export function interFonts() {
  fonts ??= Promise.all(
    ([400, 600, 700, 800] as const).map(async (weight) => ({
      name: "Inter",
      data: await readFile(join(process.cwd(), `src/assets/fonts/Inter-${weight}.woff`)),
      weight,
      style: "normal" as const,
    })),
  );
  return fonts;
}

/** The card's text, already translated for the link's language. */
export interface ShareCardText {
  pill: string;
  myPrediction: string;
  headline: string;
  badge?: string;
  basedOn: string;
  cta: string;
  columns: { position: string; team: string; points: string };
  zones: Partial<Record<ZoneKind, string>>;
}

const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** A long headline gets a smaller size so it stays on two lines. */
const headlineSize = (text: string) => (text.length <= 18 ? 64 : text.length <= 26 ? 54 : text.length <= 34 ? 46 : 40);

export async function renderShareCard({
  league,
  outcome,
  teams,
  text,
  crests,
}: {
  league: LeagueConfig;
  outcome: ScenarioOutcome;
  teams: ReadonlyMap<TeamId, Team>;
  text: ShareCardText;
  /** Each row's crest (a data URI, see crestDataUri) beside its name; without, names only. */
  crests?: ReadonlyMap<TeamId, string>;
}) {
  const rows = cardRows(outcome.rows);
  const legend = legendKinds(outcome.places, !league.playoff?.title);
  const compact = rows.length > 10;
  const rowHeight = compact ? 38 : 34;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: PITCH_700, fontFamily: "Inter", color: "#ffffff" }}>
        {/* Left: the prediction. */}
        <div style={{ width: 560, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "48px 40px 48px 56px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <BrandMark size={52} />
            <span style={{ fontSize: 32, fontWeight: 800, letterSpacing: -0.5 }}>Foot Simu</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={{ display: "flex" }}>
              <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: 1.5, padding: "8px 16px", borderRadius: 999, background: "rgba(255,255,255,0.16)", color: "#dcfce7" }}>
                {text.pill}
              </span>
            </div>
            <span style={{ fontSize: 28, fontWeight: 600, color: "#bbf7d0" }}>{text.myPrediction}</span>
            <span style={{ fontSize: headlineSize(text.headline), fontWeight: 800, lineHeight: 1.05, letterSpacing: -1.5, maxWidth: 470 }}>{text.headline}</span>
            {text.badge && (
              <div style={{ display: "flex" }}>
                <span style={{ fontSize: 24, fontWeight: 700, padding: "8px 18px", borderRadius: 12, background: "#facc15", color: PITCH_900 }}>{text.badge}</span>
              </div>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <span style={{ fontSize: 20, color: "#bbf7d0" }}>{text.basedOn}</span>
            <div style={{ display: "flex" }}>
              <span style={{ fontSize: 24, fontWeight: 700, padding: "14px 24px", borderRadius: 14, background: "#ffffff", color: PITCH_700 }}>{text.cta}</span>
            </div>
          </div>
        </div>
        {/* Right: the table. */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", padding: "36px 48px 36px 8px" }}>
          <div style={{ width: "100%", display: "flex", flexDirection: "column", background: "#ffffff", borderRadius: 24, padding: "22px 26px 18px", color: "#18181b", boxShadow: "0 20px 40px rgba(0,0,0,0.25)" }}>
            <div style={{ display: "flex", fontSize: 16, fontWeight: 700, color: "#71717a", paddingBottom: 8, borderBottom: "2px solid #e4e4e7" }}>
              <span style={{ width: 52 }}>{text.columns.position}</span>
              <span style={{ flex: 1 }}>{text.columns.team}</span>
              <span style={{ width: 72, textAlign: "right", justifyContent: "flex-end" }}>{text.columns.points}</span>
            </div>
            {rows.map((row, i) =>
              row === "gap" ? (
                <div key="gap" style={{ display: "flex", justifyContent: "center", height: 26, alignItems: "center", fontSize: 18, color: "#a1a1aa", letterSpacing: 6 }}>
                  • • •
                </div>
              ) : (
                <div
                  key={row.teamId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    height: rowHeight,
                    fontSize: 21,
                    borderBottom: i < rows.length - 1 && rows[i + 1] !== "gap" ? "1px solid #f4f4f5" : "none",
                    background: row.zone?.kind === "title" ? "#fef9c3" : "transparent",
                    fontWeight: row.zone?.kind === "title" ? 800 : 600,
                  }}
                >
                  <span style={{ width: 6, height: rowHeight - 10, borderRadius: 3, marginRight: 12, background: row.zone ? zoneHex(row.zone.kind) : "transparent" }} />
                  <span style={{ width: 34, color: "#52525b" }}>{row.position}</span>
                  {crests && (
                    <div style={{ width: 26, height: 26, marginRight: 10, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {crests.get(row.teamId) && (
                        // eslint-disable-next-line @next/next/no-img-element -- next/og renders plain img elements
                        <img src={crests.get(row.teamId)} width={26} height={26} style={{ objectFit: "contain" }} alt="" />
                      )}
                    </div>
                  )}
                  <span style={{ flex: 1, overflow: "hidden", whiteSpace: "nowrap" }}>{truncate(teams.get(row.teamId)?.shortName ?? "", crests ? 20 : 22)}</span>
                  <span style={{ width: 72, justifyContent: "flex-end", fontWeight: 800 }}>{row.points}</span>
                </div>
              ),
            )}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", marginTop: 14, fontSize: 15, color: "#52525b" }}>
              {legend.map((kind) => (
                <div key={kind} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 12, height: 12, borderRadius: 3, background: zoneHex(kind) }} />
                  <span>{text.zones[kind] ?? kind}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts: await interFonts(), headers: CARD_HEADERS },
  );
}

/** A league's card without a scenario (no or unreadable predictions): brand, league and call to action. */
export async function renderGenericShareCard({ title, subtitle, cta }: { title: string; subtitle: string; cta: string }) {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: PITCH_700, fontFamily: "Inter", color: "#ffffff" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <BrandMark size={72} />
          <span style={{ fontSize: 44, fontWeight: 800 }}>Foot Simu</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <span style={{ fontSize: 76, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2 }}>{title}</span>
          <span style={{ fontSize: 32, color: "#dcfce7" }}>{subtitle}</span>
        </div>
        <div style={{ display: "flex" }}>
          <span style={{ fontSize: 28, fontWeight: 700, padding: "16px 28px", borderRadius: 16, background: "#ffffff", color: PITCH_700 }}>{cta}</span>
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts: await interFonts(), headers: CARD_HEADERS },
  );
}

/** A club page's card: the club (crest and name), where it stands and its chances. */
export interface ClubCardText {
  pill: string;
  club: string;
  /** Shown in a circle when there's no crest. */
  tla: string;
  /** The club's crest as a data URI (crestDataUri), beside its name. */
  crest?: string;
  /** e.g. "3rd · 24 pts". */
  standing: string;
  likeliest: string;
  /** The chances it shows (featuredChances): name, chance and its zone's colour. */
  chances: { label: string; value: string; share: number; color: string }[];
  basedOn: string;
  cta: string;
}

/** A club's name beside its crest: smaller as it gets longer, so it stays on two lines. */
const clubNameSize = (name: string) => (name.length <= 12 ? 60 : name.length <= 18 ? 50 : name.length <= 26 ? 42 : 36);

/** A chance's name: smaller as it gets longer, so "Liga dos Campeões da AFC Elite" and "… Two" both fit whole. */
const chanceLabelSize = (label: string) => (label.length <= 24 ? 26 : label.length <= 30 ? 22 : 20);

/** Club pages change with every result: the CDN keeps a card for an hour (the page's own refresh). */
const CLUB_CARD_HEADERS = { "Cache-Control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400" };

export async function renderClubCard(text: ClubCardText) {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: PITCH_700, fontFamily: "Inter", color: "#ffffff" }}>
        <div style={{ width: 560, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "48px 40px 48px 56px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <BrandMark size={52} />
            <span style={{ fontSize: 32, fontWeight: 800, letterSpacing: -0.5 }}>Foot Simu</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={{ display: "flex" }}>
              <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: 1.5, padding: "8px 16px", borderRadius: 999, background: "rgba(255,255,255,0.16)", color: "#dcfce7" }}>
                {text.pill}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
              {crest({ name: text.club, tla: text.tla, ...(text.crest ? { crest: text.crest } : {}) }, 80)}
              <span style={{ fontSize: clubNameSize(text.club), fontWeight: 800, lineHeight: 1.05, letterSpacing: -1.5, maxWidth: 370 }}>{truncate(text.club, 40)}</span>
            </div>
            <span style={{ fontSize: 28, fontWeight: 600, color: "#bbf7d0" }}>{text.standing}</span>
            <div style={{ display: "flex" }}>
              <span style={{ fontSize: 24, fontWeight: 700, padding: "8px 18px", borderRadius: 12, background: "#facc15", color: PITCH_900 }}>{text.likeliest}</span>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <span style={{ fontSize: 20, color: "#bbf7d0" }}>{text.basedOn}</span>
            <div style={{ display: "flex" }}>
              <span style={{ fontSize: 24, fontWeight: 700, padding: "14px 24px", borderRadius: 14, background: "#ffffff", color: PITCH_700 }}>{text.cta}</span>
            </div>
          </div>
        </div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", padding: "36px 48px 36px 8px" }}>
          <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 26, background: "#ffffff", borderRadius: 24, padding: "34px 34px", color: "#18181b", boxShadow: "0 20px 40px rgba(0,0,0,0.25)" }}>
            {text.chances.map((c) => (
              <div key={c.label} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16 }}>
                  <span style={{ fontSize: chanceLabelSize(c.label), fontWeight: 700, color: "#3f3f46" }}>{truncate(c.label, 34)}</span>
                  <span style={{ fontSize: 44, fontWeight: 800, letterSpacing: -1 }}>{c.value}</span>
                </div>
                <div style={{ display: "flex", height: 14, borderRadius: 7, background: "#e4e4e7" }}>
                  <div style={{ display: "flex", width: `${Math.max(c.share > 0 ? 2 : 0, c.share * 100)}%`, height: 14, borderRadius: 7, background: c.color }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts: await interFonts(), headers: CLUB_CARD_HEADERS },
  );
}

/**
 * A crest as a data URI for a card (PNG or JPEG only), or undefined when it
 * can't be fetched quickly: the card then shows the club's initials.
 */
export async function crestDataUri(url: string | undefined): Promise<string | undefined> {
  if (!url) return undefined;
  try {
    let type: string;
    let bytes: Buffer;
    if (/^\/crests\/(?:[a-z-]+\/)?\d+\.png$/.test(url)) {
      // The site's own crest (Série C's, a cut-out, a saved fallback): read from the deployment, no request.
      type = "image/png";
      bytes = await readFile(join(process.cwd(), "public", url));
    } else {
      const res = await fetch(url, { signal: AbortSignal.timeout(2500), next: { revalidate: 604800 } });
      type = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
      if (!res.ok || !["image/png", "image/jpeg"].includes(type)) return undefined;
      bytes = Buffer.from(await res.arrayBuffer());
    }
    // Only what it says it is: a PNG or JPEG by its first bytes (a broken image would break the card).
    const png = bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
    if (bytes.length > 400_000 || !(type === "image/png" ? png : jpeg)) return undefined;
    return `data:${type};base64,${bytes.toString("base64")}`;
  } catch {
    return undefined;
  }
}

export interface MatchCardText {
  pill: string;
  home: { name: string; tla: string; crest?: string };
  away: { name: string; tla: string; crest?: string };
  /** e.g. "Sat 8 Nov 2026 · 15:00 GMT". */
  when: string;
  /** Once played: the score and "Full time". */
  result?: { score: string; label: string };
  /** Above the odds once played ("Pre-match prediction"). */
  oddsTitle?: string;
  odds: { label: string; value: string; share: number; color: string }[];
  cta: string;
}

const crest = (side: MatchCardText["home"], size: number) =>
  side.crest ? (
    // eslint-disable-next-line @next/next/no-img-element -- next/og renders plain img elements
    <img src={side.crest} width={size} height={size} style={{ objectFit: "contain" }} alt="" />
  ) : (
    <div style={{ width: size, height: size, borderRadius: size / 2, background: "rgba(255,255,255,0.18)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.32, fontWeight: 800 }}>
      {side.tla.slice(0, 3)}
    </div>
  );

/** A match page's card: the two clubs, when they meet, and the model's odds (or the final score). */
export async function renderMatchCard(text: MatchCardText) {
  const nameSize = (name: string) => (name.length <= 14 ? 46 : name.length <= 20 ? 38 : 32);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: PITCH_700, fontFamily: "Inter", color: "#ffffff" }}>
        <div style={{ width: 600, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "44px 36px 44px 56px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <BrandMark size={48} />
            <span style={{ fontSize: 30, fontWeight: 800, letterSpacing: -0.5 }}>Foot Simu</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={{ display: "flex" }}>
              <span style={{ fontSize: 19, fontWeight: 700, letterSpacing: 1.5, padding: "8px 16px", borderRadius: 999, background: "rgba(255,255,255,0.16)", color: "#dcfce7" }}>
                {text.pill}
              </span>
            </div>
            {[text.home, text.away].map((side, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 18 }}>
                {crest(side, 64)}
                <span style={{ fontSize: nameSize(side.name), fontWeight: 800, letterSpacing: -1, lineHeight: 1.05, maxWidth: 400 }}>{truncate(side.name, 26)}</span>
                {text.result && (
                  <span style={{ marginLeft: "auto", fontSize: 52, fontWeight: 800 }}>{text.result.score.split("–")[i]}</span>
                )}
              </div>
            ))}
            <span style={{ fontSize: 24, fontWeight: 600, color: "#bbf7d0" }}>{text.result ? `${text.result.label} · ${text.when}` : text.when}</span>
          </div>
          <div style={{ display: "flex" }}>
            <span style={{ fontSize: 22, fontWeight: 700, padding: "12px 22px", borderRadius: 14, background: "#ffffff", color: PITCH_700 }}>{text.cta}</span>
          </div>
        </div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", padding: "36px 48px 36px 4px" }}>
          <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 24, background: "#ffffff", borderRadius: 24, padding: "30px 32px", color: "#18181b", boxShadow: "0 20px 40px rgba(0,0,0,0.25)" }}>
            {text.oddsTitle && <span style={{ fontSize: 20, fontWeight: 700, color: "#71717a", textTransform: "uppercase", letterSpacing: 1 }}>{text.oddsTitle}</span>}
            {text.odds.map((o) => (
              <div key={o.label} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 24, fontWeight: 700, color: "#3f3f46" }}>{truncate(o.label, 22)}</span>
                  <span style={{ fontSize: 42, fontWeight: 800, letterSpacing: -1 }}>{o.value}</span>
                </div>
                <div style={{ display: "flex", height: 14, borderRadius: 7, background: "#e4e4e7" }}>
                  <div style={{ display: "flex", width: `${Math.max(o.share > 0 ? 2 : 0, o.share * 100)}%`, height: 14, borderRadius: 7, background: o.color }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts: await interFonts(), headers: CLUB_CARD_HEADERS },
  );
}

export interface OddsCardText {
  pill: string;
  /** "Title race after Matchday 11". */
  title: string;
  /** "After the games up to 2 November 2026". */
  date: string;
  rows: { name: string; tla: string; crest?: string; value: string; delta?: { text: string; good: boolean; up: boolean } }[];
  basedOn: string;
  cta: string;
}

/** A Lucide trend arrow, drawn inline (next/og renders SVG elements). */
const trend = (up: boolean, color: string) => (
  <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
    {up ? (
      <>
        <path d="M16 7h6v6" />
        <path d="m22 7-8.5 8.5-5-5L2 17" />
      </>
    ) : (
      <>
        <path d="M16 17h6v-6" />
        <path d="m22 17-8.5-8.5-5 5L2 7" />
      </>
    )}
  </svg>
);

/** A "what changed" report's card: the race after the round, its top five with their changes. */
export async function renderOddsCard(text: OddsCardText) {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: PITCH_700, fontFamily: "Inter", color: "#ffffff" }}>
        <div style={{ width: 520, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "48px 32px 48px 56px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <BrandMark size={48} />
            <span style={{ fontSize: 30, fontWeight: 800, letterSpacing: -0.5 }}>Foot Simu</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={{ display: "flex" }}>
              <span style={{ fontSize: 19, fontWeight: 700, letterSpacing: 1.5, padding: "8px 16px", borderRadius: 999, background: "rgba(255,255,255,0.16)", color: "#dcfce7" }}>
                {text.pill}
              </span>
            </div>
            <span style={{ fontSize: headlineSize(text.title), fontWeight: 800, lineHeight: 1.05, letterSpacing: -1.5, maxWidth: 440 }}>{text.title}</span>
            <span style={{ fontSize: 22, color: "#bbf7d0" }}>{text.date}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <span style={{ fontSize: 19, color: "#bbf7d0" }}>{text.basedOn}</span>
            <div style={{ display: "flex" }}>
              <span style={{ fontSize: 22, fontWeight: 700, padding: "12px 22px", borderRadius: 14, background: "#ffffff", color: PITCH_700 }}>{text.cta}</span>
            </div>
          </div>
        </div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", padding: "36px 48px 36px 8px" }}>
          <div style={{ width: "100%", display: "flex", flexDirection: "column", background: "#ffffff", borderRadius: 24, padding: "16px 28px", color: "#18181b", boxShadow: "0 20px 40px rgba(0,0,0,0.25)" }}>
            {text.rows.map((r, i) => (
              <div key={r.name} style={{ display: "flex", alignItems: "center", gap: 16, height: 92, borderBottom: i < text.rows.length - 1 ? "1px solid #f4f4f5" : "none" }}>
                <span style={{ width: 22, fontSize: 22, fontWeight: 700, color: "#71717a" }}>{i + 1}</span>
                {crest(r, 44)}
                <span style={{ flex: 1, fontSize: 28, fontWeight: 700, overflow: "hidden", whiteSpace: "nowrap" }}>{truncate(r.name, 18)}</span>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                  <span style={{ fontSize: 34, fontWeight: 800, letterSpacing: -1 }}>{r.value}</span>
                  {r.delta && (
                    <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 20, fontWeight: 700, color: r.delta.good ? "#15803d" : "#dc2626" }}>
                      {trend(r.delta.up, r.delta.good ? "#15803d" : "#dc2626")}
                      {r.delta.text}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts: await interFonts(), headers: CLUB_CARD_HEADERS },
  );
}


/** One club on the biggest-movers card: its change, and its chance before and now. */
export interface MoverCardRow {
  name: string;
  tla: string;
  crest?: string;
  /** Its chance before and now ("34%", "46%"). */
  from: string;
  to: string;
  delta: { text: string; good: boolean; up: boolean };
}

export interface MoversCardText {
  pill: string;
  /** "Biggest movers after Matchday 11". */
  title: string;
  /** "After the games up to 2 November 2026". */
  date: string;
  /** The halves' headings ("Up", "Down"). */
  up: string;
  down: string;
  sections: { name: string; color: string; up: MoverCardRow[]; down: MoverCardRow[] }[];
  basedOn: string;
  cta: string;
}

/** A round's biggest-movers card: up to three races, each with its biggest risers and fallers. The round never changes: kept as the share cards. */
export async function renderMoversCard(text: MoversCardText) {
  const rowHeight = text.sections.length > 2 ? 46 : 54;
  // On the white panel: the crest, or the club's initials in a grey circle.
  const badge = (r: MoverCardRow) =>
    r.crest ? (
      // eslint-disable-next-line @next/next/no-img-element -- next/og renders plain img elements
      <img src={r.crest} width={30} height={30} style={{ objectFit: "contain" }} alt="" />
    ) : (
      <div style={{ width: 30, height: 30, borderRadius: 15, background: "#e4e4e7", color: "#3f3f46", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800 }}>
        {r.tla.slice(0, 3)}
      </div>
    );
  // Lucide's arrow-right (Inter as bundled has no arrow character).
  const arrow = (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
  const half = (rows: MoverCardRow[]) => (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
      {rows.length ? (
        rows.map((r) => {
          const color = r.delta.good ? "#15803d" : "#dc2626";
          return (
            <div key={r.name} style={{ display: "flex", alignItems: "center", gap: 10, height: rowHeight }}>
              {badge(r)}
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: 20, fontWeight: 700, overflow: "hidden", whiteSpace: "nowrap" }}>{truncate(r.name, 15)}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 15, fontWeight: 600, color: "#71717a" }}>
                  {r.from}
                  {arrow}
                  {r.to}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 19, fontWeight: 800, color }}>
                {trend(r.delta.up, color)}
                {r.delta.text}
              </div>
            </div>
          );
        })
      ) : (
        <span style={{ display: "flex", alignItems: "center", height: rowHeight, fontSize: 20, color: "#a1a1aa" }}>–</span>
      )}
    </div>
  );
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: PITCH_700, fontFamily: "Inter", color: "#ffffff" }}>
        <div style={{ width: 470, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "48px 28px 48px 56px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <BrandMark size={48} />
            <span style={{ fontSize: 30, fontWeight: 800, letterSpacing: -0.5 }}>Foot Simu</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={{ display: "flex" }}>
              <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: 1.5, padding: "8px 16px", borderRadius: 999, background: "rgba(255,255,255,0.16)", color: "#dcfce7" }}>
                {truncate(text.pill, 30)}
              </span>
            </div>
            <span style={{ fontSize: text.title.length <= 36 ? 44 : 38, fontWeight: 800, lineHeight: 1.08, letterSpacing: -1.5, maxWidth: 386 }}>{text.title}</span>
            <span style={{ fontSize: 19, color: "#bbf7d0" }}>{text.date}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <span style={{ fontSize: 18, color: "#bbf7d0" }}>{text.basedOn}</span>
            <div style={{ display: "flex" }}>
              <span style={{ fontSize: 21, fontWeight: 700, padding: "12px 20px", borderRadius: 14, background: "#ffffff", color: PITCH_700 }}>{text.cta}</span>
            </div>
          </div>
        </div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", padding: "32px 44px 32px 4px" }}>
          <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 14, background: "#ffffff", borderRadius: 24, padding: "20px 26px 18px", color: "#18181b", boxShadow: "0 20px 40px rgba(0,0,0,0.25)" }}>
            {/* Which way: up on the left, down on the right (arrows drawn as Lucide's trend icons). */}
            <div style={{ display: "flex", gap: 24, fontSize: 15, fontWeight: 700, letterSpacing: 1, color: "#71717a", textTransform: "uppercase" }}>
              {[
                { label: text.up, up: true },
                { label: text.down, up: false },
              ].map((h) => (
                <div key={h.label} style={{ flex: 1, display: "flex", alignItems: "center", gap: 6 }}>
                  {trend(h.up, "#71717a")}
                  {h.label}
                </div>
              ))}
            </div>
            {text.sections.map((s, i) => (
              <div key={s.name} style={{ display: "flex", flexDirection: "column", paddingTop: 10, borderTop: i === 0 ? "2px solid #e4e4e7" : "1px solid #f4f4f5" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 19, fontWeight: 800, color: "#3f3f46" }}>
                  <span style={{ width: 14, height: 14, borderRadius: 4, background: s.color }} />
                  {truncate(s.name, 40)}
                </div>
                <div style={{ display: "flex", gap: 24 }}>
                  {half(s.up)}
                  {half(s.down)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts: await interFonts(), headers: CARD_HEADERS },
  );
}
