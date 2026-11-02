import type { Team } from "../engine/types.ts";

// Crests for clubs ESPN has none for, from TheSportsDB (thesportsdb.com,
// community-uploaded artwork), matched by hand-checked script and saved under
// public/crests. Regenerate: NODE_USE_ENV_PROXY=1 node scripts/fetch-crests.mjs --download

export const CREST_FALLBACKS: Readonly<Record<number, string>> = {
  319: "/crests/319.png", // Kidderminster Harriers
  649: "/crests/649.png", // Worcester City
  2589: "/crests/2589.png", // Stafford Rangers
  4489: "/crests/4489.png", // Oxford City
  6195: "/crests/6195.png", // Sociedade Imperatriz de Desportos
  6277: "/crests/6277.png", // SE Gama
  9303: "/crests/9303.png", // Maranhao
  15557: "/crests/15557.png", // Oratorio
  15559: "/crests/15559.png", // Mixto
  15561: "/crests/15561.png", // Sousa EC
  15562: "/crests/15562.png", // Aguia de Maraba
  17326: "/crests/17326.png", // Ferroviaria
  17332: "/crests/17332.png", // Lagarto
  17713: "/crests/17713.png", // Jacuipense
  17715: "/crests/17715.png", // Maringá
  18190: "/crests/18190.png", // Galvez
  18192: "/crests/18192.png", // Tocantinopolis
  18195: "/crests/18195.png", // Ivinhema
  18433: "/crests/18433.png", // Altos
  19962: "/crests/19962.png", // Castanhal U20
  20699: "/crests/20699.png", // CEOV Operário
  20770: "/crests/20770.png", // Cray Wanderers
  20771: "/crests/20771.png", // Marine
  20896: "/crests/20896.png", // Retró
  20897: "/crests/20897.png", // Porto Velho
  21369: "/crests/21369.png", // Guarany de Bagé
  21384: "/crests/21384.png", // Azuriz
  21389: "/crests/21389.png", // Tuna Luso
  21550: "/crests/21550.png", // Atletico Alagoinhas
  21553: "/crests/21553.png", // Trem
  21711: "/crests/21711.png", // Alvechurch
  22190: "/crests/22190.png", // Capital
  22193: "/crests/22193.png", // Independente AP
  22194: "/crests/22194.png", // Manauara
  22468: "/crests/22468.png", // Harborough Town
  22487: "/crests/22487.png", // AE Velo Clube
  22489: "/crests/22489.png", // Betim FC
  22557: "/crests/22557.png", // Capital CF
  22559: "/crests/22559.png", // Independência
  22561: "/crests/22561.png", // Maracanã
  131671: "/crests/131671.png", // Bare
  131672: "/crests/131672.png", // Clube Laguna
  131674: "/crests/131674.png", // Guapore
  131676: "/crests/131676.png", // Santa Catarina
  131678: "/crests/131678.png", // Tirol
  131680: "/crests/131680.png", // Serra Branca
  131681: "/crests/131681.png", // Maguary PE
  131682: "/crests/131682.png", // Monte Roraima
  131684: "/crests/131684.png", // IAPE
  131686: "/crests/131686.png", // SC Penedense
  131687: "/crests/131687.png", // Porto Vitória FC
  131708: "/crests/131708.png", // Barra FC
  132144: "/crests/132144.png", // Salisbury FC
  132350: "/crests/132350.png", // Berkhamsted
  132415: "/crests/132415.png", // AFC Rushden & Diamonds
  132948: "/crests/132948.png", // Plymouth Parkway
  133366: "/crests/133366.png", // Sholing
  133370: "/crests/133370.png", // Wimborne Town
};

/** Gives clubs without a crest the saved one, keyed by ESPN team id; ESPN's own crests stay. */
export function withFallbackCrests(teams: readonly Team[]): Team[] {
  return teams.map((team) => (team.crest || !CREST_FALLBACKS[team.id] ? team : { ...team, crest: CREST_FALLBACKS[team.id] }));
}
