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
  /** Fabric rel_id_leverancier. Alleen gevuld bij een backfill voor één leverancier. */
  supplierFabricId?: number | null;
};

/**
 * Bepaalt naar welke portal Power Automate het resultaat terugstuurt. Komt uit
 * de omgevingsvariabele van de deployment en nooit uit een request — anders kan
 * één verkeerde aanroep testdata naar productie duwen.
 */
export type SyncEnv = "test" | "production";

export function resolveSyncEnv(): SyncEnv | null {
  const env = process.env.NEXT_PUBLIC_APP_ENV;
  if (env === "production") return "production";
  if (env === "test") return "test";
  return null; // development: niets versturen, Power Automate kan localhost niet bereiken
}
