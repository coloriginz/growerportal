/**
 * Fallback parser: extract reference number from sales sheet PDF content.
 *
 * The reference number and invoice number appear on page 1 of the PDF
 * as standalone values in the header area.
 *
 * Also extracts the delivery date, which is used to verify that a PDF is
 * linked to the right sales sheet. Sales sheet numbers are recycled per
 * year, so the number alone is not enough to identify a delivery.
 *
 * Uses pdfjs-dist legacy build for Vercel serverless compatibility.
 */

export interface ParsedSalesSheetPdf {
  reference: string | null;
  ourInvoiceNumber: string | null;
  /** Delivery date printed on the PDF, as "YYYY-MM-DD". Null if unreadable. */
  deliveryDate: string | null;
  /** Wat er op de PDF zelf stond. Null betekent: dit label kwam niet voor. */
  turnover: number | null;
  costs: number | null;
  netResult: number | null;
}

/** Convert a Dutch "DD-MM-YYYY" or "DD-MM-YY" date to "YYYY-MM-DD". */
function parseDutchDate(value: string | null): string | null {
  if (!value) return null;
  const m = value.trim().match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/*
 * De bedragen op de sales sheet, in beide talen.
 *
 * pdfjs rolt de tabelcellen uit in een volgorde waarin het bedrag bij de totalen
 * vóór zijn label staat ("€ 2.370,30 Total nett turnover") en bij de kosten erna
 * ("Total costs € 873,57"). Wie dat omdraait leest stelselmatig het verkeerde
 * getal, en het valt niet op omdat er altijd wél een bedrag uitkomt.
 *
 * De btw-regel op Nederlandse sales sheets ("54,00 € 654,00 BTW: NETTO RESULTAAT
 * INCL. BTW") staat er met opzet niet bij: binnenlandse leveranciers krijgen btw
 * bovenop het netto, en de portal kent geen btw. Alleen het bedrag vóór de btw is
 * vergelijkbaar.
 *
 * Een negatief bedrag staat op twee manieren afgedrukt: tussen haakjes
 * ("(€ 193,78)") of met een minteken vóór het euroteken ("-€ 157,10", gezien op
 * COL/2025/11/Salessheet/101967-393445.pdf, COLZFLXC referentie 101967). Het
 * minteken staat dus niet altijd na het euroteken — vandaar de optionele `-?`
 * zowel ervoor als erna.
 */
const BEDRAG = String.raw`\(?-?\s*€?\s*-?[\d.]+,\d{2}\)?`;

const OMZET_LABELS = ["Total nett turnover", "Totale netto omzet"];
const KOSTEN_LABELS = ["Total costs", "Totale kosten"];
const NETTO_LABELS = [
  "To be received by supplier",
  "To be paid by supplier",
  "Te ontvangen door leverancier",
  "Te betalen door leverancier",
  "Nett payable / receivable to/from OZ import",
];

/** "1.763,10", "(€ 193,78)" en "-€ 157,10" naar een getal. Haakjes of een minteken betekenen negatief. */
function leesBedrag(ruw: string): number | null {
  const negatief = ruw.includes("(") || ruw.includes("-");
  const schoon = ruw.replace(/[()€\s]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(schoon);
  if (!Number.isFinite(n)) return null;
  return negatief ? -Math.abs(n) : n;
}

/** Het eerste bedrag dat vlak vóór een van de labels staat. */
function bedragVoorLabel(tekst: string, labels: readonly string[]): number | null {
  for (const label of labels) {
    const m = tekst.match(new RegExp(`(${BEDRAG})\\s*${escapeRegex(label)}`, "i"));
    if (m) {
      const n = leesBedrag(m[1]);
      if (n !== null) return n;
    }
  }
  return null;
}

/** Het eerste bedrag dat vlak ná een van de labels staat. */
function bedragNaLabel(tekst: string, labels: readonly string[]): number | null {
  for (const label of labels) {
    const m = tekst.match(new RegExp(`${escapeRegex(label)}\\s*(${BEDRAG})`, "i"));
    if (m) {
      const n = leesBedrag(m[1]);
      if (n !== null) return n;
    }
  }
  return null;
}

function escapeRegex(waarde: string): string {
  return waarde.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseSalesSheetAmounts(text: string): {
  turnover: number | null;
  costs: number | null;
  netResult: number | null;
} {
  return {
    turnover: bedragVoorLabel(text, OMZET_LABELS),
    // Een levering zonder kosten heeft de regel niet; dat is nul en geen misser,
    // maar het onderscheid tussen "nul" en "niet gevonden" hoort hier bewaard te
    // blijven. De vergelijking verderop beslist wat een ontbrekende waarde betekent.
    costs: bedragNaLabel(text, KOSTEN_LABELS) ?? bedragVoorLabel(text, KOSTEN_LABELS),
    netResult: bedragVoorLabel(text, NETTO_LABELS),
  };
}

/*
 * De module één keer laden en het resultaat vasthouden. Node cachet modules al,
 * dus dit lost niets op — het scheelt alleen een dynamische import per PDF, en
 * het maakt zichtbaar dat er één instantie gedeeld wordt.
 */
let pdfjsModule: Promise<typeof import("pdfjs-dist/legacy/build/pdf.mjs")> | null = null;
function laadPdfjs() {
  if (!pdfjsModule) pdfjsModule = import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjsModule;
}

export async function parseSalesSheetPdf(pdfBuffer: Buffer): Promise<ParsedSalesSheetPdf> {
  const { getDocument } = await laadPdfjs();
  const data = new Uint8Array(pdfBuffer);
  const doc = await getDocument({ data, useSystemFonts: true, verbosity: 0 }).promise;
  /*
   * Alles onder een try/finally, zodat `destroy()` ook draait als het uitlezen
   * halverwege omvalt. Anders blijft er per mislukte PDF een document open
   * staan, en de koppelroute verwerkt er meerdere per verzoek. Opruimen dus,
   * niet omdat een lek is aangetoond maar omdat het hier niet op te merken zou
   * zijn: aan één bestand zie je het niet, alleen aan een lange reeks.
   */
  try {

    const page = await doc.getPage(1);
    const content = await page.getTextContent();
    const items = content.items as Array<{
      str: string;
      hasEOL?: boolean;
      transform?: number[];
    }>;

    // Positioned items, used to read the value printed to the right of a label.
    // Header fields sit in a two-column layout, so a line-based read would glue
    // unrelated values together.
    const positioned = items
      .filter((i) => i.str.trim() && Array.isArray(i.transform))
      .map((i) => ({
        text: i.str.trim(),
        x: Math.round(i.transform![4]),
        y: Math.round(i.transform![5]),
      }));

    /*
     * Eigen tekstopbouw voor de bedragen, los van `positioned`.
     *
     * Waarom twee tekstopbouwen naast elkaar: `positioned` bewaart coördinaten
     * en dient om een label op zijn plek terug te vinden (zoals de leverdatum
     * rechts van zijn label) — dat werkt alleen betrouwbaar op pagina 1, waar
     * de header staat. `amountsText` bewaart alleen de leesvolgorde waarin het
     * bedrag vóór zijn label staat (zie parseSalesSheetAmounts), en dat
     * totaalblok staat bij een meerpagina-afrekening niet per se op pagina 1.
     * Gemeten op twaalf echte PDF's: het netto kwam er bij 3 van de 12 uit
     * toen alleen pagina 1 werd gelezen.
     *
     * De items komen hier ongetrimd binnen — `positioned` trimt en filtert
     * lege items, en dat verstoort precies de volgorde waarin een bedrag en
     * zijn label elkaar direct opvolgen.
     */
    let amountsText = "";
    for (let i = 1; i <= doc.numPages; i++) {
      const pageContent = await (await doc.getPage(i)).getTextContent();
      amountsText += pageContent.items.map((it) => ("str" in it ? it.str : "")).join(" ") + "\n";
    }

    const valueRightOf = (label: RegExp): string | null => {
      const labelItem = positioned.find((i) => label.test(i.text));
      if (!labelItem) return null;
      const right = positioned
        .filter((i) => Math.abs(i.y - labelItem.y) <= 4 && i.x > labelItem.x)
        .sort((a, b) => a.x - b.x)[0];
      return right ? right.text : null;
    };

    // English template: "Deliverydate". Dutch template: "Datum levering".
    let deliveryDate = parseDutchDate(
      valueRightOf(/^(Delivery\s?date|Datum\s+levering|Leverdatum)\s*:?$/i)
    );

    // Build lines from text items
    const lines: string[] = [];
    let currentLine = "";
    for (const item of items) {
      currentLine += item.str;
      if (item.hasEOL) {
        lines.push(currentLine.trim());
        currentLine = "";
      }
    }
    if (currentLine.trim()) lines.push(currentLine.trim());

    /*
     * Terugval op de regels wanneer de positionele uitlezing niets gaf.
     *
     * `valueRightOf` heeft de `transform`-coördinaten van elk tekstitem nodig.
     * Vallen die weg, dan levert deze parser wél de referentie en het
     * factuurnummer — die komen uit de regels — maar géén datum. En een
     * ontbrekende datum betekent in de koppelroute dat de controle vervalt en
     * er op het nummer alleen gekoppeld wordt, wat precies de fout is die 83
     * afrekeningen aan de verkeerde PDF hielp. De datumcontrole hoort niet aan
     * één leesmethode te hangen; vandaar deze tweede weg.
     *
     * De afrekening draagt twee datums: de leverdatum als kale "DD-MM-JJJJ" en
     * de factuurdatum met een tijd erachter ("30-3-26 22:04"). Alleen de eerste
     * vorm telt hier. Staan er meerdere van, dan is er niets te kiezen en blijft
     * de datum leeg — liever geen koppeling dan een gegokte.
     */
    if (!deliveryDate) {
      const kaleDatums = [...new Set(lines.filter((l) => /^\d{1,2}-\d{1,2}-\d{4}$/.test(l.trim())))];
      if (kaleDatums.length === 1) deliveryDate = parseDutchDate(kaleDatums[0]);
    }

    // Look for "Invoice number" or "Factuurnummer" label — the values appear nearby
    let reference: string | null = null;
    let ourInvoiceNumber: string | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/Invoice number|Factuurnummer/i.test(line)) {
        // Search nearby lines for standalone numbers (wide range for varied layouts)
        const candidates: string[] = [];
        for (let j = Math.max(0, i - 15); j < Math.min(lines.length, i + 5); j++) {
          const l = lines[j].trim();
          // Match patterns like "212-28", "5322744", "401546", "18108"
          // Exclude date patterns like "01-01-2026"
          if (/^\d[\d-]{1,15}$/.test(l) && !/^\d{1,2}-\d{1,2}-\d{4}$/.test(l)) {
            candidates.push(l);
          }
        }
        // Typically we find two: reference (first) and invoice number (second)
        if (candidates.length >= 2) {
          reference = candidates[0];
          ourInvoiceNumber = candidates[1];
        } else if (candidates.length === 1) {
          reference = candidates[0];
        }
        break;
      }
    }

    const { turnover, costs, netResult } = parseSalesSheetAmounts(amountsText);

    return { reference, ourInvoiceNumber, deliveryDate, turnover, costs, netResult };
  } finally {
    await doc.destroy();
  }
}
