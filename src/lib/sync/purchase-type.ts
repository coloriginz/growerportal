/**
 * Het inkooptype waarop deze portal is gebouwd. Coloriginz werkt op consignatie:
 * de kweker blijft eigenaar tot de bloemen verkocht zijn en krijgt de netto
 * opbrengst. Bij koop (FOB, CIF) is de partij al afgerekend bij inkoop — die
 * omzet is niet van de leverancier en hoort hier dus niet te staan.
 *
 * Eén verzameling op één plek, want dit is een businessregel en geen losse
 * stringvergelijking: alles wat er niet in staat wordt weggegooid.
 *
 * Welke codes Fabric precies kent is niet te controleren — de vraag-flow van
 * Power Automate geeft 502 op elke warehouse-query, ook op `SELECT TOP 1`. Het
 * schema noemt CONS, FOB en CIF. Daarom telt de lots-import wat hij weggooit
 * per code (`details.skippedPurchaseTypes`): duikt er een vierde code op, dan
 * staat die in het importscherm in plaats van dat er stilzwijgend data verdwijnt.
 */
export const CONSIGNMENT_PURCHASE_TYPES: ReadonlySet<string> = new Set(["CONS"]);

/** Waaronder een lege of ontbrekende code geteld wordt. */
export const EMPTY_PURCHASE_TYPE_KEY = "(leeg)";

/**
 * De sleutel waaronder een inkooptype geteld wordt. Hoofdletters en spaties
 * worden genormaliseerd, zodat "cons " en "CONS" niet als twee codes in de
 * telling belanden.
 */
export function purchaseTypeKey(code: string | null | undefined): string {
  const genormaliseerd = (code ?? "").trim().toUpperCase();
  return genormaliseerd === "" ? EMPTY_PURCHASE_TYPE_KEY : genormaliseerd;
}

/** Hoort deze partij in de portal? Alleen consignatie hoort erin. */
export function isConsignment(code: string | null | undefined): boolean {
  return CONSIGNMENT_PURCHASE_TYPES.has(purchaseTypeKey(code));
}
