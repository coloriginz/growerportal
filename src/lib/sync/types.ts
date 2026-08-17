/**
 * De vijf endpoints, in de volgorde waarin ze moeten draaien. De volgorde is
 * een harde afhankelijkheid: de lots-import zoekt de leverancier op en gooit de
 * partij stilzwijgend weg als die nog niet bestaat.
 */
export const SYNC_ENDPOINTS = [
  "suppliers",
  "growers",
  "lots",
  "orders",
  "costs",
] as const;

export type SyncEndpoint = (typeof SYNC_ENDPOINTS)[number];

export function isSyncEndpoint(value: string): value is SyncEndpoint {
  return (SYNC_ENDPOINTS as readonly string[]).includes(value);
}

/** Sorteert een lijst endpoints in de verplichte volgorde. */
export function inChainOrder(endpoints: readonly string[]): SyncEndpoint[] {
  return SYNC_ENDPOINTS.filter((e) => endpoints.includes(e));
}

export type QueryWindow = {
  from: Date;
  /** Exclusief: de query gebruikt `< to`, zodat aangrenzende brokken niet overlappen. */
  to: Date;
  /**
   * Fabric rel_id_leverancier. Alleen gevuld bij een backfill voor één leverancier.
   * Geen `| null`: `Supplier.fabricId` is nullable in het schema, en een `null` hier
   * zou stilzwijgend de leveranciersfilter laten vallen — dan haalt een backfill voor
   * een leverancier zonder fabricId per ongeluk het hele warehouse op. Een aanroeper
   * met een `number | null` moet dat eerst zelf oplossen, niet deze functie.
   */
  supplierFabricId?: number;
};
