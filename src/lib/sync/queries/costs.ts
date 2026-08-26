import type { QueryWindow } from "../types";
import { isoDate, supplierViaPartijenClause } from "./helpers";

/**
 * De kostenregels van een levering.
 *
 * `marts.fct_salesheets_costs` is op 21 augustus 2026 van vorm veranderd en de
 * oude query gaf daarna geen fout die je ziet: de haal-flow antwoordt met 202
 * zodra hij gestart is, dus een mislukte SQL komt nergens terug en de job bleef
 * op `dispatched` staan tot de reaper hem na een kwartier opruimde. Wat er
 * wijzigde:
 *
 *   - `levering_datum` heet nu `_datum_key_levering` (nog steeds een datetime,
 *     dus dezelfde vergelijking blijft werken)
 *   - `kost_naam`, `kost_type_code` en `kost_type_naam` staan niet meer op de
 *     feitentabel maar in `marts.dim_kost`, en heten daar `kost_naam`,
 *     `kosttype_code` en `kosttype_naam` — zonder underscore na "kost"
 *
 * De join is LEFT: een kostenregel zonder dimensieregel hoort wél mee te komen,
 * anders verdwijnt hij stilzwijgend uit de afrekening.
 *
 * `laatste_ontvangstdatum` en `laatste_aanmelddatum` horen bij de levering en
 * niet bij de kostenregel: de import neemt er per afrekening de laatste van en
 * zet die op `SalesSheet.lastReceiptDate` en `lastRegistrationDate`. Ze staan
 * dus niet voor niets in deze query, ook al vind je ze niet terug op
 * `SalesSheetCost`.
 *
 * `parthdr_id` in de leveranciersclausule blijft onvoorwaardelijk: `dim_kost`
 * heeft die kolom niet, dus hij is niet ambigu.
 */
export function costsQuery({ from, to, supplierFabricId }: QueryWindow): string {
  return `
SELECT
  c.shkost_id        AS "Shkost ID",
  c.parthdr_id       AS "Parthdr ID",
  c.kost_id          AS "Kost ID",
  d.kost_naam        AS "Kost Naam",
  d.kost_code        AS "Kost Code",
  d.kosttype_code    AS "Kost Type Code",
  d.kosttype_naam    AS "Kost Type Naam",
  c.totaal_omzet     AS "Totaal Omzet",
  c.totaal_verkoop_aantal AS "Totaal Aantal",
  c.salesheet_amount AS "Salesheet Amount",
  c.salesheet_type   AS "Salesheet Type",
  c.is_inclusief     AS "Is Inclusief",
  c.laatste_ontvangstdatum AS "Laatste Ontvangstdatum",
  c.laatste_aanmelddatum   AS "Laatste Aanmelddatum"
FROM marts.fct_salesheets_costs c
LEFT JOIN marts.dim_kost d ON d.kost_id = c.kost_id
WHERE c._datum_key_levering >= '${isoDate(from)}'
  AND c._datum_key_levering <  '${isoDate(to)}'
  ${supplierViaPartijenClause(supplierFabricId)}
`.trim();
}
