import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { runImport } from "@/lib/import-batch";

// Vercel kapt een functie zonder dit af op de standaardlimiet; de lots- en
// orders-import over een breed venster halen die niet.
export const maxDuration = 300;

const costSchema = z.object({
  "Shkost ID": z.number(),
  "Parthdr ID": z.number(),
  "Kost Naam": z.string().nullable().optional(),
  "Kost ID": z.number().nullable().optional(),
  "Kost Type Code": z.string().nullable().optional(),
  "Kost Type Naam": z.string().nullable().optional(),
  "Totaal Omzet": z.number().nullable().optional(),
  "Totaal Aantal": z.number().nullable().optional(),
  "Salesheet Amount": z.number(),
  "Kost Code": z.string().nullable().optional(),
  "Salesheet Type": z.string().nullable().optional(),
  // De SQL-connector stuurt een bit als true/false, DAX als 1/0. Beide accepteren,
  // anders valt de hele ronde om op validatie zodra de bron van vorm verandert.
  "Is Inclusief": z.union([z.boolean(), z.number()]).nullable().optional(),
  // Deze twee horen bij de levering, niet bij de kostenregel: ze landen op
  // SalesSheet.lastReceiptDate en lastRegistrationDate, per afrekening de laatste.
  "Laatste Ontvangstdatum": z.string().nullable().optional(),
  "Laatste Aanmelddatum": z.string().nullable().optional(),
});

type Cost = z.infer<typeof costSchema>;

const costKeys = Object.keys(costSchema.shape);

/**
 * Warehouse columns whose name differs from the schema field beyond spelling.
 * Everything else in marts.fct_salesheets_costs matches once case, spaces and
 * underscores are ignored, so this list stays short on purpose.
 */
const costAliases = {
  "Totaal Aantal": ["totaal_verkoop_aantal"],
} as const;

export async function POST(request: NextRequest) {
  return runImport(request, {
    endpoint: "costs",
    bodyKey: "costs",
    rowSchema: costSchema,
    schemaKeys: costKeys,
    aliases: costAliases,
    handler: async (costs, batchId) => {
      if (costs.length === 0) return { created: 0, updated: 0, skipped: 0 };
      return upsertCosts(costs, batchId);
    },
  });
}

/**
 * `is_inclusief` komt als bit (true/false) of als getal (1/0) binnen, afhankelijk
 * van welke connector de rij stuurde. Onbekend blijft `null` en wordt geen
 * `false`: "we weten het niet" en "het is niet inclusief" zijn niet hetzelfde,
 * en een oude rij die nooit opnieuw is opgehaald hoort niet stilzwijgend als
 * gewone levering te gelden.
 */
function leesInclusief(row: Cost): boolean | null {
  const waarde = row["Is Inclusief"];
  if (waarde === null || waarde === undefined) return null;
  return typeof waarde === "number" ? waarde !== 0 : waarde;
}

