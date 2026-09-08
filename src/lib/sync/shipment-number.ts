/**
 * Welk zendingnummer een levering hoort te dragen.
 *
 * `SalesSheet.invoiceNumber` heet zo maar is het **vlucht-/containernummer** dat
 * de kweker met zijn zending meestuurt (`inkoopfactuurnummer` in Fabric); het
 * echte factuurnummer is `ourInvoiceNumber`, dat van de sales sheet-PDF komt.
 * De schermen noemen het sinds 26 augustus 2026 "Shipment Number" om die twee
 * niet langer met dezelfde woorden aan te duiden.
 *
 * Waarom dit bestaat: de bron schoont die nummers na de aanvoer op — levering
 * 2472390 kwam binnen als "21120 10582" en staat in Fabric inmiddels als
 * "10582". De lots-import schreef het nummer alleen bij het aanmaken, dus wie
 * de rij het eerst aanmaakte bevroor de waarde van dat moment. Gemeten op
 * 8 september 2026 over de 300 nieuwste leveringen: 17 afwijkingen op productie
 * en 13 op test — het is geen achterstand van één omgeving maar een eigenschap
 * van "alleen bij insert schrijven".
 *
 * Dat is niet alleen cosmetisch. Dit nummer is de sleutel waarop de sales
 * sheet-PDF gekoppeld wordt: een document met referentie "10582" vindt nooit
 * een levering die "21120 10582" draagt.
 */

/** Waarden waar de bron niets mee zegt. Kleine letters; er wordt genormaliseerd vergeleken. */
export const PLAATSHOUDERS = ["", "xxx", "volgt", "test", "restpartijen"];

export type NummerReden =
  | "nieuw"
  | "ongewijzigd"
  | "bijgewerkt"
  | "botsing-achtervoegsel"
  | "bron-leeg";

export interface NummerBesluit {
  /** Wat er weggeschreven moet worden, of null als er niets hoeft te gebeuren. */
  nummer: string | null;
  reden: NummerReden;
}

export interface NummerVraag {
  /** `Inkoop Factuur Nummer` zoals de bron het levert. */
  bron: string | null | undefined;
  /** Wat de portal nu draagt, of null bij een nieuwe levering. */
  opgeslagen: string | null;
  parthdrId: number;
  /** Draagt een ándere levering dit nummer al? `invoiceNumber` is uniek. */
  bezet: (nummer: string) => boolean;
}

export function resolveShipmentNumber({
  bron,
  opgeslagen,
  parthdrId,
  bezet,
}: NummerVraag): NummerBesluit {
  const schoon = bron?.trim() ?? "";
  const bruikbaar = schoon !== "" && !PLAATSHOUDERS.includes(schoon.toLowerCase());

  if (!bruikbaar) {
    // Bij aanmaken moet er iets staan; het veld is verplicht en uniek.
    if (opgeslagen === null) return { nummer: `FABRIC-${parthdrId}`, reden: "nieuw" };
    // Bij bijwerken juist niet. Een bron die even niets levert mag een goed
    // nummer niet wegvagen — dat is onherstelbaar zonder de oude waarde, en een
    // lege bron is aantoonbaar iets wat gebeurt (zie CLAUDE.md over lege
    // recordsets). Laat staan wat er staat.
    return { nummer: null, reden: "bron-leeg" };
  }

  const metAchtervoegsel = `${schoon}-${parthdrId}`;

  // Al goed, in de kale of in de ontdubbelde vorm.
  if (opgeslagen === schoon || opgeslagen === metAchtervoegsel) {
    return { nummer: null, reden: "ongewijzigd" };
  }

  if (bezet(schoon)) {
    // Nummers worden per jaar hergebruikt, dus botsen hoort erbij. Het
    // parthdr_id erachter is uniek en maakt het nummer dat weer.
    return { nummer: metAchtervoegsel, reden: "botsing-achtervoegsel" };
  }

  return { nummer: schoon, reden: opgeslagen === null ? "nieuw" : "bijgewerkt" };
}
