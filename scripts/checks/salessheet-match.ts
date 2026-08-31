import {
  SALESSHEET_MATCH_TOLERANCE,
  resolveSalesSheetMatch,
} from "../../src/lib/salessheet-match";

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) console.log(`PASS ${label}`);
  else {
    failures++;
    console.log(`FAIL ${label}${detail ? " — " + detail : ""}`);
  }
}

const GELEZEN = new Date("2026-08-30T00:00:00Z");

check(
  "zonder PDF valt er niets te zeggen",
  resolveSalesSheetMatch({
    hasPdf: false,
    pdfParsedAt: null,
    pdfNetResult: null,
    pdfTurnover: null,
    pdfCosts: null,
    computedNetResult: 1234.56,
  }) === "unlinked"
);

check(
  "een PDF die nog niet gelezen is telt als niet-beoordeelbaar, net als geen PDF",
  resolveSalesSheetMatch({
    hasPdf: true,
    pdfParsedAt: null,
    pdfNetResult: null,
    pdfTurnover: null,
    pdfCosts: null,
    computedNetResult: 1234.56,
  }) === "unlinked",
  "nog niet gelezen zegt niets over de levering, alleen over onze achterstand"
);

check(
  "gelezen zonder bedrag is onze storing",
  resolveSalesSheetMatch({
    hasPdf: true,
    pdfParsedAt: GELEZEN,
    pdfNetResult: null,
    pdfTurnover: null,
    pdfCosts: null,
    computedNetResult: 1234.56,
  }) === "unread",
  "het document is bekeken en gaf geen netto, ook geen omzet om het uit af te leiden; " +
    "dat is een parserprobleem en hoort zichtbaar te zijn in plaats van weg te vallen " +
    "tussen de leveringen zonder PDF"
);

check(
  "gelijke bedragen zijn een match",
  resolveSalesSheetMatch({
    hasPdf: true,
    pdfParsedAt: GELEZEN,
    pdfNetResult: 1234.56,
    pdfTurnover: null,
    pdfCosts: null,
    computedNetResult: 1234.56,
  }) === "match"
);

check(
  "een cent verschil is afronding, geen fout",
  resolveSalesSheetMatch({
    hasPdf: true,
    pdfParsedAt: GELEZEN,
    pdfNetResult: 583.46,
    pdfTurnover: null,
    pdfCosts: null,
    computedNetResult: 583.47,
  }) === "match",
  "SalesSheetCost.amount draagt vijf decimalen en de sales sheet telt op vóór hij " +
    "afrondt; 13,4% van de leveringen wijkt daardoor onder een euro af"
);

check(
  "precies op de drempel telt nog als match",
  resolveSalesSheetMatch({
    hasPdf: true,
    pdfParsedAt: GELEZEN,
    pdfNetResult: 100,
    pdfTurnover: null,
    pdfCosts: null,
    computedNetResult: 100 - SALESSHEET_MATCH_TOLERANCE,
  }) === "match"
);

check(
  "net over de drempel is een mismatch",
  resolveSalesSheetMatch({
    hasPdf: true,
    pdfParsedAt: GELEZEN,
    pdfNetResult: 100,
    pdfTurnover: null,
    pdfCosts: null,
    computedNetResult: 100 - SALESSHEET_MATCH_TOLERANCE - 0.01,
  }) === "mismatch"
);

check(
  "het gespiegelde geval is een mismatch",
  resolveSalesSheetMatch({
    hasPdf: true,
    pdfParsedAt: GELEZEN,
    pdfNetResult: 1350.16,
    pdfTurnover: null,
    pdfCosts: null,
    computedNetResult: -1350.17,
  }) === "mismatch",
  "gemeten geval: de portal had wel kosten maar geen omzet, dus een negatief netto, " +
    "terwijl de kweker het bedrag positief uitbetaald heeft gekregen"
);

check(
  "een negatief resultaat aan beide kanten is gewoon een match",
  resolveSalesSheetMatch({
    hasPdf: true,
    pdfParsedAt: GELEZEN,
    pdfNetResult: -240.5,
    pdfTurnover: null,
    pdfCosts: null,
    computedNetResult: -240.5,
  }) === "match"
);

check(
  "netto ontbreekt maar omzet en kosten staan er: afgeleid en gematcht",
  resolveSalesSheetMatch({
    hasPdf: true,
    pdfParsedAt: GELEZEN,
    pdfNetResult: null,
    pdfTurnover: 1500,
    pdfCosts: 265.5,
    computedNetResult: 1234.5,
  }) === "match",
  "geen 'To be received by supplier'-label op deze sales sheet (38 van 60 gemeten " +
    "gekoppelde leveringen); omzet - kosten = 1234,50 komt overeen met het berekende netto"
);

