import type { QueryWindow } from "../types";
import { isoDate, supplierClause } from "./helpers";

export function costsQuery({ from, to, supplierFabricId }: QueryWindow): string {
  return `
SELECT
  shkost_id        AS "Shkost ID",
  parthdr_id       AS "Parthdr ID",
  kost_id          AS "Kost ID",
  kost_naam        AS "Kost Naam",
  kost_type_code   AS "Kost Type Code",
  kost_type_naam   AS "Kost Type Naam",
  totaal_omzet     AS "Totaal Omzet",
  totaal_verkoop_aantal AS "Totaal Aantal",
  salesheet_amount AS "Salesheet Amount",
  laatste_ontvangstdatum AS "Laatste Ontvangstdatum",
  laatste_aanmelddatum   AS "Laatste Aanmelddatum"
FROM marts.fct_salesheets_costs
WHERE levering_datum >= '${isoDate(from)}'
  AND levering_datum <  '${isoDate(to)}'
  ${supplierClause("rel_id_leverancier", supplierFabricId)}
`.trim();
}
