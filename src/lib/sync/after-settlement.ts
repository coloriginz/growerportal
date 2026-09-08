import { prisma } from "@/lib/db";

/**
 * Zet `Transaction.afterSettlement` voor de opgegeven partijen en herberekent
 * daarna de partij- en leveringstotalen.
 *
 * Wat er daarna nog op een levering geboekt wordt staat niet op de afrekening
 * die de kweker al heeft, en telt in de portal dus niet mee — zie het commentaar
 * bij het veld in `prisma/schema.prisma`.
 *
 * Twee dingen die deze functie bewust doet:
 *
 * - **Hij zet de vlag ook terug op false.** Een levering waarvan de PDF wordt
 *   losgemaakt heeft geen `pdfInvoiceDate` meer, en dan hoort er niets meer
 *   verborgen te zijn. Alleen aanzetten zou omzet permanent laten verdwijnen op
 *   grond van een koppeling die is ingetrokken.
 * - **Alleen originele verkopen worden verborgen, nooit een correctie.** Een
 *   correctie draait een eerdere verkoop terug; verdwijnt zij, dan blijft de
 *   verkoop staan en gaat de omzet juist omhoog. In de praktijk kan het niet
 *   voorkomen, want een tegenboeking draagt de datum van de oorspronkelijke
 *   verkoop en valt dus altijd binnen de afrekening — gemeten: van de 274
 *   correcties met een creditfactuur van ná de afrekeningsdatum (samen
 *   EUR -12.311,01) zou de datumregel er nul verbergen. Maar dat is een
 *   eigenschap van de bron en geen garantie, en de fout die eronder zit is
 *   stil, dus staat hij hier hard in de voorwaarde.
 * - **Hij vergelijkt op de datum, niet op de dag.** `pdfInvoiceDate` komt uit de
 *   PDF en draagt geen tijd, dus middernacht; een transactie op de factuurdatum
 *   zelf valt daarmee binnen de afrekening zolang haar tijdstip niet later is.
 *   Dat is de bedoeling: "tot en met de factuurdatum".
 */
export async function markAfterSettlement(lotIds: string[]): Promise<number> {
  if (lotIds.length === 0) return 0;
  return prisma.$executeRawUnsafe(
    `UPDATE "Transaction" AS t
     SET "afterSettlement" = nieuw.waarde
     FROM (
       SELECT tx.id,
              (ss."pdfInvoiceDate" IS NOT NULL
               AND tx.date > ss."pdfInvoiceDate"
               AND tx."bronFeitExtra" = 'origineel') AS waarde
       FROM "Transaction" tx
       JOIN "Lot" lo ON lo.id = tx."lotId"
       LEFT JOIN "SalesSheet" ss ON ss.id = lo."salesSheetId"
       WHERE tx."lotId" IN (SELECT jsonb_array_elements_text($1::jsonb))
     ) AS nieuw
     WHERE t.id = nieuw.id AND t."afterSettlement" IS DISTINCT FROM nieuw.waarde`,
    JSON.stringify(lotIds)
  );
}

/**
 * Herberekent `Lot.totalStems`, `totalAmount` en `avgPrice` uit de transacties
 * die wél meetellen, en daarna de totalen van de leveringen eronder.
 *
 * Dezelfde som als in de orders-import, hier apart zodat het koppelen van een
 * PDF — waarbij `pdfInvoiceDate` pas bekend wordt — dezelfde weg loopt.
 */
export async function recalculateAfterSettlement(lotIds: string[]): Promise<void> {
  if (lotIds.length === 0) return;

  await prisma.$executeRawUnsafe(
    `UPDATE "Lot" AS l
     SET "totalStems" = COALESCE(agg.total_stems, 0),
         "totalAmount" = ROUND(COALESCE(agg.total_amount, 0)::numeric, 2),
         "avgPrice" = CASE WHEN COALESCE(agg.total_stems, 0) > 0
           THEN ROUND((COALESCE(agg.total_amount, 0) / agg.total_stems)::numeric, 4)
           ELSE 0 END,
         "updatedAt" = NOW()
     FROM (
       SELECT lo.id AS "lotId",
              SUM(tx.stems) FILTER (WHERE NOT tx."afterSettlement")::int AS total_stems,
              SUM(tx.amount) FILTER (WHERE NOT tx."afterSettlement") AS total_amount
       FROM "Lot" lo
       LEFT JOIN "Transaction" tx ON tx."lotId" = lo.id
       WHERE lo.id IN (SELECT jsonb_array_elements_text($1::jsonb))
       GROUP BY lo.id
     ) AS agg
     WHERE l.id = agg."lotId"`,
    JSON.stringify(lotIds)
  );

  await prisma.$executeRawUnsafe(
    `WITH ss_ids AS (
       SELECT DISTINCT "salesSheetId" AS id FROM "Lot"
       WHERE id IN (SELECT jsonb_array_elements_text($1::jsonb)) AND "salesSheetId" IS NOT NULL
     ),
     lot_totals AS (
       SELECT "salesSheetId", SUM("totalAmount") AS total FROM "Lot"
       WHERE "salesSheetId" IN (SELECT id FROM ss_ids) GROUP BY "salesSheetId"
     ),
     cost_totals AS (
       SELECT "salesSheetId", SUM(amount) AS total FROM "SalesSheetCost"
       WHERE "salesSheetId" IN (SELECT id FROM ss_ids) GROUP BY "salesSheetId"
     )
     UPDATE "SalesSheet" AS ss
     SET "totalTurnover" = ROUND(COALESCE(lt.total, 0)::numeric, 2),
         "totalCosts" = ROUND(COALESCE(ct.total, 0)::numeric, 2),
         "netResult" = ROUND((COALESCE(lt.total, 0) - COALESCE(ct.total, 0))::numeric, 2),
         "updatedAt" = NOW()
     FROM ss_ids
     LEFT JOIN lot_totals lt ON lt."salesSheetId" = ss_ids.id
     LEFT JOIN cost_totals ct ON ct."salesSheetId" = ss_ids.id
     WHERE ss.id = ss_ids.id`,
    JSON.stringify(lotIds)
  );
}
