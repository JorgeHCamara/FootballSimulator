/**
 * Brazil's fourth tier, Série D, as far as My World needs it: the real clubs
 * that come up into Série C while it grows (20 clubs in 2026, 24 in 2027, 28
 * from 2028: six come up every year, two go down in 2026 and 2027, six from
 * 2028). Fourteen are needed before the clubs relegated from Série C alone
 * can fill the six places (src/lib/myWorld.ts takes them in this order):
 * - the six promoted to Série C 2027 in real life: ABC, ASA, Gama, Goiatuba,
 *   Nacional-AM and Uberlândia;
 * - CSA and São José-RS, beaten in the 2026 Série D's extra access round;
 * - six of its round-of-16 losers, the closest ties first: América-RN, Iguatu
 *   and Treze (on penalties), Portuguesa-SP and São Luiz-RS (by a goal), and
 *   Cianorte (Luverdense and Ferroviário, the other two, aren't in ESPN's data).
 * ESPN ids and crests where ESPN has them (Goiatuba isn't there: its badge is
 * its initials); Gama's crest is the site's own copy.
 */
export const SERIE_D_CLUBS = [
  { espnId: 9965, name: "ABC", shortName: "ABC", tla: "ABC", crest: "https://a.espncdn.com/i/teamlogos/soccer/500/9965.png" },
  { espnId: 6196, name: "ASA", shortName: "ASA", tla: "ASA", crest: "https://a.espncdn.com/i/teamlogos/soccer/500/6196.png" },
  { espnId: 6277, name: "Gama", shortName: "Gama", tla: "GAM", crest: "/crests/6277.png" },
  { name: "Goiatuba", shortName: "Goiatuba", tla: "GOI" },
  { espnId: 17325, name: "Nacional-AM", shortName: "Nacional-AM", tla: "NAM", crest: "https://a.espncdn.com/i/teamlogos/soccer/500/17325.png" },
  { espnId: 9460, name: "Uberlândia", shortName: "Uberlândia", tla: "UBE", crest: "https://a.espncdn.com/i/teamlogos/soccer/500/9460.png" },
  { espnId: 7531, name: "CSA", shortName: "CSA", tla: "CSA", crest: "https://a.espncdn.com/i/teamlogos/soccer/500/7531.png" },
  { espnId: 7389, name: "São José-RS", shortName: "São José-RS", tla: "SJO", crest: "https://a.espncdn.com/i/teamlogos/soccer/500/7389.png" },
  { espnId: 7634, name: "América-RN", shortName: "América-RN", tla: "ARN", crest: "https://a.espncdn.com/i/teamlogos/soccer/500/7634.png" },
  { espnId: 21865, name: "Iguatu", shortName: "Iguatu", tla: "IGU" },
  { espnId: 4902, name: "Treze", shortName: "Treze", tla: "TRE", crest: "https://a.espncdn.com/i/teamlogos/soccer/500/4902.png" },
  { espnId: 4773, name: "Portuguesa", shortName: "Portuguesa", tla: "POR", crest: "https://a.espncdn.com/i/teamlogos/soccer/500/4773.png" },
  { espnId: 7391, name: "São Luiz-RS", shortName: "São Luiz", tla: "SLU", crest: "https://a.espncdn.com/i/teamlogos/soccer/500/7391.png" },
  { espnId: 4909, name: "Cianorte", shortName: "Cianorte", tla: "CIA", crest: "https://a.espncdn.com/i/teamlogos/soccer/500/4909.png" },
] as const;
