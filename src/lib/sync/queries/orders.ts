import type { QueryWindow } from "../types";
import { isoDate, supplierClause } from "./helpers";

/**
 * `_datum_key_vertrek` heet als een getalsleutel maar is een echte datum
 * ("2026-08-17T00:00:00"), dus filteren met datumliteralen werkt gewoon.
 *
 * `Afrekenomzet` moet berekend worden als aantal * afrekenprijs. De kolom
 * `vor_omzet` lijkt bruikbaar maar is een andere maat (structureel 2-3%
 * afwijkend van aantal * prijs) — niet gebruiken.
 */
export function ordersQuery({ from, to, supplierFabricId }: QueryWindow): string {
  return `
SELECT
  ordreg_id,
  part_id,
  parthdr_id,
  rel_id_kweker,
  rel_id_leverancier,
  _datum_key_vertrek,
  verkooptype                AS "Verkooptype",
  vor_aantal                 AS "Verkoopvolume",
  vor_colli                  AS "Verkoop_colli",
  ROUND(vor_aantal * afrekenprijs_per_steel, 3) AS "Afrekenomzet",
  afrekenprijs_per_steel     AS "Gem afrekenprijs",
  bronfeit_extra             AS "bron_feit_extra",
  reden_id
FROM marts.fct_orders
WHERE _datum_key_vertrek >= '${isoDate(from)}'
  AND _datum_key_vertrek <  '${isoDate(to)}'
  ${supplierClause("rel_id_leverancier", supplierFabricId)}
`.trim();
}
