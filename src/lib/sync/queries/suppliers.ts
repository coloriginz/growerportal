import type { QueryWindow } from "../types";
import { supplierClause } from "./helpers";

/**
 * Stamdata — geen leverdatum, dus `from`/`to` worden genegeerd.
 *
 * Gebruik `leverancier_verantwoordelijke` (niet `leverancier_contact_inkoper`)
 * als AM-kolom: die klopt 5/5 tegen de huidige portal, de inkoper-kolom wijkt
 * in 2/5 gevallen af. `buildSupplierScope` scopet commercie-gebruikers op
 * `accountManagerCode`, dus de verkeerde kolom laat ze de verkeerde
 * leveranciers zien.
 */
export function suppliersQuery({ supplierFabricId }: QueryWindow): string {
  return `
SELECT
  rel_id_leverancier                 AS "ID",
  leverancier_code                   AS "Code",
  leverancier_naam                   AS "Naam",
  leverancier_verantwoordelijke      AS "AM Naam",
  leverancier_verantwoordelijke_code AS "AM Code"
FROM marts.dim_leverancier
WHERE 1 = 1
  ${supplierClause("rel_id_leverancier", supplierFabricId)}
`.trim();
}
