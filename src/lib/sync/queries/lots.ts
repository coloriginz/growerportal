import type { QueryWindow } from "../types";
import { isoDate, supplierClause } from "./helpers";

/**
 * fct_partijen heeft wel art_id maar geen artikelnaam/-code — die staan in
 * dim_artikel. LEFT JOIN omdat art_id leeg kan zijn.
 */
export function lotsQuery({ from, to, supplierFabricId }: QueryWindow): string {
  return `
SELECT
  p.part_id,
  p.parthdr_id,
  p.rel_id_leverancier,
  p.partijnummer             AS "Partijnummer",
  p.inkoopfactuurnummer      AS "Inkoop Factuur Nummer",
  p.leverdatumtijd           AS "Lever Datum/Tijd",
  a.artikel_naam             AS "Artikel Naam",
  a.artikel_code             AS "Artikel Code",
  p.inkooptype_code          AS "Inkooptype Code",
  p.s01                      AS "S01",
  p.s02                      AS "S02",
  p.s03                      AS "S03",
  p.art_id,
  p.reden_id_correctie,
  p.inkoop_factuur_colli     AS "Inkoopfactuur colli",
  p.inkoopfust_volume        AS "Inkoopfactuur volume",
  p.inslag_aantal_correctie  AS "Inslag aantal correctie",
  p.facttypesub              AS "Facttype Sub"
FROM marts.fct_partijen p
LEFT JOIN marts.dim_artikel a ON a.art_id = p.art_id
WHERE p.leverdatum >= '${isoDate(from)}'
  AND p.leverdatum <  '${isoDate(to)}'
  ${supplierClause("p.rel_id_leverancier", supplierFabricId)}
`.trim();
}
