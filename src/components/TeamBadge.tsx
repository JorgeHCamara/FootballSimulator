import type { Team } from "../engine/types.ts";

const SHOW_CRESTS = process.env.NEXT_PUBLIC_SHOW_CRESTS !== "false";
const HUES = [210, 0, 140, 30, 270, 180, 330, 60, 100, 240];

export function TeamBadge({ team, size = 20 }: { team: Team; size?: number }) {
  if (SHOW_CRESTS && team.crest) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- remote crests, tiny and already optimised
      <img src={team.crest} alt="" width={size} height={size} loading="lazy" className="shrink-0 object-contain" style={{ width: size, height: size }} />
    );
  }
  const hue = HUES[Math.abs(team.id) % HUES.length];
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white"
      style={{ width: size, height: size, fontSize: size * 0.36, background: `hsl(${hue} 60% 30%)` }}
    >
      {team.tla.slice(0, 3)}
    </span>
  );
}
