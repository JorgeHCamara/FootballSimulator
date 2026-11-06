/**
 * England's fifth tier, the National League, as far as My World needs it: the
 * clubs a new world starts with outside the Football League (from ESPN's
 * "eng.5" league, with its crests). After the world's first season they come
 * up to League Two in place of its two relegated clubs, who then wait in the
 * National League to swap places with the next season's relegated clubs, and
 * so on (src/lib/myWorld.ts).
 */
export const NATIONAL_LEAGUE_CLUBS = [
  { espnId: 2595, name: "Boreham Wood", shortName: "Boreham Wood", tla: "BOR", crest: "https://a.espncdn.com/i/teamlogos/soccer/500/2595.png" },
  { espnId: 19262, name: "Harrogate Town", shortName: "Harrogate", tla: "HAR", crest: "https://a.espncdn.com/i/teamlogos/soccer/500/19262.png" },
] as const;
