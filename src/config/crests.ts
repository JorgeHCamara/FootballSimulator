import type { Team } from "../engine/types.ts";
import { CREST_CUTOUTS } from "./crestCutouts.ts";

// Crests for clubs ESPN has none for, from TheSportsDB (thesportsdb.com,
// community-uploaded artwork), matched by hand-checked script and saved under
// public/crests. Regenerate: NODE_USE_ENV_PROXY=1 node scripts/fetch-crests.mjs --download

export const CREST_FALLBACKS: Readonly<Record<number, string>> = {
  168: "/crests/168.png", // Sedan
  319: "/crests/319.png", // Kidderminster Harriers
  649: "/crests/649.png", // Worcester City
  2571: "/crests/2571.png", // Recreativo Huelva
  2589: "/crests/2589.png", // Stafford Rangers
  3200: "/crests/3200.png", // Chamois Niortais FC
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
  7296: "/crests/7296.png", // Vesoul
  7574: "/crests/7574.png", // Vannes OC
  7720: "/crests/7720.png", // Angouleme
  7725: "/crests/7725.png", // Amneville
  7729: "/crests/7729.png", // Chateaubriant
  7891: "/crests/7891.png", // Eintracht Trier
  8678: "/crests/8678.png", // Real Unión Irun
  8961: "/crests/8961.png", // Coruxo
  9009: "/crests/9009.png", // Rouen
  9010: "/crests/9010.png", // Epinal
  9011: "/crests/9011.png", // Selongey
  9017: "/crests/9017.png", // Avranches
  9021: "/crests/9021.png", // Frejus
  9024: "/crests/9024.png", // Le Poire SV
  9141: "/crests/9141.png", // Don Benito
  9303: "/crests/9303.png", // Maranhao
  9414: "/crests/9414.png", // Poblense
  9449: "/crests/9449.png", // Antequera CF
  9705: "/crests/9705.png", // Rot-Weiss Essen
  10225: "/crests/10225.png", // Chauny
  10232: "/crests/10232.png", // Vitre
  10235: "/crests/10235.png", // Villefranche
  10680: "/crests/10680.png", // Balma
  10683: "/crests/10683.png", // Thionville
  10685: "/crests/10685.png", // Trelissac FC
  10693: "/crests/10693.png", // Plabennec
  11303: "/crests/11303.png", // Vertou
  11313: "/crests/11313.png", // Fontenay Foot
  12585: "/crests/12585.png", // CD Tudelano
  12957: "/crests/12957.png", // Sablé FC
  14263: "/crests/14263.png", // Atlético Baleares
  14381: "/crests/14381.png", // Avenir Foot Lozere
  14439: "/crests/14439.png", // Pontarlier
  15557: "/crests/15557.png", // Oratorio
  15559: "/crests/15559.png", // Mixto
  15561: "/crests/15561.png", // Sousa EC
  15562: "/crests/15562.png", // Aguia de Maraba
  16735: "/crests/16735.png", // Neslois
  16913: "/crests/16913.png", // Olympique Marcquois
  16916: "/crests/16916.png", // IC Croix
  16917: "/crests/16917.png", // La Roche-sur-Yon
  16925: "/crests/16925.png", // Bressuire
  17326: "/crests/17326.png", // Ferroviaria
  17332: "/crests/17332.png", // Lagarto
  17492: "/crests/17492.png", // Viktoria Köln
  17565: "/crests/17565.png", // Zamora CF
  17569: "/crests/17569.png", // CD Varea
  17570: "/crests/17570.png", // Gimnástica Torrelavega
  17573: "/crests/17573.png", // Trival Valderas
  17621: "/crests/17621.png", // Anglet Genets
  17623: "/crests/17623.png", // US Marseille Endoume
  17713: "/crests/17713.png", // Jacuipense
  17715: "/crests/17715.png", // Maringá
  17888: "/crests/17888.png", // CD Laredo
  18064: "/crests/18064.png", // Racing Besancon
  18085: "/crests/18085.png", // Bourges Foot
  18101: "/crests/18101.png", // Hauts Lyonnais
  18120: "/crests/18120.png", // Am. du Personnel Municipal Metz
  18190: "/crests/18190.png", // Galvez
  18192: "/crests/18192.png", // Tocantinopolis
  18195: "/crests/18195.png", // Ivinhema
  18328: "/crests/18328.png", // San Martín de Formosa
  18334: "/crests/18334.png", // AE Prat
  18342: "/crests/18342.png", // San Sebastián de los Reyes
  18400: "/crests/18400.png", // FC Fleury 91
  18433: "/crests/18433.png", // Altos
  18747: "/crests/18747.png", // Lüneburger SK Hansa
  18901: "/crests/18901.png", // Biesheim
  18906: "/crests/18906.png", // Le Puy
  18907: "/crests/18907.png", // Senlis
  19144: "/crests/19144.png", // Deportivo Rincón
  19233: "/crests/19233.png", // SSV Jeddeloh II
  19294: "/crests/19294.png", // Unionistas de Salamanca
  19388: "/crests/19388.png", // FC Limonest
  19390: "/crests/19390.png", // Stade Pontivy
  19393: "/crests/19393.png", // GSI Pontivy
  19962: "/crests/19962.png", // Castanhal U20
  20272: "/crests/20272.png", // FC Challans
  20699: "/crests/20699.png", // CEOV Operário
  20735: "/crests/20735.png", // VSG Altglienicke
  20770: "/crests/20770.png", // Cray Wanderers
  20771: "/crests/20771.png", // Marine
  20776: "/crests/20776.png", // Anaitasuna
  20824: "/crests/20824.png", // Llanera
  20871: "/crests/20871.png", // Rumilly Vallières
  20876: "/crests/20876.png", // Loon Plage FC
  20896: "/crests/20896.png", // Retró
  20897: "/crests/20897.png", // Porto Velho
  21290: "/crests/21290.png", // CE Europa
  21291: "/crests/21291.png", // Calvo Sotelo
  21299: "/crests/21299.png", // Aguilas
  21303: "/crests/21303.png", // ES Thaon
  21306: "/crests/21306.png", // AS Cannes
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
  21772: "/crests/21772.png", // Lannion
  21773: "/crests/21773.png", // Strasbourg Koenigshoffen
  21817: "/crests/21817.png", // AF Virois
  21957: "/crests/21957.png", // Westfalia Rhynern
  22043: "/crests/22043.png", // Mijas Las Lagunas
  22080: "/crests/22080.png", // Arosa
  22084: "/crests/22084.png", // Covadonga
  22138: "/crests/22138.png", // US Feurs
  22139: "/crests/22139.png", // Racing Club de France
  22166: "/crests/22166.png", // Argentino Monte Maíz
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
  22521: "/crests/22521.png", // Sarmiento de La Banda
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
  131572: "/crests/131572.png", // Stade Béthunois
  131576: "/crests/131576.png", // Montreuil FC
  131651: "/crests/131651.png", // Gimnasia Chivilcoy
  131652: "/crests/131652.png", // Sportivo Atenas
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
  132434: "/crests/132434.png", // Paris 13 Atletico
  132785: "/crests/132785.png", // SC Toulon
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
  134063: "/crests/134063.png", // Chassieu Declines FC
  134064: "/crests/134064.png", // Olympique Charleville Prix AM
  134065: "/crests/134065.png", // Olympique des Membres de Cambrai Amerique
  134066: "/crests/134066.png", // ESAP Metz
  134068: "/crests/134068.png", // Cercle Paul Bert Brequigny Football
  134069: "/crests/134069.png", // CA Boulay
  134071: "/crests/134071.png", // Montlucon Football
  134072: "/crests/134072.png", // Seyssinet
  134075: "/crests/134075.png", // Verson
  134077: "/crests/134077.png", // Maisons-Alfort
  134078: "/crests/134078.png", // Racing Chambery
  134079: "/crests/134079.png", // Neuvillette-Jamin
  134080: "/crests/134080.png", // Contres
  134081: "/crests/134081.png", // Veauche
  134082: "/crests/134082.png", // Sag Cestas
  134083: "/crests/134083.png", // Perros-Louannec
  134085: "/crests/134085.png", // Les Ulis
  134086: "/crests/134086.png", // Tremblay
  134088: "/crests/134088.png", // Koetzingue
  134089: "/crests/134089.png", // St Paul en Jarez
  134090: "/crests/134090.png", // Asptt Dijon
  134091: "/crests/134091.png", // Choisy Au Bac
  134092: "/crests/134092.png", // Union Cosnoise
  134093: "/crests/134093.png", // Juventus Papus
  134094: "/crests/134094.png", // Val Yerres Crosne
  134096: "/crests/134096.png", // Atlas Paillade
  134097: "/crests/134097.png", // Sundhoffen
  134098: "/crests/134098.png", // Montlouis
  134102: "/crests/134102.png", // Massay
  134103: "/crests/134103.png", // Nueillaubiers
  134104: "/crests/134104.png", // USF Fecamp
  134105: "/crests/134105.png", // Mazeres Uzos Rontignon
  134106: "/crests/134106.png", // Castanet
  134107: "/crests/134107.png", // Boulazac
  134108: "/crests/134108.png", // Firminy
  134109: "/crests/134109.png", // Tourcoing
  134110: "/crests/134110.png", // Baume-Les-Dames
  134111: "/crests/134111.png", // Stade Castelbourgeois
  134112: "/crests/134112.png", // Violaines
  134113: "/crests/134113.png", // Le Pays Du Valois
  134114: "/crests/134114.png", // Saint-Die Kellermann
  134115: "/crests/134115.png", // Rives 82
  134116: "/crests/134116.png", // Talange
  134117: "/crests/134117.png", // Chambéry Savoie
  134118: "/crests/134118.png", // ES Buxerolles
  134119: "/crests/134119.png", // Furiani-Agliani
  134120: "/crests/134120.png", // Oberlauterbach
  134121: "/crests/134121.png", // La Baule-Le Pouliguen
  134123: "/crests/134123.png", // Chatou
  134124: "/crests/134124.png", // St Martin Tatinghem
  134125: "/crests/134125.png", // Tinteniac St Domineuc
  134126: "/crests/134126.png", // Le Touquet
  134128: "/crests/134128.png", // Balagne
  134129: "/crests/134129.png", // Reipertswiller
  134130: "/crests/134130.png", // Claira / St Laurent
  134131: "/crests/134131.png", // Montigny-Les-Metz
  134132: "/crests/134132.png", // St Andre St Macaire
  134133: "/crests/134133.png", // RIOM
  134134: "/crests/134134.png", // Cournon
  134135: "/crests/134135.png", // Riviera
  134141: "/crests/134141.png", // Siroco Les Abymes
  134142: "/crests/134142.png", // US Cheminots Paray-Foot
  134144: "/crests/134144.png", // Puissalicon Magalas
  134145: "/crests/134145.png", // Vermelles
  134148: "/crests/134148.png", // Stade Bordelais
  134151: "/crests/134151.png", // Saint-Renan
  134152: "/crests/134152.png", // Saint Sebastien
  134153: "/crests/134153.png", // Rhone Crussol Foot
};

/**
 * Gives clubs without a crest the saved one, keyed by ESPN team id; ESPN's own
 * crests stay, cut out where they come with a background (src/config/crestCutouts.ts).
 */
export function withFallbackCrests(teams: readonly Team[]): Team[] {
  return teams.map((team) => {
    const crest = team.crest || CREST_FALLBACKS[team.id];
    if (!crest) return team;
    // A crest that comes with a background shows cut out, while it's still the one the cut-out was made from.
    const cutout = CREST_CUTOUTS[team.id];
    const shown = cutout && cutout.from === crest ? cutout.crest : crest;
    return shown === team.crest ? team : { ...team, crest: shown };
  });
}