async function upsertCosts(costs: Cost[], batchId: string | null) {
  // Round IDs (DAX/Power Automate can send 1.0 instead of 1)
  for (const row of costs) {
    row["Shkost ID"] = Math.round(row["Shkost ID"]);
    row["Parthdr ID"] = Math.round(row["Parthdr ID"]);
    if (row["Kost ID"]) row["Kost ID"] = Math.round(row["Kost ID"]);
    if (row["Totaal Aantal"]) row["Totaal Aantal"] = Math.round(row["Totaal Aantal"]);
  }

  // Phase 1: Pre-fetch salessheet lookup and existing costs in parallel
  const parthdrIds = [...new Set(costs.map((c) => c["Parthdr ID"]))];
  const allShkostIds = costs.map((c) => c["Shkost ID"]);

  const [salesSheets, existingCosts] = await Promise.all([
    prisma.salesSheet.findMany({
      where: { fabricParthdrId: { in: parthdrIds } },
      select: { id: true, fabricParthdrId: true },
    }),
    prisma.salesSheetCost.findMany({
      where: { fabricShkostId: { in: allShkostIds } },
      select: { id: true, fabricShkostId: true },
    }),
  ]);

  const ssMap = new Map<number, string>();
  for (const ss of salesSheets) {
    if (ss.fabricParthdrId) ssMap.set(ss.fabricParthdrId, ss.id);
  }

  const costExistsSet = new Set<number>();
  for (const c of existingCosts) {
    if (c.fabricShkostId) costExistsSet.add(c.fabricShkostId);
  }

  // Phase 2: Build cost operations
  let created = 0,
    updated = 0,
    skipped = 0;
  const affectedSSIds = new Set<string>();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const costUpdateData: any[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const costCreateData: any[] = [];

  for (const row of costs) {
    const salesSheetId = ssMap.get(row["Parthdr ID"]);
    if (!salesSheetId) {
      skipped++;
      continue;
    }

    const description = row["Kost Naam"]?.trim() || "Unknown cost";
    const amount = Math.round(row["Salesheet Amount"] * 100) / 100;

    if (costExistsSet.has(row["Shkost ID"])) {
      costUpdateData.push({
        fabricShkostId: row["Shkost ID"],
        description,
        amount,
        fabricKostId: row["Kost ID"] || null,
        costCode: row["Kost Code"]?.trim() || null,
        salesSheetType: row["Salesheet Type"]?.trim() || null,
        isInclusief: leesInclusief(row),
        costTypeCode: row["Kost Type Code"] || null,
        costTypeName: row["Kost Type Naam"] || null,
        totalTurnover:
          row["Totaal Omzet"] != null
            ? Math.round(row["Totaal Omzet"] * 100) / 100
            : null,
        totalQuantity: row["Totaal Aantal"] || null,
      });
      updated++;
    } else {
      costCreateData.push({
        salesSheetId,
        description,
        amount,
        fabricShkostId: row["Shkost ID"],
        fabricKostId: row["Kost ID"] || null,
        costCode: row["Kost Code"]?.trim() || null,
        salesSheetType: row["Salesheet Type"]?.trim() || null,
        isInclusief: leesInclusief(row),
        costTypeCode: row["Kost Type Code"] || null,
        costTypeName: row["Kost Type Naam"] || null,
        totalTurnover:
          row["Totaal Omzet"] != null
            ? Math.round(row["Totaal Omzet"] * 100) / 100
            : null,
        totalQuantity: row["Totaal Aantal"] || null,
        lastImportBatchId: batchId,
      });
      created++;
    }
    affectedSSIds.add(salesSheetId);
  }

  // Phase 3: Execute cost operations
  if (costUpdateData.length > 0) {
    await prisma.$executeRawUnsafe(
      `UPDATE "SalesSheetCost" AS t
         SET
           description = u.val->>'description',
           amount = (u.val->>'amount')::numeric,
           "fabricKostId" = (u.val->>'fabricKostId')::int,
           "costCode" = u.val->>'costCode',
           "salesSheetType" = u.val->>'salesSheetType',
           "isInclusief" = (u.val->>'isInclusief')::boolean,
           "costTypeCode" = u.val->>'costTypeCode',
           "costTypeName" = u.val->>'costTypeName',
           "totalTurnover" = (u.val->>'totalTurnover')::numeric,
           "totalQuantity" = (u.val->>'totalQuantity')::int,
           "lastImportBatchId" = $2,
           "updatedAt" = NOW()
         FROM jsonb_array_elements($1::jsonb) AS u(val)
         WHERE t."fabricShkostId" = (u.val->>'fabricShkostId')::int`,
      JSON.stringify(costUpdateData),
      batchId
    );
  }

  if (costCreateData.length > 0) {
    try {
      await prisma.salesSheetCost.createMany({ data: costCreateData });
    } catch {
      // Fallback to individual creates
      for (const data of costCreateData) {
        try {
          await prisma.salesSheetCost.create({ data });
        } catch {
          skipped++;
          created--;
        }
      }
    }
  }

  // Phase 4: Recalculate salessheet totals via single raw SQL
  let ssRecalculated = 0;
  if (affectedSSIds.size > 0) {
    const ssIds = [...affectedSSIds];

    // Build date maps from input data for receipt/registration dates
    const ssReceiptDates = new Map<string, Date>();
    const ssRegistrationDates = new Map<string, Date>();
    for (const row of costs) {
      const ssId = ssMap.get(row["Parthdr ID"]);
      if (!ssId) continue;

      if (row["Laatste Ontvangstdatum"]) {
        const d = new Date(row["Laatste Ontvangstdatum"]);
        if (!isNaN(d.getTime())) {
          const current = ssReceiptDates.get(ssId);
          if (!current || d > current) ssReceiptDates.set(ssId, d);
        }
      }
      if (row["Laatste Aanmelddatum"]) {
        const d = new Date(row["Laatste Aanmelddatum"]);
        if (!isNaN(d.getTime())) {
          const current = ssRegistrationDates.get(ssId);
          if (!current || d > current) ssRegistrationDates.set(ssId, d);
        }
      }
    }

    // Recalculate totals in a single SQL with CTEs
    ssRecalculated = await prisma.$executeRawUnsafe(
      `WITH ss_ids AS (
           SELECT jsonb_array_elements_text($1::jsonb) AS id
         ),
         lot_totals AS (
           SELECT "salesSheetId", SUM("totalAmount") as total
           FROM "Lot"
           WHERE "salesSheetId" IN (SELECT id FROM ss_ids)
           GROUP BY "salesSheetId"
         ),
         cost_totals AS (
           SELECT "salesSheetId", SUM(amount) as total
           FROM "SalesSheetCost"
           WHERE "salesSheetId" IN (SELECT id FROM ss_ids)
           GROUP BY "salesSheetId"
         )
         UPDATE "SalesSheet" AS ss
         SET
           "totalTurnover" = ROUND(COALESCE(lt.total, 0)::numeric, 2),
           "totalCosts" = ROUND(COALESCE(ct.total, 0)::numeric, 2),
           "netResult" = ROUND((COALESCE(lt.total, 0) - COALESCE(ct.total, 0))::numeric, 2),
           "updatedAt" = NOW()
         FROM ss_ids
         LEFT JOIN lot_totals lt ON lt."salesSheetId" = ss_ids.id
         LEFT JOIN cost_totals ct ON ct."salesSheetId" = ss_ids.id
         WHERE ss.id = ss_ids.id`,
      JSON.stringify(ssIds)
    );

    // Update receipt/registration dates separately
    const dateUpdates: { id: string; lastReceiptDate: string | null; lastRegistrationDate: string | null }[] = [];
    for (const ssId of ssIds) {
      const receipt = ssReceiptDates.get(ssId);
      const registration = ssRegistrationDates.get(ssId);
      if (receipt || registration) {
        dateUpdates.push({
          id: ssId,
          lastReceiptDate: receipt?.toISOString() || null,
          lastRegistrationDate: registration?.toISOString() || null,
        });
      }
    }
    if (dateUpdates.length > 0) {
      await prisma.$executeRawUnsafe(
        `UPDATE "SalesSheet" AS t
           SET
             "lastReceiptDate" = COALESCE((u.val->>'lastReceiptDate')::timestamp, t."lastReceiptDate"),
             "lastRegistrationDate" = COALESCE((u.val->>'lastRegistrationDate')::timestamp, t."lastRegistrationDate")
           FROM jsonb_array_elements($1::jsonb) AS u(val)
           WHERE t.id = u.val->>'id'`,
        JSON.stringify(dateUpdates)
      );
    }
  }

  return {
    created,
    updated,
    skipped,
    details: { salesSheetsRecalculated: ssRecalculated },
    extra: { salesSheetsRecalculated: ssRecalculated },
  };
}
