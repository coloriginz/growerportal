import { parseSalesSheetAmounts, parseInvoiceDate } from "../../src/lib/salessheet-pdf-parser";

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) console.log(`PASS ${label}`);
  else {
    failures++;
    console.log(`FAIL ${label}${detail ? " — " + detail : ""}`);
  }
}

/*
 * Echte tekst, zoals pdfjs hem uitrolt. Let op de volgorde: bij de totalen staat
 * het bedrag vóór het label, bij de kosten erna. Dat is geen toeval maar hoe de
 * tabelcellen uit het document komen, en een parser die het andersom aanneemt
 * leest stelselmatig het verkeerde getal.
 */
const ENGELS =
  "Cost Calculation of net result supplier Direct sales € 1.763,10 Turnover Auction " +
  "€ 607,20 € 2.370,30 Total nett turnover Clearing & Logistics 55,00 Container rental " +
  "38,91 Distribution Costs 51,15 Total costs € 873,57 € 1.496,73 To be received by " +
  "supplier 02-01-2025 15-1-25 22:03 AWB number";

const NEDERLANDS =
  "Berekening netto resultaat leverancier Directe verkopen € 600,00 € 600,00 Totale " +
  "netto omzet € 600,00 Te ontvangen door leverancier 54,00 € 654,00 BTW: NETTO " +
  "RESULTAAT INCL. BTW 16-10-2025 17-11-25 22:04 AWB nummer";

/* All-in: alleen het netto wordt afgedrukt, er zijn geen kostenregels. */
const ALL_IN =
  "Calculation of net result supplier Direct sales € 583,46 € 583,46 Total nett " +
  "turnover € 583,46 To be received by supplier 29-11-2025 18-12-25 22:02 AWB number";

/* Negatieve bedragen staan tussen haakjes. */
const NEGATIEF =
  "Direct sales € 592,99 € 592,99 Total nett turnover Distribution Costs 11,79 " +
  "(€ 193,78) Total costs € 193,78 € 399,21 Subtotal:";

const en = parseSalesSheetAmounts(ENGELS);
check("engels: omzet", en.turnover === 2370.3, `kreeg ${en.turnover}`);
check("engels: kosten", en.costs === 873.57, `kreeg ${en.costs}`);
check("engels: netto", en.netResult === 1496.73, `kreeg ${en.netResult}`);

const nl = parseSalesSheetAmounts(NEDERLANDS);
check("nederlands: omzet", nl.turnover === 600, `kreeg ${nl.turnover}`);
check("nederlands: netto", nl.netResult === 600, `kreeg ${nl.netResult}`);
check(
  "nederlands: de btw-regel wordt genegeerd",
  nl.netResult !== 654,
  "654,00 is het bedrag inclusief btw; alleen het bedrag ervóór is vergelijkbaar " +
    "met wat de portal berekent, want die kent geen btw"
);

const incl = parseSalesSheetAmounts(ALL_IN);
check("all-in: omzet is het afgedrukte netto", incl.turnover === 583.46, `kreeg ${incl.turnover}`);
check("all-in: geen kostenregel betekent geen kosten", incl.costs === null, `kreeg ${incl.costs}`);
check("all-in: netto", incl.netResult === 583.46, `kreeg ${incl.netResult}`);

const neg = parseSalesSheetAmounts(NEGATIEF);
check("kosten tussen haakjes worden gelezen", neg.costs === 193.78, `kreeg ${neg.costs}`);

/*
 * Bij COL/2025/11/Salessheet/101967-393445.pdf (COLZFLXC, referentie 101967) staat het
 * minteken vóór het euroteken in plaats van erna of tussen haakjes: "-€ 157,10". Zonder
 * deze vorm in de regex viel het teken weg en leverde de parser 157,1 waar de portal
 * -157,12 berekende.
 */
const MIN_VOOR_EUROTEKEN =
  "Used in production € 252,87 (€ 157,10) Total nett turnover -€ 157,10 To be received " +
  "by supplier 20-11-2025";

const minVoorEuroteken = parseSalesSheetAmounts(MIN_VOOR_EUROTEKEN);
check(
  "minteken vóór het euroteken: omzet is negatief",
  minVoorEuroteken.turnover === -157.1,
  `kreeg ${minVoorEuroteken.turnover}`
);
check(
  "minteken vóór het euroteken: netto is negatief",
  minVoorEuroteken.netResult === -157.1,
  `kreeg ${minVoorEuroteken.netResult}`
);

