import type { Team } from "../engine/types.ts";

// Crests for clubs ESPN has none for, from TheSportsDB (thesportsdb.com,
// community-uploaded artwork), matched by hand-checked script and saved under
// public/crests. Regenerate: NODE_USE_ENV_PROXY=1 node scripts/fetch-crests.mjs --download

export const CREST_FALLBACKS: Readonly<Record<number, string>> = {
  319: "/crests/319.png", // Kidderminster Harriers
  649: "/crests/649.png", // Worcester City
  2571: "/crests/2571.png", // Recreativo Huelva
  2589: "/crests/2589.png", // Stafford Rangers
  3748: "/crests/3748.png", // Pontevedra
  3835: "/crests/3835.png", // Xerez
  4002: "/crests/4002.png", // Potenza
  4347: "/crests/4347.png", // Ravenna
  4475: "/crests/4475.png", // Conquense
  4489: "/crests/4489.png", // Oxford City
  5401: "/crests/5401.png", // Real Jaen CF
  5421: "/crests/5421.png", // Barakaldo
  5424: "/crests/5424.png", // Sant Andreu
  5464: "/crests/5464.png", // Portugalete
  5535: "/crests/5535.png", // Badajoz
  6195: "/crests/6195.png", // Sociedade Imperatriz de Desportos
  6277: "/crests/6277.png", // SE Gama
  6318: "/crests/6318.png", // Hallescher FC
  6325: "/crests/6325.png", // SC Verl 1924
  6610: "/crests/6610.png", // SV Waldhof Mannheim
  6631: "/crests/6631.png", // SG Sonnenhof Großaspch
  6825: "/crests/6825.png", // Gimnastica Segoviana
  6827: "/crests/6827.png", // Alcoyano
  6856: "/crests/6856.png", // Sestao
  6858: "/crests/6858.png", // Guijuelo
  7041: "/crests/7041.png", // Peña Sport
  7277: "/crests/7277.png", // Bahlinger SC 1929
  7891: "/crests/7891.png", // Eintracht Trier
  8678: "/crests/8678.png", // Real Unión Irun
  8961: "/crests/8961.png", // Coruxo
  9141: "/crests/9141.png", // Don Benito
  9303: "/crests/9303.png", // Maranhao
  9414: "/crests/9414.png", // Poblense
  9449: "/crests/9449.png", // Antequera CF
  9705: "/crests/9705.png", // Rot-Weiss Essen
  12585: "/crests/12585.png", // CD Tudelano
  14263: "/crests/14263.png", // Atlético Baleares
  15557: "/crests/15557.png", // Oratorio
  15559: "/crests/15559.png", // Mixto
  15561: "/crests/15561.png", // Sousa EC
  15562: "/crests/15562.png", // Aguia de Maraba
  17326: "/crests/17326.png", // Ferroviaria
  17332: "/crests/17332.png", // Lagarto
  17492: "/crests/17492.png", // Viktoria Köln
  17565: "/crests/17565.png", // Zamora CF
  17569: "/crests/17569.png", // CD Varea
  17570: "/crests/17570.png", // Gimnástica Torrelavega
  17573: "/crests/17573.png", // Trival Valderas
  17713: "/crests/17713.png", // Jacuipense
  17715: "/crests/17715.png", // Maringá
  17888: "/crests/17888.png", // CD Laredo
  18190: "/crests/18190.png", // Galvez
  18192: "/crests/18192.png", // Tocantinopolis
  18195: "/crests/18195.png", // Ivinhema
  18334: "/crests/18334.png", // AE Prat
  18342: "/crests/18342.png", // San Sebastián de los Reyes
  18433: "/crests/18433.png", // Altos
  18747: "/crests/18747.png", // Lüneburger SK Hansa
  19233: "/crests/19233.png", // SSV Jeddeloh II
  19294: "/crests/19294.png", // Unionistas de Salamanca
  19962: "/crests/19962.png", // Castanhal U20
  20699: "/crests/20699.png", // CEOV Operário
  20735: "/crests/20735.png", // VSG Altglienicke
  20770: "/crests/20770.png", // Cray Wanderers
  20771: "/crests/20771.png", // Marine
  20776: "/crests/20776.png", // Anaitasuna
  20824: "/crests/20824.png", // Llanera
  20896: "/crests/20896.png", // Retró
  20897: "/crests/20897.png", // Porto Velho
  21290: "/crests/21290.png", // CE Europa
  21291: "/crests/21291.png", // Calvo Sotelo
  21299: "/crests/21299.png", // Aguilas
  21369: "/crests/21369.png", // Guarany de Bagé
  21384: "/crests/21384.png", // Azuriz
  21389: "/crests/21389.png", // Tuna Luso
  21508: "/crests/21508.png", // Schott
  21550: "/crests/21550.png", // Atletico Alagoinhas
  21553: "/crests/21553.png", // Trem
  21711: "/crests/21711.png", // Alvechurch
  21713: "/crests/21713.png", // Manacor
  21717: "/crests/21717.png", // Atlético Paso
  21722: "/crests/21722.png", // Manresa
  21723: "/crests/21723.png", // Utebo
  21957: "/crests/21957.png", // Westfalia Rhynern
  22043: "/crests/22043.png", // Mijas Las Lagunas
  22080: "/crests/22080.png", // Arosa
  22084: "/crests/22084.png", // Covadonga
  22190: "/crests/22190.png", // Capital
  22193: "/crests/22193.png", // Independente AP
  22194: "/crests/22194.png", // Manauara
  22272: "/crests/22272.png", // 1. FC Phönix Lübeck
  22372: "/crests/22372.png", // CD Baztán
  22430: "/crests/22430.png", // CD Extremadura
  22432: "/crests/22432.png", // CD Cuarte
  22439: "/crests/22439.png", // Real Ávila
  22440: "/crests/22440.png", // Salamanca UDS
  22468: "/crests/22468.png", // Harborough Town
  22487: "/crests/22487.png", // AE Velo Clube
  22489: "/crests/22489.png", // Betim FC
  22557: "/crests/22557.png", // Capital CF
  22559: "/crests/22559.png", // Independência
  22561: "/crests/22561.png", // Maracanã
  131218: "/crests/131218.png", // Hemelingen
  131403: "/crests/131403.png", // Atlético Calatayud
  131412: "/crests/131412.png", // Maracena
  131419: "/crests/131419.png", // Atlético Melilla
  131463: "/crests/131463.png", // Alcalá
  131465: "/crests/131465.png", // Atlético Tordesillas
  131466: "/crests/131466.png", // Cieza
  131470: "/crests/131470.png", // Reus FC Reddis
  131474: "/crests/131474.png", // UD Ourense
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
  131785: "/crests/131785.png", // HEBC Hamburg
  131786: "/crests/131786.png", // VFB Krieschow
  131787: "/crests/131787.png", // SC St. Tönis
  131836: "/crests/131836.png", // Union Brescia
  132144: "/crests/132144.png", // Salisbury FC
  132350: "/crests/132350.png", // Berkhamsted
  132415: "/crests/132415.png", // AFC Rushden & Diamonds
  132948: "/crests/132948.png", // Plymouth Parkway
  133366: "/crests/133366.png", // Sholing
  133370: "/crests/133370.png", // Wimborne Town
  133831: "/crests/133831.png", // Sporting Hortaleza
  133833: "/crests/133833.png", // Atlético Unión Güímar
  133834: "/crests/133834.png", // Ciudad De Lucena
  133835: "/crests/133835.png", // CD Pamplona
  133837: "/crests/133837.png", // CD Tarancon
  133838: "/crests/133838.png", // CD Tedeón
  133839: "/crests/133839.png", // CF Calamocha
  133841: "/crests/133841.png", // CP Talayuela
  133842: "/crests/133842.png", // Ribadesella
  133843: "/crests/133843.png", // Sporting de Alcázar
  133844: "/crests/133844.png", // UB Lebrijana
  133845: "/crests/133845.png", // UD Castellonense
  133846: "/crests/133846.png", // Tavernes de la Valldigna
  133847: "/crests/133847.png", // Auriense Cented Academy
  133850: "/crests/133850.png", // SD Noja
  133851: "/crests/133851.png", // Ceuta 6 de Junio
};

/** Gives clubs without a crest the saved one, keyed by ESPN team id; ESPN's own crests stay. */
export function withFallbackCrests(teams: readonly Team[]): Team[] {
  return teams.map((team) => (team.crest || !CREST_FALLBACKS[team.id] ? team : { ...team, crest: CREST_FALLBACKS[team.id] }));
}
