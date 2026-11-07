/**
 * Italy's third tier, Serie C, as far as My World needs it: the clubs a new
 * world starts with below Serie B, the four relegated from Serie B in 2025/26
 * (Bari, Reggiana, Spezia and Pescara, from ESPN's "ita.2" league with its
 * crests). After the world's first season they come up to Serie B in place of
 * its four relegated clubs, who then wait in Serie C to swap places with the
 * next season's relegated clubs, and so on (src/lib/myWorld.ts), so no
 * fictional club is ever needed; the Coppa Italia's four Serie C sides stay
 * its own (World.cupPool).
 */
export const SERIE_C_CLUBS = [
  { espnId: 106, name: "Bari", shortName: "Bari", tla: "BAR", crest: "https://a.espncdn.com/i/teamlogos/soccer/500/106.png" },
  { espnId: 3942, name: "Reggiana", shortName: "Reggiana", tla: "REG", crest: "https://a.espncdn.com/i/teamlogos/soccer/500/3942.png" },
  { espnId: 4056, name: "Spezia", shortName: "Spezia", tla: "SPE", crest: "https://a.espncdn.com/i/teamlogos/soccer/500/4056.png" },
  { espnId: 3290, name: "Pescara", shortName: "Pescara", tla: "PES", crest: "https://a.espncdn.com/i/teamlogos/soccer/500/3290.png" },
] as const;
