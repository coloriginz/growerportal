/**
 * Het inkooptype waarop deze portal is gebouwd. Coloriginz werkt op consignatie:
 * de kweker blijft eigenaar tot de bloemen verkocht zijn en krijgt de netto
 * opbrengst. Bij koop (FOB, CIF) is de partij al afgerekend bij inkoop — die
 * omzet is niet van de leverancier en hoort hier dus niet te staan.
 *
 * Eén verzameling op één plek, want dit is een businessregel en geen losse
 * stringvergelijking: alles wat er niet in staat wordt weggegooid.
 *
 * Fabric kent er vier, gemeten op 20 augustus over de hele fct_partijen:
 * CIF (573.808), CONS (296.763), FOB (97.406) en '-' (63.386). Dat streepje is
 * geen ontbrekende waarde maar de interne productie: het zijn precies de zes
 * `* Productieorders`-relaties. Consignatie is dus een minderheid — over de
 * laatste zeven dagen 1.719 van de 4.697 partijen.
 *
 * De lots-import telt alsnog wat hij per code weggooit
 * (`details.skippedPurchaseTypes`), want deze meting is een momentopname:
 * duikt er een vijfde code op, dan staat die in het importscherm in plaats van
 * dat er stilzwijgend data verdwijnt.
 */
export const CONSIGNMENT_PURCHASE_TYPES: ReadonlySet<string> = new Set(["CONS"]);

/**
 * Dezelfde regel als SQL, zodat de bron en de import niet uit elkaar kunnen
 * lopen. Nodig bij orders: die endpoint liep tegen de payload-grens van Power
 * Automate aan (15.229 rijen kwam nooit terug, 11.128 net wel), en filteren aan
 * de bronkant haalt daar over acht dagen 19.117 rijen terug naar 7.497.
 *
 * Bij lots gebeurt het filteren juist bewust in de import en niet hier: die
 * payload is klein genoeg, en door alles op te halen telt elke ronde wat er aan
 * inkooptypes langskomt. Dat is het vangnet voor een code die we nog niet
 * kennen — bij orders zou zo'n code stilzwijgend wegvallen.
 */
export function consignmentSql(column: string): string {
  const codes = [...CONSIGNMENT_PURCHASE_TYPES].map((c) => `'${c}'`).join(", ");
  return `AND ${column} IN (${codes})`;
}

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
