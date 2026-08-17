import type { QueryWindow } from "../types";
import { growerViaPartijenClause } from "./helpers";

/**
 * Stamdata — geen leverdatum, dus `from`/`to` worden genegeerd. dim_kweker
 * heeft geen rel_id_leverancier; het leveranciersfilter loopt via de partijen
 * (zie growerViaPartijenClause).
 */
export function growersQuery({ supplierFabricId }: QueryWindow): string {
  return `
SELECT
  rel_id_kweker    AS "ID",
  kweker_naam      AS "Naam",
  kweker_code      AS "Code",
  kweker_land_code AS "Land Code",
  kweker_land_naam AS "Land Naam",
  kweker_plaats    AS "Plaats"
FROM marts.dim_kweker
WHERE 1 = 1
  ${growerViaPartijenClause(supplierFabricId)}
`.trim();
}
