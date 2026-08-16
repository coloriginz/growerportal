import type { QueryWindow, SyncEndpoint } from "../types";
import { costsQuery } from "./costs";
import { growersQuery } from "./growers";
import { lotsQuery } from "./lots";
import { ordersQuery } from "./orders";
import { suppliersQuery } from "./suppliers";

type Builder = (window: QueryWindow) => string;

/**
 * Eén bouwer per endpoint. `Record` (niet `Partial`) zodat de compiler
 * afdwingt dat elk endpoint uit SYNC_ENDPOINTS een bouwer heeft — een
 * vergeten endpoint is dan een build-fout, niet een runtime-fout.
 */
const builders: Record<SyncEndpoint, Builder> = {
  suppliers: suppliersQuery,
  growers: growersQuery,
  lots: lotsQuery,
  orders: ordersQuery,
  costs: costsQuery,
};

export function buildQuery(endpoint: SyncEndpoint, window: QueryWindow): string {
  return builders[endpoint](window);
}