check(
  "netto ontbreekt, omzet staat er, kosten ontbreken: unread, geen afleiding",
  resolveSalesSheetMatch({
    hasPdf: true,
    pdfParsedAt: GELEZEN,
    pdfNetResult: null,
    pdfTurnover: 1234.56,
    pdfCosts: null,
    computedNetResult: 1234.56,
  }) === "unread",
  "ontbrekende kosten tellen niet meer als nul: een all-in-levering drukt het netto " +
    "juist wél expliciet af en bereikt deze tak dus nooit, dus wat overblijft is een " +
    "lay-out die we niet kennen — en dan is 'niet gelezen' eerlijker dan een geraden nul"
);

check(
  "netto ontbreekt, afgeleid netto wijkt te veel af: mismatch",
  resolveSalesSheetMatch({
    hasPdf: true,
    pdfParsedAt: GELEZEN,
    pdfNetResult: null,
    pdfTurnover: 1500,
    pdfCosts: 265.5,
    computedNetResult: 900,
  }) === "mismatch",
  "afgeleid netto is 1234,50, de portal berekent 900 — verschil ruim boven de drempel"
);

check(
  "netto én omzet ontbreken allebei: onze storing",
  resolveSalesSheetMatch({
    hasPdf: true,
    pdfParsedAt: GELEZEN,
    pdfNetResult: null,
    pdfTurnover: null,
    pdfCosts: 265.5,
    computedNetResult: 1234.5,
  }) === "unread",
  "kosten alleen zijn niet genoeg om een netto af te leiden; zonder omzet blijft dit " +
    "een parserprobleem"
);

check(
  "pdfNetResult wint van de afleiding, ook als de kosten niet gelezen zijn",
  resolveSalesSheetMatch({
    hasPdf: true,
    pdfParsedAt: GELEZEN,
    pdfNetResult: 1234.56,
    pdfTurnover: 9999,
    pdfCosts: null,
    computedNetResult: 1234.56,
  }) === "match",
  "staat het netto zelf op het document, dan is dat leidend — de afleiding uit omzet " +
    "en kosten is alleen een noodgreep voor als het label ontbreekt; de zelfcontrole " +
    "raakt hier niet aan bod omdat pdfCosts ontbreekt, dus 9999 wordt genegeerd"
);

check(
  "een niet-eindig berekend netto is een mismatch, geen match",
  resolveSalesSheetMatch({
    hasPdf: true,
    pdfParsedAt: GELEZEN,
    pdfNetResult: 1234.56,
    pdfTurnover: null,
    pdfCosts: null,
    computedNetResult: NaN,
  }) === "mismatch",
  "NaN > SALESSHEET_MATCH_TOLERANCE is false in JavaScript, dus zonder expliciete " +
    "check zou een onvergelijkbaar bedrag stil als 'match' doorkomen"
);

check(
  "alle drie de bedragen gelezen en ze kloppen intern: gewoon oordeel",
  resolveSalesSheetMatch({
    hasPdf: true,
    pdfParsedAt: GELEZEN,
    pdfNetResult: 1000,
    pdfTurnover: 1500,
    pdfCosts: 500,
    computedNetResult: 1000,
  }) === "match",
  "1500 - 500 = 1000, gelijk aan het afgedrukte netto — de zelfcontrole houdt hier stil " +
    "en het gewone oordeel volgt"
);

check(
  "alle drie de bedragen gelezen maar ze kloppen intern niet: unread, geen mismatch",
  resolveSalesSheetMatch({
    hasPdf: true,
    pdfParsedAt: GELEZEN,
    pdfNetResult: 1000,
    pdfTurnover: 1500,
    pdfCosts: 600,
    computedNetResult: 1000,
  }) === "unread",
  "1500 - 600 = 900, wijkt 100 euro af van het afgedrukte netto 1000 — een sales sheet " +
    "telt intern altijd kloppend op, dus dit is onze uitlezing die iets verkeerd greep, " +
    "niet de levering; vandaar unread ook al is computedNetResult gelijk aan het netto"
);

console.log(failures === 0 ? "\nalle checks geslaagd" : `\n${failures} check(s) gefaald`);
process.exit(failures === 0 ? 0 : 1);
