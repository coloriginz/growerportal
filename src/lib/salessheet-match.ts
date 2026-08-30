/*
 * Klopt wat de kweker op zijn afrekening zag met wat de portal berekent?
 *
 * De portal leidt zijn totalen af uit orderregels en kostenregels; de sales sheet
 * komt uit het factuursysteem. Twee onafhankelijke bronnen die hetzelfde horen te
 * zeggen. Lopen ze uiteen, dan is er iets mis — en welke van de twee fout is, zegt
 * deze functie niet. Dat is geen tekortkoming: de signalering hoeft alleen te
 * wijzen, iemand kijkt daarna.
 *
 * Er wordt uitsluitend op het nettoresultaat vergeleken, en dat is een keuze met
 * een reden. Bij een all-in-levering (`isInclusief`, 241 van 7.878 op 29-08-2026)
 * drukt de sales sheet alleen het netto af en heeft hij geen kostenregels, terwijl
 * de portal bruto omzet én kosten apart uit Fabric heeft. Omzet met omzet
 * vergelijken levert daar duizenden euro's schijnverschil op. Het netto betekent
 * aan beide kanten hetzelfde, ongeacht de afspraak — dus die vergelijking heeft de
 * all-in-vlag niet nodig.
 */

/**
 * Waarboven een verschil een bevinding is, in euro's.
 *
 * Gemeten over 800 afrekeningen: 81% komt exact uit, 13,4% wijkt onder een euro af
 * en 5,5% erboven. Die 13,4% is afronding — `SalesSheetCost.amount` draagt vijf
 * decimalen en de sales sheet telt op vóór hij afrondt. Op nul verdrinkt het signaal
 * in centen; op tien mis je echte kleine fouten.
 */
export const SALESSHEET_MATCH_TOLERANCE = 1;

export type SalesSheetMatch = "match" | "mismatch" | "unread" | "unlinked";

export const SALESSHEET_MATCHES: readonly SalesSheetMatch[] = [
  "match",
  "mismatch",
  "unread",
  "unlinked",
];

export type SalesSheetMatchInput = {
  /** Hangt er een document aan deze afrekening? */
  hasPdf: boolean;
  /** Wanneer dat document is uitgelezen, of null als dat nog niet is gebeurd. */
  pdfParsedAt: Date | null;
  /** Het nettoresultaat zoals het op de PDF stond. */
  pdfNetResult: number | null;
  /** Het nettoresultaat zoals de portal het berekent. */
  computedNetResult: number;
};

export function resolveSalesSheetMatch(input: SalesSheetMatchInput): SalesSheetMatch {
  // Geen document, of een document dat nog niet is bekeken: allebei zeggen ze niets
  // over de levering. Dat de inhaalslag er nog niet langs is, is een achterstand van
  // ons en geen bevinding over deze afrekening.
  if (!input.hasPdf || input.pdfParsedAt === null) return "unlinked";

  // Wel bekeken, geen bedrag gevonden. Dat is onze storing — een lay-out die we niet
  // kennen of een document dat niet te lezen was — en het hoort apart zichtbaar te
  // zijn in plaats van weg te vallen tussen de afrekeningen zonder PDF.
  if (input.pdfNetResult === null) return "unread";

  const verschil = Math.abs(input.pdfNetResult - input.computedNetResult);
  return verschil > SALESSHEET_MATCH_TOLERANCE ? "mismatch" : "match";
}
