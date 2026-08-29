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
  /** Som van `Lot.totalStems` over de partijen van deze levering. */
  deliveredStems: number;
  /** Som van `Transaction.stems` over dezelfde partijen. */
  soldStems: number;
  /** Aantal `SalesSheetCost`-regels: het bewijs dat de afrekening gedraaid is. */
  costCount: number;
}

/**
 * Correcties tellen hier niet apart mee. `Lot.totalStems` komt uit
 * `inkoop_factuur_aantal` en is de definitieve gefactureerde hoeveelheid:
 * gemeten over 7.878 leveringen komt verkocht in 7.715 gevallen exact uit op
 * aangevoerd — ook bij partijen mét correcties — en het komt er nooit boven.
 * `Lot.correctionVolume` erbij optellen of eraf halen sluit het gat in de rest
 * juist niet.
 *
 * De kostenregels hebben voorrang op het stelenverschil. De warehouse herschrijft
 * historie: een orderregel komt binnen met zijn sleutels gevuld maar `vor_aantal`
 * nog leeg, en die aantallen worden pas weken later ingevuld. Daardoor staan er
 * 139 leveringen in de portal die aantoonbaar zijn afgerekend terwijl de
 * verkochte stelen achterlopen. Wint het stelenverschil, dan blijven die voor
 * altijd op Selling staan terwijl de kweker zijn afrekening allang heeft.
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
