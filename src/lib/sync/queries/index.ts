import type { QueryWindow, SyncEndpoint } from "../types";
import { costsQuery } from "./costs";

type Builder = (window: QueryWindow) => string;

/**
 * Endpoints zonder bouwer geven een duidelijke fout in plaats van een lege
 * query. Ze worden aangevuld in taak 11.
 */
const builders: Partial<Record<SyncEndpoint, Builder>> = {
  costs: costsQuery,
};

export function buildQuery(endpoint: SyncEndpoint, window: QueryWindow): string {
  const builder = builders[endpoint];
  if (!builder) throw new Error(`Nog geen query-bouwer voor endpoint '${endpoint}'`);
  return builder(window);
}
