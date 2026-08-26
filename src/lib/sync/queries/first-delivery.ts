import { consignmentSql } from "../purchase-type";
import { safeSupplierId } from "./helpers";

/**
 * Wanneer kwam de eerste consignatiepartij van deze leverancier binnen? Eén rij,
 * één kolom, leeg als hij er geen heeft.
 *
 * Het inkooptypefilter is geen detail maar de kern van de vraag: een relatie kan
 * jarenlang op inkoop (FOB/CIF) geleverd hebben en pas vorige maand op
 * consignatie. Zonder filter zou de backfill vanaf die inkoophistorie plannen en
 * daarmee juist de kwartalen ophalen waar de portal niets mee doet. Het komt uit
 * `consignmentSql`, zodat deze vraag en de imports niet uit elkaar kunnen lopen.
 *
 * Geen `supplierClause` maar een eigen controle die gooit: dat hulpje geeft een
 * leeg fragment terug bij een onbruikbaar id, en een MIN zonder leveranciers-
 * filter is de eerste partij van het hele warehouse — een antwoord dat er
 * geloofwaardig uitziet en nergens over gaat.
 */
export function firstDeliveryQuery(supplierFabricId: number): string {
  const id = safeSupplierId(supplierFabricId);
  if (id === null) {
    throw new Error(`Not a usable Fabric relation id: ${supplierFabricId}`);
  }

  return `
SELECT MIN(leverdatum) AS "eerste_levering"
FROM marts.fct_partijen
WHERE rel_id_leverancier = ${id}
  ${consignmentSql("inkooptype_code")}
`.trim();
}
