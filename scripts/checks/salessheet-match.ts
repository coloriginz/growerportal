import {
  SALESSHEET_MATCHES,
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
  "een PDF die nog niet is gelezen is niet hetzelfde als een die niets opleverde",
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
  "elke uitkomst staat in SALESSHEET_MATCHES",
  (
    [
      {
        hasPdf: false,
        pdfParsedAt: null,
        pdfNetResult: null,
        pdfTurnover: null,
        pdfCosts: null,
        computedNetResult: 0,
      },
      {
        hasPdf: true,
        pdfParsedAt: GELEZEN,
        pdfNetResult: null,
        pdfTurnover: null,
        pdfCosts: null,
        computedNetResult: 0,
      },
      {
        hasPdf: true,
        pdfParsedAt: GELEZEN,
        pdfNetResult: 5,
        pdfTurnover: null,
        pdfCosts: null,
        computedNetResult: 5,
      },
      {
        hasPdf: true,
        pdfParsedAt: GELEZEN,
        pdfNetResult: 5,
        pdfTurnover: null,
        pdfCosts: null,
        computedNetResult: 500,
      },
    ] as const
  ).every((invoer) => SALESSHEET_MATCHES.includes(resolveSalesSheetMatch(invoer)))
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
  "netto ontbreekt, omzet staat er, kosten ontbreken: all-in-levering",
  resolveSalesSheetMatch({
    hasPdf: true,
    pdfParsedAt: GELEZEN,
    pdfNetResult: null,
    pdfTurnover: 1234.56,
    pdfCosts: null,
    computedNetResult: 1234.56,
  }) === "match",
  "all-in-levering: de sales sheet drukt alleen het netto af als 'omzet' en heeft geen " +
    "kostenregels, dus ontbrekende kosten tellen als nul — omzet - 0 is het netto"
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
  "pdfNetResult wint van de afleiding, ook als die een ander getal zou geven",
  resolveSalesSheetMatch({
    hasPdf: true,
    pdfParsedAt: GELEZEN,
    pdfNetResult: 1234.56,
    pdfTurnover: 9999,
    pdfCosts: 1,
    computedNetResult: 1234.56,
  }) === "match",
  "staat het netto zelf op het document, dan is dat leidend — de afleiding uit omzet " +
    "en kosten is alleen een noodgreep voor als het label ontbreekt"
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

console.log(failures === 0 ? "\nalle checks geslaagd" : `\n${failures} check(s) gefaald`);
process.exit(failures === 0 ? 0 : 1);
