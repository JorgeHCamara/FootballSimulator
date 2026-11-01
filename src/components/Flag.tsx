import type { FlagCode } from "../config/leagues.ts";

// Inline SVG flags (3:2). Emoji flags render inconsistently (e.g. as letters on
// Windows), and inline SVG needs no network request. Also used in OG images.

function shapes(code: FlagCode) {
  switch (code) {
    case "gb-eng":
      return (
        <>
          <rect width="30" height="20" fill="#ffffff" />
          <rect x="13" width="4" height="20" fill="#ce1124" />
          <rect y="8" width="30" height="4" fill="#ce1124" />
        </>
      );
    case "es":
      return (
        <>
          <rect width="30" height="20" fill="#aa151b" />
          <rect y="5" width="30" height="10" fill="#f1bf00" />
        </>
      );
    case "de":
      return (
        <>
          <rect width="30" height="6.67" fill="#000000" />
          <rect y="6.67" width="30" height="6.67" fill="#dd0000" />
          <rect y="13.33" width="30" height="6.67" fill="#ffce00" />
        </>
      );
    case "it":
      return (
        <>
          <rect width="10" height="20" fill="#009246" />
          <rect x="10" width="10" height="20" fill="#ffffff" />
          <rect x="20" width="10" height="20" fill="#ce2b37" />
        </>
      );
    case "fr":
      return (
        <>
          <rect width="10" height="20" fill="#0055a4" />
          <rect x="10" width="10" height="20" fill="#ffffff" />
          <rect x="20" width="10" height="20" fill="#ef4135" />
        </>
      );
    case "pt":
      return (
        <>
          <rect width="30" height="20" fill="#da291c" />
          <rect width="12" height="20" fill="#046a38" />
          <circle cx="12" cy="10" r="3.6" fill="#ffe900" />
          <circle cx="12" cy="10" r="2.2" fill="#da291c" />
        </>
      );
    case "us":
      // Simplified: 13 stripes and a plain canton (stars are unreadable at icon size).
      return (
        <>
          <rect width="30" height="20" fill="#ffffff" />
          <rect y="0.0" width="30" height="1.538" fill="#b22234" />
          <rect y="3.077" width="30" height="1.538" fill="#b22234" />
          <rect y="6.154" width="30" height="1.538" fill="#b22234" />
          <rect y="9.231" width="30" height="1.538" fill="#b22234" />
          <rect y="12.308" width="30" height="1.538" fill="#b22234" />
          <rect y="15.385" width="30" height="1.538" fill="#b22234" />
          <rect y="18.462" width="30" height="1.538" fill="#b22234" />
          <rect width="12" height="10.77" fill="#3c3b6e" />
        </>
      );
    case "nl":
      return (
        <>
          <rect width="30" height="6.67" fill="#ae1c28" />
          <rect y="6.67" width="30" height="6.67" fill="#ffffff" />
          <rect y="13.33" width="30" height="6.67" fill="#21468b" />
        </>
      );
    case "br":
      return (
        <>
          <rect width="30" height="20" fill="#009c3b" />
          <polygon points="3,10 15,2.2 27,10 15,17.8" fill="#ffdf00" />
          <circle cx="15" cy="10" r="4.6" fill="#002776" />
          <path d="M10.6 9.1 Q15 7.9 19.5 10.6" stroke="#ffffff" strokeWidth="0.9" fill="none" />
        </>
      );
  }
}

export function Flag({ code, width = 24, className }: { code: FlagCode; width?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 30 20"
      width={width}
      height={(width * 2) / 3}
      aria-hidden="true"
      focusable="false"
      className={className}
      style={{ borderRadius: width / 10, boxShadow: "0 0 0 1px rgb(0 0 0 / 0.08)", flexShrink: 0 }}
    >
      {shapes(code)}
    </svg>
  );
}
