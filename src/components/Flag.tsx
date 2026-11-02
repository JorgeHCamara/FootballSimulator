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
    case "eu":
      // Europe (UEFA competitions): a ring of twelve gold stars, drawn as dots.
      return (
        <>
          <rect width="30" height="20" fill="#003399" />
          <circle cx="15.00" cy="4.00" r="0.9" fill="#ffcc00" />
          <circle cx="18.00" cy="4.80" r="0.9" fill="#ffcc00" />
          <circle cx="20.20" cy="7.00" r="0.9" fill="#ffcc00" />
          <circle cx="21.00" cy="10.00" r="0.9" fill="#ffcc00" />
          <circle cx="20.20" cy="13.00" r="0.9" fill="#ffcc00" />
          <circle cx="18.00" cy="15.20" r="0.9" fill="#ffcc00" />
          <circle cx="15.00" cy="16.00" r="0.9" fill="#ffcc00" />
          <circle cx="12.00" cy="15.20" r="0.9" fill="#ffcc00" />
          <circle cx="9.80" cy="13.00" r="0.9" fill="#ffcc00" />
          <circle cx="9.00" cy="10.00" r="0.9" fill="#ffcc00" />
          <circle cx="9.80" cy="7.00" r="0.9" fill="#ffcc00" />
          <circle cx="12.00" cy="4.80" r="0.9" fill="#ffcc00" />
        </>
      );
    case "conmebol":
      // South America (CONMEBOL competitions): a gold star on navy.
      return (
        <>
          <rect width="30" height="20" fill="#0b2a5b" />
          <polygon points="15.00,5.00 16.23,8.30 19.76,8.45 17.00,10.65 17.94,14.05 15.00,12.10 12.06,14.05 13.00,10.65 10.24,8.45 13.77,8.30" fill="#f2b705" />
        </>
      );
    case "ar":
      return (
        <>
          <rect width="30" height="20" fill="#74acdf" />
          <rect y="6.67" width="30" height="6.67" fill="#ffffff" />
          <circle cx="15" cy="10" r="2" fill="#f6b40e" />
        </>
      );
    case "cl":
      return (
        <>
          <rect width="30" height="20" fill="#ffffff" />
          <rect y="10" width="30" height="10" fill="#d52b1e" />
          <rect width="10" height="10" fill="#0039a6" />
          <polygon points="5.00,2.00 5.71,4.03 7.85,4.07 6.14,5.37 6.76,7.43 5.00,6.20 3.24,7.43 3.86,5.37 2.15,4.07 4.29,4.03" fill="#ffffff" />
        </>
      );
    case "co":
      return (
        <>
          <rect width="30" height="20" fill="#ce1126" />
          <rect width="30" height="15" fill="#003893" />
          <rect width="30" height="10" fill="#fcd116" />
        </>
      );
    case "uy":
      // Simplified: nine stripes and the Sun of May as a gold disc.
      return (
        <>
          <rect width="30" height="20" fill="#ffffff" />
          <rect y="2.22" width="30" height="2.22" fill="#0038a8" />
          <rect y="6.66" width="30" height="2.22" fill="#0038a8" />
          <rect y="11.10" width="30" height="2.22" fill="#0038a8" />
          <rect y="15.54" width="30" height="2.22" fill="#0038a8" />
          <rect width="11" height="11.1" fill="#ffffff" />
          <circle cx="5.5" cy="5.55" r="3" fill="#fcd116" />
        </>
      );
    case "py":
      return (
        <>
          <rect width="30" height="20" fill="#ffffff" />
          <rect width="30" height="6.67" fill="#d52b1e" />
          <rect y="13.33" width="30" height="6.67" fill="#0038a8" />
          <circle cx="15" cy="10" r="2.3" fill="none" stroke="#0038a8" strokeWidth="0.6" />
        </>
      );
    case "mx":
      // Simplified: the coat of arms as a brown disc.
      return (
        <>
          <rect width="10" height="20" fill="#006847" />
          <rect x="10" width="10" height="20" fill="#ffffff" />
          <rect x="20" width="10" height="20" fill="#ce1126" />
          <circle cx="15" cy="10" r="2.6" fill="#8c5a2b" />
        </>
      );
    case "ec":
      // Simplified: the coat of arms as a small disc.
      return (
        <>
          <rect width="30" height="20" fill="#ffd100" />
          <rect y="10" width="30" height="5" fill="#0072ce" />
          <rect y="15" width="30" height="5" fill="#ef3340" />
          <circle cx="15" cy="10" r="2.4" fill="#5b8c3a" stroke="#0072ce" strokeWidth="0.5" />
        </>
      );
    case "pe":
      return (
        <>
          <rect width="30" height="20" fill="#d91023" />
          <rect x="10" width="10" height="20" fill="#ffffff" />
        </>
      );
    case "sa":
      // Simplified: the inscription can't be read at icon size; the sword as a white bar.
      return (
        <>
          <rect width="30" height="20" fill="#006c35" />
          <rect x="8" y="13" width="14" height="1.3" rx="0.6" fill="#ffffff" />
          <rect x="9" y="7" width="12" height="2.2" rx="1" fill="#ffffff" opacity="0.85" />
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
