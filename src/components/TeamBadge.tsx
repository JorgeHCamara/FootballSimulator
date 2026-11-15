import type { Team } from "../engine/types.ts";

const SHOW_CRESTS = process.env.NEXT_PUBLIC_SHOW_CRESTS !== "false";
const HUES = [210, 0, 140, 30, 270, 180, 330, 60, 100, 240];

/**
 * The sizes the site draws badges at, each a class (src/app/globals.css: .crest-N, .disc-N, and .hue-N for the
 * discs' colours) instead of an inline style on every badge; any other size keeps its inline style.
 */
const SIZES = new Set([16, 18, 20, 22, 24, 28, 32, 40, 44, 56]);

/**
 * A club's crest, or a coloured disc with its code. `textless`: the code is
 * drawn by CSS, so it isn't part of the surrounding text (a badge inside a heading).
 */
export function TeamBadge({ team, size = 20, textless = false }: { team: Team; size?: number; textless?: boolean }) {
  if (SHOW_CRESTS && team.crest) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- remote crests, tiny and already optimised
      <img src={team.crest} alt="" width={size} height={size} loading="lazy" {...(SIZES.has(size) ? { className: `crest-${size}` } : { className: "shrink-0 object-contain", style: { width: size, height: size } })} />
    );
  }
  const hueIndex = Math.abs(team.id) % HUES.length;
  const hue = HUES[hueIndex];
  return (
    <span
      aria-hidden
      {...(SIZES.has(size)
        ? { className: `team-disc disc-${size} hue-${hueIndex}` }
        : // The code's size to a hundredth of a pixel (7.2, not 7.199999999999999).
          { className: "team-disc", style: { width: size, height: size, fontSize: Math.round(size * 36) / 100, background: `hsl(${hue} 60% 30%)` } })}
    >
      {textless ? <span className="before:content-[attr(data-tla)]" data-tla={team.tla.slice(0, 3)} /> : team.tla.slice(0, 3)}
    </span>
  );
}
