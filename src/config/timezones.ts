import type { CompetitionCode } from "./leagues.ts";

/**
 * Each domestic league's local time zone: the date in a game's page address
 * and the kick-off time shown before the visitor's own clock takes over. MLS
 * spans four zones; its fixtures are listed in Eastern time, as the league does.
 */
export const LEAGUE_TIME_ZONES: Partial<Record<CompetitionCode, string>> = {
  PL: "Europe/London",
  ELC: "Europe/London",
  EL1: "Europe/London",
  EL2: "Europe/London",
  PD: "Europe/Madrid",
  SD: "Europe/Madrid",
  BL1: "Europe/Berlin",
  BL2: "Europe/Berlin",
  SA: "Europe/Rome",
  SB: "Europe/Rome",
  FL1: "Europe/Paris",
  FL2: "Europe/Paris",
  PPL: "Europe/Lisbon",
  DED: "Europe/Amsterdam",
  DJL: "Europe/Amsterdam",
  SPFL: "Europe/London",
  TSL: "Europe/Istanbul",
  BPL: "Europe/Brussels",
  GSL: "Europe/Athens",
  ABL: "Europe/Vienna",
  BSA: "America/Sao_Paulo",
  BSB: "America/Sao_Paulo",
  BSC: "America/Sao_Paulo",
  MLS: "America/New_York",
  ARG: "America/Argentina/Buenos_Aires",
  CHI: "America/Santiago",
  COL: "America/Bogota",
  URU: "America/Montevideo",
  PAR: "America/Asuncion",
  MX: "America/Mexico_City",
  ECU: "America/Guayaquil",
  PER: "America/Lima",
  J1: "Asia/Tokyo",
  SPL: "Asia/Riyadh",
};

export const leagueTimeZone = (code: CompetitionCode) => LEAGUE_TIME_ZONES[code] ?? "UTC";
