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
  /** Het nettoresultaat zoals het op de PDF stond, achter een label als "To be
   *  received by supplier". Niet elke sales sheet drukt dat label af. */
  pdfNetResult: number | null;
  /** De omzet zoals de PDF die afdrukt, of het netto zelf bij een all-in-levering
   *  (zie de afleiding hieronder). */
  pdfTurnover: number | null;
  /** De kosten zoals de PDF die afdrukt, of null als er geen kostenregels op staan. */
  pdfCosts: number | null;
  /** Het nettoresultaat zoals de portal het berekent. */
  computedNetResult: number;
};

/**
 * Het netto zoals de PDF het zegt — rechtstreeks afgedrukt, of afgeleid uit omzet
 * en kosten als het label ontbreekt.
 *
 * Niet elke sales sheet drukt "To be received by supplier" af: gemeten op 60
 * gekoppelde leveringen komt er bij 22 een netto uit, bij 38 niet. Die 38 vielen
 * allemaal op `unread`, waarmee de hele controle vrijwel niets meet. Omzet en
 * kosten staan wel vrijwel altijd op de sales sheet, en het netto is daaruit af te
 * leiden — een verkennende proef gaf op 800 van 800 documenten een vergelijkbaar
 * netto.
 *
 * Eén formule dekt zowel de gewone als de all-in-levering, en dat is geen
 * toeval: bij een gewone levering is omzet - kosten het netto per definitie. Bij
 * een all-in-levering (`isInclusief`) drukt de sales sheet alleen het netto af als
 * "omzet" en heeft hij geen kostenregels — dus omzet - 0 is daar óók het netto.
 * Ontbrekende kosten tellen daarom als nul, niet als onbekend: een levering zonder
 * kostenregel heeft geen kosten, dat is geen leemte in het document. Wie deze regel
 * later wil "verbeteren" door hem op te splitsen per leveringstype: niet doen, hij
 * is expres één regel.
 */
function derivePdfNetResult(input: SalesSheetMatchInput): number | null {
  if (input.pdfNetResult !== null) return input.pdfNetResult;
  if (input.pdfTurnover !== null) return input.pdfTurnover - (input.pdfCosts ?? 0);
  return null;
}

export function resolveSalesSheetMatch(input: SalesSheetMatchInput): SalesSheetMatch {
  // Geen document, of een document dat nog niet is bekeken: allebei zeggen ze niets
  // over de levering. Dat de inhaalslag er nog niet langs is, is een achterstand van
  // ons en geen bevinding over deze afrekening.
  if (!input.hasPdf || input.pdfParsedAt === null) return "unlinked";

  const pdfNetResult = derivePdfNetResult(input);

  // Wel bekeken, geen bedrag gevonden en ook geen omzet om het uit af te leiden.
  // Dat is onze storing — een lay-out die we niet kennen of een document dat niet
  // te lezen was — en het hoort apart zichtbaar te zijn in plaats van weg te vallen
  // tussen de afrekeningen zonder PDF.
  if (pdfNetResult === null) return "unread";

  // Een niet-eindig getal (NaN, Infinity) is geen getal dat we gelijk mogen noemen.
  // `NaN > SALESSHEET_MATCH_TOLERANCE` is in JavaScript `false`, dus zonder deze
  // check zou zo'n waarde stil als "match" doorkomen — de slechtst mogelijke
  // uitkomst, want juist een bedrag dat we niet kunnen vergelijken moet iemand laten
  // kijken in plaats van het weg te schrijven als "komt overeen". Dit staat na de
  // afleiding, want ook `pdfTurnover - (pdfCosts ?? 0)` kan niet-eindig zijn.
  if (!Number.isFinite(pdfNetResult) || !Number.isFinite(input.computedNetResult)) {
    return "mismatch";
  }

  const verschil = Math.abs(pdfNetResult - input.computedNetResult);
  return verschil > SALESSHEET_MATCH_TOLERANCE ? "mismatch" : "match";
}
