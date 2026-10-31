import type { Team } from "../engine/types.ts";

// Display-name overrides for clubs whose football-data.org name isn't the one
// fans use. Only names, codes and crests change: simulations, saved predictions
// and share links work on team ids, so they are unaffected.
//
// `match` can be:
// - the football-data.org team id (never changes; find it in the API's
//   /v4/competitions/{code}/teams response), or
// - the club's name or short name as the API sends it (case-insensitive).
//   If a club still shows its old name, copy the exact name the site shows here.

export interface TeamOverride {
  match: number | string;
  /** Full name, shown in the table on wider screens. */
  name?: string;
  /** Short name, shown in fixtures and on phones. */
  shortName?: string;
  /** Three-letter code, shown in the badge when there is no crest. */
  tla?: string;
  /** Replacement crest image URL. */
  crest?: string;
}

export const TEAM_OVERRIDES: readonly TeamOverride[] = [
  // Brasileirão
  { match: "CA Paranaense", name: "Athletico Paranaense", shortName: "Athletico-PR", tla: "CAP" },
  { match: "CR Flamengo", name: "Flamengo", shortName: "Flamengo", tla: "FLA" },
  { match: "SE Palmeiras", name: "Palmeiras", shortName: "Palmeiras", tla: "PAL" },
  { match: "CR Vasco da Gama", name: "Vasco", shortName: "Vasco", tla: "VAS" },
  { match: "SC Corinthians Paulista", name: "Corinthians", shortName: "Corinthians" },
  { match: "Fluminense FC", name: "Fluminense", shortName: "Fluminense" },
  { match: "CA Mineiro", name: "Atlético Mineiro", shortName: "Atlético-MG" },
  { match: "Cruzeiro EC", name: "Cruzeiro", shortName: "Cruzeiro" },
  { match: "EC Bahia", name: "Bahia", shortName: "Bahia" },
  { match: "Santos FC", name: "Santos", shortName: "Santos" },
  { match: "RB Bragantino", name: "Red Bull Bragantino", shortName: "Bragantino" },
  { match: "São Paulo FC", name: "São Paulo", shortName: "São Paulo" },
  { match: "Botafogo FR", name: "Botafogo", shortName: "Botafogo" },
  { match: "Coritiba FBC", name: "Coritiba", shortName: "Coritiba" },
  { match: "EC Vitória", name: "Vitória", shortName: "Vitória" },
  { match: "Grêmio FBPA", name: "Grêmio", shortName: "Grêmio" },
  { match: "Mirassol FC", name: "Mirassol", shortName: "Mirassol" },
  { match: "SC Internacional", name: "Internacional", shortName: "Internacional" },
  { match: "Clube do Remo", name: "Remo", shortName: "Remo" },
  { match: "Chapecoense AF", name: "Chapecoense", shortName: "Chapecoense" },
  // Premier League
  { match: "Manchester City FC", name: "Manchester City", shortName: "Man City" },
  { match: "Manchester United FC", name: "Manchester United", shortName: "Man United" },
  { match: "Arsenal FC", name: "Arsenal", shortName: "Arsenal" },
  { match: "Chelsea FC", name: "Chelsea", shortName: "Chelsea" },
  { match: "Liverpool FC", name: "Liverpool", shortName: "Liverpool" },
  { match: "Tottenham Hotspur FC", name: "Tottenham Hotspur", shortName: "Tottenham" },
  { match: "Newcastle United FC", name: "Newcastle United", shortName: "Newcastle" },
  { match: "Aston Villa FC", name: "Aston Villa", shortName: "Aston Villa" },
  { match: "Brighton & Hove Albion FC", name: "Brighton & Hove Albion", shortName: "Brighton" },
  { match: "Brentford FC", name: "Brentford", shortName: "Brentford" },
  { match: "Leeds United FC", name: "Leeds United", shortName: "Leeds" },
  { match: "Everton FC", name: "Everton", shortName: "Everton" },
  { match: "Fulham FC", name: "Fulham", shortName: "Fulham" },
  { match: "Crystal Palace FC", name: "Crystal Palace", shortName: "Crystal Palace" },
  { match: "Nottingham Forest FC", name: "Nottingham Forest", shortName: "Nottm Forest" },
  { match: "AFC Bournemouth", name: "Bournemouth", shortName: "Bournemouth" },
  { match: "Hull City AFC", name: "Hull City", shortName: "Hull City" },
  { match: "Ipswich Town FC", name: "Ipswich Town", shortName: "Ipswich" },
  { match: "Coventry City FC", name: "Coventry City", shortName: "Coventry" },
  { match: "Sunderland AFC", name: "Sunderland", shortName: "Sunderland" },
  // La Liga
  { match: "Real Madrid CF", name: "Real Madrid", shortName: "Real Madrid" },
  { match: "FC Barcelona", name: "Barcelona", shortName: "Barcelona" },
  { match: "Club Atlético de Madrid", name: "Atlético Madrid", shortName: "Atlético" },
  { match: "Real Betis Balompié", name: "Real Betis", shortName: "Real Betis" },
  { match: "Real Sociedad de Fútbol", name: "Real Sociedad", shortName: "Real Sociedad" },
  { match: "Sevilla FC", name: "Sevilla", shortName: "Sevilla" },
  { match: "Villarreal CF", name: "Villarreal", shortName: "Villarreal" },
  { match: "Valencia CF", name: "Valencia", shortName: "Valencia" },
  { match: "RC Celta de Vigo", name: "Celta Vigo", shortName: "Celta" },
  { match: "RCD Espanyol de Barcelona", name: "Espanyol", shortName: "Espanyol" },
  { match: "CA Osasuna", name: "Osasuna", shortName: "Osasuna" },
  { match: "Deportivo Alavés", name: "Alavés", shortName: "Alavés" },
  { match: "Getafe CF", name: "Getafe", shortName: "Getafe" },
  { match: "Rayo Vallecano de Madrid", name: "Rayo Vallecano", shortName: "Rayo" },
  { match: "Elche CF", name: "Elche", shortName: "Elche" },
  { match: "Levante UD", name: "Levante", shortName: "Levante" },
  { match: "Málaga CF", name: "Málaga", shortName: "Málaga" },
  { match: "RC Deportivo La Coruña", name: "Deportivo La Coruña", shortName: "Deportivo" },
  { match: "Real Racing Club de Santander", name: "Racing Santander", shortName: "Racing" },
  // Bundesliga
  { match: "FC Bayern München", name: "Bayern Munich", shortName: "Bayern" },
  { match: "Bayer 04 Leverkusen", name: "Bayer Leverkusen", shortName: "Leverkusen" },
  { match: "SC Freiburg", name: "Freiburg", shortName: "Freiburg" },
  { match: "SV Werder Bremen", name: "Werder Bremen", shortName: "Werder Bremen" },
  { match: "1. FSV Mainz 05", name: "Mainz 05", shortName: "Mainz" },
  { match: "FC Augsburg", name: "Augsburg", shortName: "Augsburg" },
  { match: "TSG 1899 Hoffenheim", name: "Hoffenheim", shortName: "Hoffenheim" },
  { match: "Hamburger SV", name: "Hamburger SV", shortName: "Hamburg" },
  { match: "1. FC Köln", name: "FC Köln", shortName: "Köln" },
  { match: "SC Paderborn 07", name: "Paderborn", shortName: "Paderborn" },
  { match: "FC Schalke 04", name: "Schalke 04", shortName: "Schalke" },
  { match: "1. FC Union Berlin", name: "Union Berlin", shortName: "Union Berlin" },
  { match: "Borussia Mönchengladbach", name: "Borussia Mönchengladbach", shortName: "Gladbach" },
  { match: "SV 07 Elversberg", name: "SV Elversberg", shortName: "Elversberg" },
  // Serie A
  { match: "FC Internazionale Milano", name: "Inter", shortName: "Inter" },
  { match: "Juventus FC", name: "Juventus", shortName: "Juventus" },
  { match: "SSC Napoli", name: "Napoli", shortName: "Napoli" },
  { match: "SS Lazio", name: "Lazio", shortName: "Lazio" },
  { match: "AS Roma", name: "Roma", shortName: "Roma" },
  { match: "Atalanta BC", name: "Atalanta", shortName: "Atalanta" },
  { match: "ACF Fiorentina", name: "Fiorentina", shortName: "Fiorentina" },
  { match: "Bologna FC 1909", name: "Bologna", shortName: "Bologna" },
  { match: "Torino FC", name: "Torino", shortName: "Torino" },
  { match: "Genoa CFC", name: "Genoa", shortName: "Genoa" },
  { match: "Como 1907", name: "Como", shortName: "Como" },
  { match: "Cagliari Calcio", name: "Cagliari", shortName: "Cagliari" },
  { match: "Udinese Calcio", name: "Udinese", shortName: "Udinese" },
  { match: "US Lecce", name: "Lecce", shortName: "Lecce" },
  { match: "US Sassuolo Calcio", name: "Sassuolo", shortName: "Sassuolo" },
  { match: "AC Monza", name: "Monza", shortName: "Monza" },
  { match: "Parma Calcio 1913", name: "Parma", shortName: "Parma" },
  { match: "Frosinone Calcio", name: "Frosinone", shortName: "Frosinone" },
  { match: "Venezia FC", name: "Venezia", shortName: "Venezia" },
  // Ligue 1
  { match: "Paris Saint-Germain FC", name: "Paris Saint-Germain", shortName: "PSG" },
  { match: "Olympique de Marseille", name: "Marseille", shortName: "Marseille" },
  { match: "Olympique Lyonnais", name: "Lyon", shortName: "Lyon" },
  { match: "AS Monaco FC", name: "Monaco", shortName: "Monaco" },
  { match: "Lille OSC", name: "Lille", shortName: "Lille" },
  { match: "Stade Rennais FC 1901", name: "Rennes", shortName: "Rennes" },
  { match: "OGC Nice", name: "Nice", shortName: "Nice" },
  { match: "Racing Club de Lens", name: "Lens", shortName: "Lens" },
  { match: "RC Strasbourg Alsace", name: "Strasbourg", shortName: "Strasbourg" },
  { match: "Stade Brestois 29", name: "Brest", shortName: "Brest" },
  { match: "Toulouse FC", name: "Toulouse", shortName: "Toulouse" },
  { match: "FC Lorient", name: "Lorient", shortName: "Lorient" },
  { match: "AJ Auxerre", name: "Auxerre", shortName: "Auxerre" },
  { match: "Angers SCO", name: "Angers", shortName: "Angers" },
  { match: "Le Havre AC", name: "Le Havre", shortName: "Le Havre" },
  { match: "Le Mans FC", name: "Le Mans", shortName: "Le Mans" },
  { match: "ES Troyes AC", name: "Troyes", shortName: "Troyes" },
];

const normalize = (text: string) => text.trim().toLowerCase();

function matches(team: Team, override: TeamOverride): boolean {
  if (typeof override.match === "number") return team.id === override.match;
  const wanted = normalize(override.match);
  return normalize(team.name) === wanted || normalize(team.shortName) === wanted;
}

export function applyTeamOverrides(teams: readonly Team[], overrides: readonly TeamOverride[] = TEAM_OVERRIDES): Team[] {
  return teams.map((team) => {
    const override = overrides.find((o) => matches(team, o));
    if (!override) return team;
    const { match: _match, ...fields } = override;
    return { ...team, ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) };
  });
}
