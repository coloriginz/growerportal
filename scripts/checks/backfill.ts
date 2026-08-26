import { quarterChunks, backfillJobs } from "../../src/lib/sync/backfill";
import {
  applyBackfillFloor,
  describeStart,
  firstDeliveryFrom,
  resolveBackfillStart,
} from "../../src/lib/sync/backfill-start";

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) console.log(`PASS ${label}`);
  else {
    failures++;
    console.log(`FAIL ${label}${detail ? " — " + detail : ""}`);
  }
}

const d = (s: string) => new Date(s + "T00:00:00.000Z");

// Een basisdatum middenin een kwartaal begint bij het begin van dat kwartaal:
// anders mist de eerste brok de leveringen van januari en februari.
const midden = quarterChunks(d("2024-02-14"), d("2024-05-05"));
check("begint bij het begin van het kwartaal",
  midden[0].from.toISOString().startsWith("2024-01-01"));
check("het lopende kwartaal telt mee", midden.length === 2);
check("de laatste brok loopt tot het volgende kwartaal",
  midden[1].to.toISOString().startsWith("2024-07-01"));
check("brokken sluiten op elkaar aan",
  midden[0].to.getTime() === midden[1].from.getTime(),
  "een gat tussen twee brokken is data die niemand ooit ophaalt");
check("het label is leesbaar", midden[0].label === "2024 Q1" && midden[1].label === "2024 Q2");

// Elf kwartalen van 2024 Q1 tot en met 2026 Q3.
const elf = quarterChunks(d("2024-01-01"), d("2026-08-20"));
check("2024-01-01 tot augustus 2026 is elf kwartalen", elf.length === 11);
check("elke brok is precies één kwartaal en sluit aan op de volgende",
  elf.every((c, i) => (i === 0 || c.from.getTime() === elf[i - 1].to.getTime())),
  "addQuarter moet over de jaargrens heen rollen, van 2024 Q4 naar 2025 Q1");
check("de labels rollen over de jaargrens",
  elf[3].label === "2024 Q4" && elf[4].label === "2025 Q1");

// De indeling rekent in UTC. Deze twee momenten liggen aan weerszijden van de
// kwartaalgrens; met lokale getters valt er één aan de verkeerde kant, welke
// hangt af van de tijdzone van het werkstation. Zo faalt de controle in elke
// tijdzone behalve UTC zelf als de UTC-getters ooit sneuvelen.
check("een basisdatum precies op de kwartaalgrens hoort bij het nieuwe kwartaal",
  quarterChunks(d("2024-04-01"), d("2024-04-02"))[0].label === "2024 Q2",
  "2024-04-01T00:00:00Z is Q2, niet Q1");
check("het laatste moment vóór de grens hoort bij het oude kwartaal",
  quarterChunks(new Date("2024-03-31T23:00:00.000Z"), d("2024-04-02"))[0].label === "2024 Q1");

check("nu op de laatste dag van een kwartaal sluit dat kwartaal nog niet af",
  (() => {
    const laatsteDag = quarterChunks(d("2024-01-15"), new Date("2024-03-31T23:59:59.999Z"));
    return laatsteDag.length === 1 && laatsteDag[0].to.toISOString().startsWith("2024-04-01");
  })(),
  "het lopende kwartaal loopt altijd door tot de volgende grens, ook op de slotdag");

check("een basisdatum in de toekomst levert niets op",
  quarterChunks(d("2027-01-01"), d("2026-08-20")).length === 0,
  "liever nul brokken dan een backfill die achteruit loopt");

check("dezelfde invoer levert dezelfde vensters",
  JSON.stringify(quarterChunks(d("2024-02-14"), d("2024-05-05"))) === JSON.stringify(midden),
  "een tweede backfill moet met de eerste te vergelijken zijn");

// De joblijst.
const jobs = backfillJobs(quarterChunks(d("2026-01-01"), d("2026-08-20")));
check("kwekers staan vooraan", jobs[0].endpoint === "growers" && jobs[0].sequence === 0,
  "de lots-import gooit partijen weg waarvan de kweker ontbreekt");
check("kwekers krijgen de volle spanwijdte",
  jobs[0].from.toISOString().startsWith("2026-01-01") &&
  jobs[0].to.toISOString().startsWith("2026-10-01"));
check("de stamdatajob hoort bij geen enkel kwartaal", jobs[0].label === null,
  "de voortgangskaart groepeert op label; een kwartaallabel zou hem in Q1 hangen");
check("drie endpoints per kwartaal", jobs.length === 1 + 3 * 3);
check("de ketenvolgorde klopt binnen een kwartaal",
  jobs[1].endpoint === "lots" && jobs[2].endpoint === "orders" && jobs[3].endpoint === "costs");
check("de drie jobs van een kwartaal delen venster en label",
  jobs.slice(1, 4).every((j) =>
    j.label === "2026 Q1" &&
    j.from.getTime() === jobs[1].from.getTime() &&
    j.to.getTime() === jobs[1].to.getTime()));
check("volgnummers lopen door zonder gat",
  jobs.every((j, i) => j.sequence === i),
  "de wachtrij wacht op het vorige volgnummer; een gat zet alles stil");
check("leveranciers zitten er niet bij",
  jobs.every((j) => j.endpoint !== "suppliers"),
  "die bestaat al — dat is de aanleiding voor de backfill");

check("elf kwartalen zijn vierendertig jobs", backfillJobs(elf).length === 34,
  "het getal dat in de bevestiging aan de gebruiker wordt getoond");

