import type { QueryWindow } from "../types";
import { consignmentSql } from "../purchase-type";
import { isoDate, supplierClause } from "./helpers";

/**
 * `_datum_key_vertrek` heet als een getalsleutel maar is een echte datum
 * ("2026-08-17T00:00:00"), dus filteren met datumliteralen werkt gewoon.
 *
 * `Afrekenomzet` moet berekend worden als aantal * afrekenprijs. De kolom
 * `vor_omzet` lijkt bruikbaar maar is een andere maat (structureel 2-3%
 * afwijkend van aantal * prijs) — niet gebruiken.
 *
 * De vier sleutels moeten gevuld zijn. In `fct_orders` staan orderregels die aan
 * geen enkele partij hangen: 728 van 11.856 over acht dagen, waarvan 442 met
 * verkooptype "Script aanpassen" — een plaatshouder uit het bronsysteem — en de
 * rest zonder aantal of leverancier. De portal kan die niet plaatsen, want een
 * transactie hangt aan een partij en zonder partij is er geen kweker om het aan
 * toe te rekenen. Zonder dit filter valt de hele ronde om op validatie in plaats
 * van dat die rijen worden overgeslagen.
 *
 * ── De creditfactuur bij een correctie ──────────────────────────────────────
 *
 * `marts.fct_orders` vertelt niet of een correctie op de afrekening van de
 * kweker staat, en de redencode doet dat ook niet: alle negen VRK-codes komen in
 * vrijwel dezelfde verhouding voor op leveringen die kloppen en op leveringen
 * die afwijken. Wat het wél voorspelt is de datum van de creditfactuur waarop de
 * correctie is geboekt — staat die ná het drukken van de afrekening, dan mist de
 * correctie op het papier. Gemeten over 438 leveringen: 90% valt aan de juiste
 * kant van `SalesSheet.pdfInvoiceDate`.
 *
 * Die factuur staat één laag onder de mart, in `intermediate.int_order_correctie`,
 * met de datum in `staging.stg_kbtpro__fact`. Dat is dbt-binnenwerk en dus
 * brozer dan de marts — die veranderen zelf al zonder aankondiging van vorm. Het
 * hoort thuis in `fct_orders`; zolang dat niet zo is, is dit de enige manier om
 * het te meten. Blijft de join leeg, dan komen de kolommen als NULL binnen en
 * verandert er verder niets aan de import.
 *
 * `ROW_NUMBER()` en niet `MAX()` per kolom: een orderregel kan meer dan één
 * creditfactuur hebben, en dan zou `MAX(datum)` met `MAX(nummer)` een datum aan
 * het nummer van een andere factuur kunnen plakken. Zo hoort het nummer altijd
 * bij de datum ernaast.
 *
 * De join staat op (ordreg_id, part_id) en niet fijner, want `fct_orders` draagt
 * geen sleutel per correctierij — 1.342 correctierijen over 648 paren in mei
 * 2025. Dat is precies de korrel die de portal zelf ook heeft: `Transaction`
 * kent evenmin een rijsleutel per correctie.
 */
export function ordersQuery({ from, to, supplierFabricId }: QueryWindow): string {
  return `
SELECT
  o.ordreg_id,
  o.part_id,
  o.parthdr_id,
  o.rel_id_kweker,
  o.rel_id_leverancier,
  o._datum_key_vertrek,
  o.verkooptype                AS "Verkooptype",
  o.vor_aantal                 AS "Verkoopvolume",
  o.vor_colli                  AS "Verkoop_colli",
  ROUND(o.vor_aantal * o.afrekenprijs_per_steel, 3) AS "Afrekenomzet",
  o.afrekenprijs_per_steel     AS "Gem afrekenprijs",
  o.bronfeit_extra             AS "bron_feit_extra",
  o.reden_id,
  cc.credit_nummer             AS "Creditfactuurnummer",
  cc.credit_datum              AS "Creditfactuurdatum"
FROM marts.fct_orders AS o
LEFT JOIN (
  SELECT ordreg_id, part_id, credit_nummer, credit_datum
  FROM (
    SELECT c.ordreg_id,
           c.part_id,
           fa.nummer AS credit_nummer,
           fa.datum  AS credit_datum,
           ROW_NUMBER() OVER (
             PARTITION BY c.ordreg_id, c.part_id
             ORDER BY fa.datum DESC, fa.nummer DESC
           ) AS rn
    FROM intermediate.int_order_correctie c
    JOIN staging.stg_kbtpro__fact fa
      ON fa.nummer = c.factuurnummer
     AND fa.rel_id_debiteur = c.rel_id_debiteur
    WHERE c.vertrekdatum >= '${isoDate(from)}'
      AND c.vertrekdatum <  '${isoDate(to)}'
  ) g
  WHERE g.rn = 1
) cc
  ON cc.ordreg_id = o.ordreg_id
 AND cc.part_id   = o.part_id
 AND o.bronfeit_extra = 'correcties'
WHERE o._datum_key_vertrek >= '${isoDate(from)}'
  AND o._datum_key_vertrek <  '${isoDate(to)}'
  AND o.part_id IS NOT NULL
  AND o.parthdr_id IS NOT NULL
  AND o.rel_id_kweker IS NOT NULL
  AND o.rel_id_leverancier IS NOT NULL
  ${consignmentSql("o.inkooptype_code")}
  ${supplierClause("o.rel_id_leverancier", supplierFabricId)}
`.trim();
}
