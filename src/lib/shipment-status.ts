/**
 * De status van een levering (sales sheet) in de verkoopcyclus. Drie fasen, in
 * volgorde: er wordt nog verkocht, alles is verkocht maar er is nog niet
 * afgerekend, en de afrekening is er.
 *
 * De status wordt niet opgeslagen maar afgeleid uit wat er al binnen is. Er is
 * geen veld in Fabric dat dit vertelt en er is geen moment waarop iemand hem
 * zou zetten: de drie signalen (aangevoerde stelen, verkochte stelen,
 * kostenregels) komen alle drie uit de import en veranderen daar ook weer. Een
 * opgeslagen kolom zou bij elke ronde bijgewerkt moeten worden en stilzwijgend
 * verouderen als dat een keer misgaat.
 */
export const SHIPMENT_STATUSES = ["selling", "finalizing", "completed"] as const;

export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export interface ShipmentStatusInput {
  /**
   * Som van `Lot.invoicedVolume` over de partijen van deze levering — niet
   * `Lot.totalStems`. De orders-import overschrijft `totalStems` achteraf met
   * de som van de verkochte stelen (zie src/app/api/import/orders/route.ts),
   * dus die kolom draagt op test in alle 66.888 partijen met transacties het
   * verkochte aantal en in 0 gevallen het aangevoerde. `invoicedVolume` wordt
   * door de orders-import nooit aangeraakt en is daarmee de enige kolom die
   * hier nog "aangevoerd" betekent.
   */
  deliveredStems: number;
  /** Som van `Transaction.stems` over dezelfde partijen. */
  soldStems: number;
  /** Aantal `SalesSheetCost`-regels: het bewijs dat de afrekening gedraaid is. */
  costCount: number;
}

/**
 * Correcties tellen hier bewust niet mee, en dat is een vereenvoudiging, geen
 * aanname dat ze er niet toe doen. `deliveredStems` is hier het kale
 * `Lot.invoicedVolume` — het aangevoerde aantal vóór correctie. Wat werkelijk
 * verkocht wordt, is aangevoerd plus correcties (`LotCorrection.correctionVolume`,
 * betekenisvol getekend): gemeten op levering 2700240 (COLXLNFW) staat er 55.870
 * aangevoerd, −33.380 aan correcties en 22.490 verkocht, en dat klopt exact met de
 * sales sheet. Zonder de correcties erbij zou deze functie die levering op
 * `soldStems >= deliveredStems` als nooit-uitverkocht beoordelen.
 *
 * Dat mag hier, want de kostenregels hebben voorrang: zodra de afrekening
 * gedraaid is (`costCount > 0`) is de status sowieso Completed, ongeacht de
 * stelenvergelijking hieronder. Die vergelijking is alleen de heuristiek voor de
 * fase daarvóór (Selling versus Finalizing); het al dan niet meetellen van
 * correcties classificeert daar geen levering fout die hier niet toch al door de
 * kostenregels wordt opgevangen. De warehouse herschrijft bovendien historie: een
 * orderregel komt binnen met zijn sleutels gevuld maar `vor_aantal` nog leeg, en
 * dat wordt pas weken later ingevuld. Daardoor staan er 139 leveringen in de
 * portal die aantoonbaar zijn afgerekend terwijl de verkochte stelen achterlopen
 * — ook zonder de correcties mee te tellen zou het stelenverschil die nooit boven
 * Selling tillen; wint het stelenverschil daar, dan blijft de kweker zijn allang
 * ontvangen afrekening missen. De volledige aangevoerd+correcties-tegen-verkocht-
 * vergelijking staat in `src/app/api/admin/shipment-issues/route.ts` (`stem-gap`),
 * waar ze wél nodig is om afgerekende leveringen met een echt gat te vinden.
 *
 * Let op: `Lot.totalStems` is een andere kolom en deugt hier niet voor. Een
 * eerdere versie van dit commentaar onderbouwde `invoicedVolume` met "verkocht
 * komt 7.715 van de 7.878 keer exact uit op aangevoerd" — dat was circulair,
 * want die meting gebruikte `totalStems` aan beide kanten. De orders-import
 * overschrijft `Lot.totalStems` met de som van de verkochte stelen (zie
 * src/app/api/import/orders/route.ts), dus die kolom draagt "verkocht", niet
 * "aangevoerd". `invoicedVolume` wordt door de orders-import nooit aangeraakt.
 *
 * De koppeling met de sales sheet-PDF telt niet mee. Dat is een portal-artefact,
 * geen bedrijfsfeit: 3.696 afgerekende leveringen hebben geen gekoppelde PDF,
 * en die zouden dan allemaal op Finalizing blijven hangen. Het adminoverzicht
 * `shipment-issues` bewaakt die koppeling apart.
 */
export function resolveShipmentStatus({
  deliveredStems,
  soldStems,
  costCount,
}: ShipmentStatusInput): ShipmentStatus {
  if (costCount > 0) return "completed";
  // Ondergrens op aangevoerd: zonder partijen is 0 >= 0 waar, en dan zou een
  // levering waarvan de partijen nog moeten binnenkomen als uitverkocht gelden.
  if (deliveredStems > 0 && soldStems >= deliveredStems) return "finalizing";
  return "selling";
}
