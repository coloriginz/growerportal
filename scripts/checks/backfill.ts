import { quarterChunks, backfillJobs } from "../../src/lib/sync/backfill";

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

console.log(failures === 0 ? "\nalle controles geslaagd" : `\n${failures} controle(s) gefaald`);
process.exit(failures === 0 ? 0 : 1);