check("zonder brokken zijn er geen jobs", backfillJobs([]).length === 0,
  "een basisdatum in de toekomst loopt hierin door; zonder afvanger leest hij chunks[0]");

// ─── De startdatum per leverancier ───────────────────────────────────────────

const globaal = d("2025-01-01");

// De ondergrens is de hele valkuil: COLXGREE levert sinds 30-08-2023, en puur op
// de eerste partij plannen maakt zijn backfill juist groter.
const gevestigd = applyBackfillFloor(d("2023-08-30"), globaal);
check("een eerste levering vóór de globale datum verliest",
  gevestigd.start?.getTime() === globaal.getTime() && gevestigd.source === "setting",
  "anders groeit de backfill van een gevestigde leverancier van zeven naar twaalf kwartalen");
check("de gevonden levering blijft in het antwoord staan",
  gevestigd.firstDelivery !== null && gevestigd.firstDelivery.toISOString().startsWith("2023-08-30"),
  "het scherm mag laten zien wat er gevraagd is, ook als het niet doorslaggevend was");

// COLXIMA: eerste partij 10-07-2026, dus één kwartaal in plaats van zeven.
const nieuw = applyBackfillFloor(d("2026-07-10"), globaal);
check("een latere eerste levering schuift de start op",
  nieuw.start !== null && nieuw.start.toISOString().startsWith("2026-07-01") &&
  nieuw.source === "fabric");
check("de opgeschoven start scheelt zes kwartalen",
  quarterChunks(nieuw.start!, d("2026-08-25")).length === 1 &&
  quarterChunks(globaal, d("2026-08-25")).length === 7);

check("een eerste levering in hetzelfde kwartaal als de globale datum verandert niets",
  (() => {
    const zelfde = applyBackfillFloor(d("2025-02-05"), globaal);
    return zelfde.start?.getTime() === globaal.getTime() && zelfde.source === "setting";
  })(),
  "het kwartaal van 05-02-2025 begint vóór de globale datum, dus die houdt stand");

const geenPartij = applyBackfillFloor(null, globaal);
check("geen consignatiepartij levert geen startdatum op",
  geenPartij.start === null && geenPartij.source === "fabric",
  "liever niets in de wachtrij dan tweeëntwintig jobs die allemaal leeg terugkomen");

// Het antwoord van de vraag-flow.
check("een leeg antwoord is geen partij", firstDeliveryFrom([]) === null);
check("een rij met een lege MIN is geen partij",
  firstDeliveryFrom([{ eerste_levering: null }]) === null);
check("de datum wordt als UTC gelezen",
  firstDeliveryFrom([{ eerste_levering: "2026-07-01T00:00:00" }])
    ?.toISOString() === "2026-07-01T00:00:00.000Z",
  "lokaal gelezen valt deze grensdatum ten oosten van UTC een kwartaal te vroeg");
check("de kolomnaam doet er niet toe",
  firstDeliveryFrom([{ willekeurig: "2026-07-10" }])?.toISOString().startsWith("2026-07-10") === true,
  "de flow staat los van deze code; een hernoemde alias mag geen stille null geven");
check("een onleesbaar antwoord gooit",
  (() => {
    try {
      firstDeliveryFrom([{ eerste_levering: "onzin" }]);
      return false;
    } catch {
      return true;
    }
  })(),
  "een kapotte flow is iets anders dan een leverancier zonder partijen");

// De resolver zelf, met een ask die niets over het net doet.
const askt = (rijen: Record<string, unknown>[]) => {
  const gesteld: string[] = [];
  return {
    gesteld,
    ask: async (query: string) => {
      gesteld.push(query);
      return rijen;
    },
  };
};

async function main() {
  const goed = askt([{ eerste_levering: "2026-07-10T00:00:00" }]);
  const uitFabric = await resolveBackfillStart(4711, globaal, goed.ask);
  check("de resolver neemt de datum uit Fabric over",
    uitFabric.start !== null && uitFabric.start.toISOString().startsWith("2026-07-01") &&
    uitFabric.source === "fabric");
  check("de vraag is op deze leverancier en op consignatie gefilterd",
    /rel_id_leverancier = 4711/.test(goed.gesteld[0]) &&
    /inkooptype_code IN \('CONS'\)/.test(goed.gesteld[0]),
    "een MIN zonder leveranciersfilter is de eerste partij van het hele warehouse");

  const leeg = await resolveBackfillStart(4711, globaal, askt([]).ask);
  check("een lege MIN geeft geen startdatum", leeg.start === null && leeg.source === "fabric");

  const stuk = await resolveBackfillStart(4711, globaal, async () => {
    throw new Error("Vraag-flow gaf 504");
  });
  check("een falende vraag-flow valt terug op de globale datum",
    stuk.start?.getTime() === globaal.getTime() &&
    stuk.source === "setting" &&
    stuk.firstDelivery === null,
    "een leverancier on-boarden mag niet stranden op een haperende flow");

  check("het antwoord voor het scherm noemt kwartaal, dag en reden",
    (() => {
      const beschreven = describeStart({ ...uitFabric, start: uitFabric.start! });
      return beschreven.quarter === "2026 Q3" &&
        beschreven.from === "2026-07-01" &&
        beschreven.firstDelivery === "2026-07-10" &&
        beschreven.source === "fabric";
    })());

  console.log(failures === 0 ? "\nalle controles geslaagd" : `\n${failures} controle(s) gefaald`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
