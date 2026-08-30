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
    computedNetResult: 1234.56,
  }) === "unlinked"
);

check(
  "een PDF die nog niet is gelezen is niet hetzelfde als een die niets opleverde",
  resolveSalesSheetMatch({
    hasPdf: true,
    pdfParsedAt: null,
    pdfNetResult: null,
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
    computedNetResult: 1234.56,
  }) === "unread",
  "het document is bekeken en gaf geen netto; dat is een parserprobleem en hoort " +
    "zichtbaar te zijn in plaats van weg te vallen tussen de leveringen zonder PDF"
);

check(
  "gelijke bedragen zijn een match",
  resolveSalesSheetMatch({
    hasPdf: true,
    pdfParsedAt: GELEZEN,
    pdfNetResult: 1234.56,
    computedNetResult: 1234.56,
  }) === "match"
);

check(
  "een cent verschil is afronding, geen fout",
  resolveSalesSheetMatch({
    hasPdf: true,
    pdfParsedAt: GELEZEN,
    pdfNetResult: 583.46,
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
    computedNetResult: 100 - SALESSHEET_MATCH_TOLERANCE,
  }) === "match"
);

check(
  "net over de drempel is een mismatch",
  resolveSalesSheetMatch({
    hasPdf: true,
    pdfParsedAt: GELEZEN,
    pdfNetResult: 100,
    computedNetResult: 100 - SALESSHEET_MATCH_TOLERANCE - 0.01,
  }) === "mismatch"
);

check(
  "het gespiegelde geval is een mismatch",
  resolveSalesSheetMatch({
    hasPdf: true,
    pdfParsedAt: GELEZEN,
    pdfNetResult: 1350.16,
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
    computedNetResult: -240.5,
  }) === "match"
);

check(
  "elke uitkomst staat in SALESSHEET_MATCHES",
  (
    [
      { hasPdf: false, pdfParsedAt: null, pdfNetResult: null, computedNetResult: 0 },
      { hasPdf: true, pdfParsedAt: GELEZEN, pdfNetResult: null, computedNetResult: 0 },
      { hasPdf: true, pdfParsedAt: GELEZEN, pdfNetResult: 5, computedNetResult: 5 },
      { hasPdf: true, pdfParsedAt: GELEZEN, pdfNetResult: 5, computedNetResult: 500 },
    ] as const
  ).every((invoer) => SALESSHEET_MATCHES.includes(resolveSalesSheetMatch(invoer)))
);

console.log(failures === 0 ? "\nalle checks geslaagd" : `\n${failures} check(s) gefaald`);
process.exit(failures === 0 ? 0 : 1);
