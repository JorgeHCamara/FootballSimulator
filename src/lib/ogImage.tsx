import { ImageResponse } from "next/og";
import { BrandMark } from "../components/BrandMark.tsx";
import { Flag } from "../components/Flag.tsx";
import type { FlagCode } from "../config/leagues.ts";

export const OG_SIZE = { width: 1200, height: 630 };

/** Shared 1200×630 social preview: brand bar, optional flag, title and tagline. */
export function renderOgImage({ title, subtitle, flag }: { title: string; subtitle: string; flag?: FlagCode }) {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          color: "#ffffff",
          background: "linear-gradient(135deg, #14532d 0%, #166534 55%, #15803d 100%)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20, fontSize: 44, fontWeight: 800 }}>
          <BrandMark size={72} />
          <span>Foot Simu</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
            {flag && <Flag code={flag} width={120} />}
            <span style={{ fontSize: 76, fontWeight: 800, lineHeight: 1.05 }}>{title}</span>
          </div>
          <span style={{ fontSize: 34, color: "#dcfce7" }}>{subtitle}</span>
        </div>
        <span style={{ fontSize: 28, color: "#bbf7d0" }}>footsimu.com</span>
      </div>
    ),
    OG_SIZE,
  );
}