check(
  "lege tekst levert drie keer null",
  (() => {
    const leeg = parseSalesSheetAmounts("");
    return leeg.turnover === null && leeg.costs === null && leeg.netResult === null;
  })()
);

/*
 * Echte tekst van COLXGREE, levering 17806. Deze afrekening schreef "Totaal
 * kosten" waar de parser alleen "Totale kosten" kende, en droeg het netto op
 * "Subtotaal" waar dat label helemaal niet in de lijst stond. Kosten en netto
 * kwamen daardoor op null uit en het verschil (omzet - 0) werd EUR 1.734,29 —
 * terwijl er niets mis was met de levering.
 */
const COLXGREE_17806 =
  "Kosten Berekening netto resultaat leverancier Directe verkopen € 10.244,66 Omzet veiling " +
  "€ 2.192,64 € 12.437,30 Totale netto omzet Distributiekosten 168,68 Verwerkingskosten 357,12 " +
  "Administratie kosten 12,50 Commissie directe verkoop 1.044,96 Transactie heffing 151,04 " +
  "(€ 1.734,29) Totaal kosten € 1.734,30 € 10.703,01 Subtotaal: (€ 12.437,30) Omzet betaald " +
  "door Floraholland: Netto te betalen / te ontvangen aan / van OZ import: 19-03-2026 30-3-26 " +
  "22:04 AWB nummer";

const colxgree = parseSalesSheetAmounts(COLXGREE_17806);
check("COLXGREE 17806: omzet", colxgree.turnover === 12437.3, `kreeg ${colxgree.turnover}`);
check(
  "COLXGREE 17806: kosten via 'Totaal kosten'",
  colxgree.costs === 1734.3,
  `kreeg ${colxgree.costs}`
);
check(
  "COLXGREE 17806: netto via 'Subtotaal'",
  colxgree.netResult === 10703.01,
  `kreeg ${colxgree.netResult}`
);

/*
 * "Subtotaal" is de algemenere term en staat daarom achteraan in NETTO_LABELS.
 * Deze minimale tekst bevat geen echt document, alleen beide labels naast
 * elkaar, om te bewijzen dat het specifieke label ("Te ontvangen door
 * leverancier") wint ook al staat "Subtotaal" er ook in.
 */
const SPECIFIEK_NETTOLABEL_WINT =
  "€ 500,00 Te ontvangen door leverancier € 999,00 Subtotaal:";

const specifiekWint = parseSalesSheetAmounts(SPECIFIEK_NETTOLABEL_WINT);
check(
  "specifiek nettolabel wint van 'Subtotaal'",
  specifiekWint.netResult === 500,
  `kreeg ${specifiekWint.netResult}`
);

/*
 * Twee echte fragmenten (COLXGREE 17806 en het Engelse voorbeeld hierboven,
 * COL/2025/1 leverancier ALTINOVA): de factuurdatum staat vlak achter de
 * leverdatum met een tijd erachter en een tweecijferig jaar — "30-3-26 22:04",
 * "15-1-25 22:03". Geverifieerd tegen 60 echte PDF's uit private_input/salessheets,
 * zie .superpowers/sdd/datums/pdf-factuurdatum.md.
 */
check(
  "factuurdatum: D-M-JJ H:MM met tweecijferig jaar",
  parseInvoiceDate("... 19-03-2026 30-3-26 22:04 AWB nummer Stolperweg 41 ...") === "2026-03-30",
  `kreeg ${parseInvoiceDate("... 19-03-2026 30-3-26 22:04 AWB nummer Stolperweg 41 ...")}`
);
check(
  "factuurdatum: eencijferige dag en maand",
  parseInvoiceDate("... 02-01-2025 15-1-25 22:03 AWB number ALTINOVA ...") === "2025-01-15",
  `kreeg ${parseInvoiceDate("... 02-01-2025 15-1-25 22:03 AWB number ALTINOVA ...")}`
);

/*
 * De leverdatum ervóór heeft een viercijferig jaar en géén tijd erachter, dus
 * mag nooit als factuurdatum worden gelezen — alleen het patroon met de tijd
 * telt.
 */
check(
  "factuurdatum: de leverdatum zelf wordt niet gelezen als er geen tijd achter staat",
  parseInvoiceDate("... 19-03-2026 AWB nummer Stolperweg 41 ...") === null,
  `kreeg ${parseInvoiceDate("... 19-03-2026 AWB nummer Stolperweg 41 ...")}`
);

console.log(failures === 0 ? "\nalle checks geslaagd" : `\n${failures} check(s) gefaald`);
process.exit(failures === 0 ? 0 : 1);
