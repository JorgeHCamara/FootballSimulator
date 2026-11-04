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
}: {
  league: LeagueConfig;
  outcome: ScenarioOutcome;
  teams: ReadonlyMap<TeamId, Team>;
  text: ShareCardText;
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
                  <span style={{ flex: 1, overflow: "hidden", whiteSpace: "nowrap" }}>{truncate(teams.get(row.teamId)?.shortName ?? "", 22)}</span>
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
