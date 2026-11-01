import type { Team } from "../engine/types.ts";
import type { CompetitionCode } from "./leagues.ts";

// Display-name overrides for clubs whose football-data.org name isn't the one
// fans use. Only names, codes and crests change: simulations, saved predictions
// and share links work on team ids, so they are unaffected.
//
// `match` can be:
// - the football-data.org team id (never changes; find it in the API's
//   /v4/competitions/{code}/teams response), or
// - the club's name or short name as the API sends it (case-insensitive).
//   If a club still shows its old name, copy the exact name the site shows here.
//
// Set `league` when a name could match a club in another league too (e.g.
// "Athletic" is both Athletic Club in La Liga and Athletic-MG in Série B).

export interface TeamOverride {
  match: number | string;
  /** Only apply in this league. */
  league?: CompetitionCode;
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
  // Brasileirão Série B (names from ESPN)
  { match: "Operário PR", league: "BSB", name: "Operário-PR", shortName: "Operário-PR" },
  { match: "Athletic", league: "BSB", name: "Athletic-MG", shortName: "Athletic-MG" },
  // Championship (apply in any league: clubs move between the Premier League and Championship)
  { match: "Middlesbrough FC", name: "Middlesbrough", shortName: "Middlesbrough" },
  { match: "Southampton FC", name: "Southampton", shortName: "Southampton" },
  { match: "Swansea City AFC", name: "Swansea City", shortName: "Swansea" },
  { match: "Wolverhampton Wanderers FC", name: "Wolverhampton Wanderers", shortName: "Wolves" },
  { match: "West Bromwich Albion FC", name: "West Bromwich Albion", shortName: "West Brom" },
  { match: "Birmingham City FC", name: "Birmingham City", shortName: "Birmingham" },
  { match: "Stoke City FC", name: "Stoke City", shortName: "Stoke" },
  { match: "West Ham United FC", name: "West Ham United", shortName: "West Ham" },
  { match: "Queens Park Rangers FC", name: "Queens Park Rangers", shortName: "QPR" },
  { match: "Sheffield United FC", name: "Sheffield United", shortName: "Sheffield Utd" },
  { match: "Portsmouth FC", name: "Portsmouth", shortName: "Portsmouth" },
  { match: "Millwall FC", name: "Millwall", shortName: "Millwall" },
  { match: "Blackburn Rovers FC", name: "Blackburn Rovers", shortName: "Blackburn" },
  { match: "Bristol City FC", name: "Bristol City", shortName: "Bristol City" },
  { match: "Norwich City FC", name: "Norwich City", shortName: "Norwich" },
  { match: "Lincoln City FC", name: "Lincoln City", shortName: "Lincoln City" },
  { match: "Cardiff City FC", name: "Cardiff City", shortName: "Cardiff" },
  { match: "Wrexham AFC", name: "Wrexham", shortName: "Wrexham" },
  { match: "Bolton Wanderers FC", name: "Bolton Wanderers", shortName: "Bolton" },
  { match: "Charlton Athletic FC", name: "Charlton Athletic", shortName: "Charlton" },
  { match: "Watford FC", name: "Watford", shortName: "Watford" },
  { match: "Burnley FC", name: "Burnley", shortName: "Burnley" },
  { match: "Derby County FC", name: "Derby County", shortName: "Derby County" },
  { match: "Preston North End FC", name: "Preston North End", shortName: "Preston" },
  // Primeira Liga
  { match: "FC Porto", league: "PPL", name: "Porto", shortName: "Porto" },
  { match: "Sport Lisboa e Benfica", league: "PPL", name: "Benfica", shortName: "Benfica" },
  { match: "Sporting Clube de Portugal", league: "PPL", name: "Sporting", shortName: "Sporting" },
  { match: "Sporting Clube de Braga", league: "PPL", name: "Braga", shortName: "Braga" },
  { match: "Vitória SC", league: "PPL", name: "Vitória de Guimarães", shortName: "V. Guimarães" },
  { match: "FC Arouca", league: "PPL", name: "Arouca", shortName: "Arouca" },
  { match: "CD Santa Clara", league: "PPL", name: "Santa Clara", shortName: "Santa Clara" },
  { match: "Académico de Viseu FC", league: "PPL", name: "Académico de Viseu", shortName: "Académico Viseu" },
  { match: "Gil Vicente FC", league: "PPL", name: "Gil Vicente", shortName: "Gil Vicente" },
  { match: "Moreirense FC", league: "PPL", name: "Moreirense", shortName: "Moreirense" },
  { match: "FC Alverca", league: "PPL", name: "Alverca", shortName: "Alverca" },
  { match: "FC Famalicão", league: "PPL", name: "Famalicão", shortName: "Famalicão" },
  { match: "CF Estrela da Amadora", league: "PPL", name: "Estrela da Amadora", shortName: "Estrela Amadora" },
  { match: "CS Marítimo", league: "PPL", name: "Marítimo", shortName: "Marítimo" },
  { match: "Rio Ave FC", league: "PPL", name: "Rio Ave", shortName: "Rio Ave" },
  { match: "CD Nacional", league: "PPL", name: "Nacional", shortName: "Nacional" },
  { match: "Casa Pia AC", league: "PPL", name: "Casa Pia", shortName: "Casa Pia" },
  { match: "GD Estoril Praia", league: "PPL", name: "Estoril Praia", shortName: "Estoril" },
  // Eredivisie
  { match: "Feyenoord Rotterdam", league: "DED", name: "Feyenoord", shortName: "Feyenoord" },
  { match: "AFC Ajax", league: "DED", name: "Ajax", shortName: "Ajax" },
  { match: "PSV", league: "DED", name: "PSV Eindhoven", shortName: "PSV" },
  { match: "FC Twente '65", league: "DED", name: "FC Twente", shortName: "Twente" },
  { match: "AZ", league: "DED", name: "AZ Alkmaar", shortName: "AZ" },
  { match: "Fortuna Sittard", league: "DED", name: "Fortuna Sittard", shortName: "Fortuna" },
  { match: "SC Heerenveen", league: "DED", name: "Heerenveen", shortName: "Heerenveen" },
  { match: "FC Groningen", league: "DED", name: "Groningen", shortName: "Groningen" },
  { match: "SC Cambuur-Leeuwarden", league: "DED", name: "Cambuur", shortName: "Cambuur" },
  { match: "NEC", league: "DED", name: "NEC Nijmegen", shortName: "NEC" },
  { match: "SBV Excelsior", league: "DED", name: "Excelsior", shortName: "Excelsior" },
  { match: "Telstar 1963", league: "DED", name: "Telstar", shortName: "Telstar" },
  { match: "ADO Den Haag", league: "DED", name: "ADO Den Haag", shortName: "ADO" },
  { match: "Willem II Tilburg", league: "DED", name: "Willem II", shortName: "Willem II" },
];

const normalize = (text: string) => text.trim().toLowerCase();

function matches(team: Team, override: TeamOverride): boolean {
  if (typeof override.match === "number") return team.id === override.match;
  const wanted = normalize(override.match);
  return normalize(team.name) === wanted || normalize(team.shortName) === wanted;
}

export function applyTeamOverrides(
  teams: readonly Team[],
  { league, overrides = TEAM_OVERRIDES }: { league?: CompetitionCode; overrides?: readonly TeamOverride[] } = {},
): Team[] {
  const applicable = overrides.filter((o) => !o.league || o.league === league);
  return teams.map((team) => {
    const override = applicable.find((o) => matches(team, o));
    if (!override) return team;
    const { match: _match, league: _league, ...fields } = override;
    return { ...team, ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) };
  });
}
