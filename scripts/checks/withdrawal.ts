import { resolveWithdrawalScope } from "../../src/lib/sync/withdrawal";

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) console.log(`PASS ${label}`);
  else {
    failures++;
    console.log(`FAIL ${label}${detail ? " — " + detail : ""}`);
  }
}

const venster = {
  windowFrom: new Date("2026-06-01T00:00:00Z"),
  windowTo: new Date("2026-07-01T00:00:00Z"),
  supplierFabricId: null,
};

check(
  "een gewone ronde ruimt het hele venster op",
  resolveWithdrawalScope({ job: venster, supplierId: null, payloadRows: 4123, priorRows: 0 }).mode === "window"
);

const breed = resolveWithdrawalScope({ job: venster, supplierId: null, payloadRows: 4123, priorRows: 0 });
check(
  "een ronde zonder leverancier houdt de scope leeg",
  breed.mode === "window" && breed.supplierId === null,
  "een lege scope betekent alle leveranciers, precies wat de query ook uitvroeg"
);

const perLev = resolveWithdrawalScope({
  job: { ...venster, supplierFabricId: 11467 },
  supplierId: "sup-abc",
  payloadRows: 812,
  priorRows: 0,
});
check(
  "een backfill voor één leverancier ruimt alleen die leverancier op",
  perLev.mode === "window" && perLev.supplierId === "sup-abc"
);

check(
  "zonder sync-job blijft het bij de paren",
  resolveWithdrawalScope({ job: null, supplierId: null, payloadRows: 900, priorRows: 0 }).mode === "pairs",
  "de oude DAX-flows en de reparatiescripts posten zonder batchId en kennen geen venster; " +
    "wat zij niet meesturen is geen bewijs dat het weg mag"
);

check(
  "een lege payload ruimt niets op",
  resolveWithdrawalScope({ job: venster, supplierId: null, payloadRows: 0, priorRows: 0 }).mode === "pairs",
  "Fabric gaf op 26-08-2026 drie keer op rij zonder fout een lege recordset terug waar 1.511 rijen hoorden; " +
    "op zo'n antwoord een heel venster wissen valt niet op"
);

check(
  "een leveranciersjob zonder bekende leverancier verbreedt niet naar iedereen",
  resolveWithdrawalScope({
    job: { ...venster, supplierFabricId: 99999 },
    supplierId: null,
    payloadRows: 812,
    priorRows: 0,
  }).mode === "pairs",
  "zonder deze grens wist een backfill voor één kweker het venster van alle leveranciers"
);

check(
  "een leeg venster ruimt niets op",
  resolveWithdrawalScope({
    job: { ...venster, windowTo: venster.windowFrom },
    supplierId: null,
    payloadRows: 10,
    priorRows: 0,
  }).mode === "pairs"
);

check(
  "een omgekeerd venster ruimt niets op",
  resolveWithdrawalScope({
    job: { windowFrom: venster.windowTo, windowTo: venster.windowFrom, supplierFabricId: null },
    supplierId: null,
    payloadRows: 10,
    priorRows: 0,
  }).mode === "pairs"
);

check(
  "de reden staat erbij als er niet is opgeruimd",
  (() => {
    const r = resolveWithdrawalScope({ job: null, supplierId: null, payloadRows: 5, priorRows: 0 });
    return r.mode === "pairs" && r.reason.length > 0;
  })(),
  "het verschil tussen 'niets ingetrokken' en 'niet gekeken' moet zichtbaar zijn in de batch"
);

check(
  "een tweede payload op dezelfde batch ruimt het venster niet op",
  resolveWithdrawalScope({ job: venster, supplierId: null, payloadRows: 2000, priorRows: 1500 })
    .mode === "pairs",
  "eén job is eén query is eén POST — maar dat is gedrag aan de andere kant van een webhook, " +
    "en zonder deze rem gooit de tweede payload weg wat de eerste net schreef"
);

check(
  "de reden noemt hoeveel er al binnen was",
  (() => {
    const r = resolveWithdrawalScope({
      job: venster,
      supplierId: null,
      payloadRows: 2000,
      priorRows: 1500,
    });
    return r.mode === "pairs" && r.reason.includes("1500");
  })()
);

console.log(failures === 0 ? "\nalle checks geslaagd" : `\n${failures} check(s) gefaald`);
process.exit(failures === 0 ? 0 : 1);
