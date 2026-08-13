import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireImportAuth, normalizeImportKeys, summariseImportError } from "@/lib/import-auth";

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
  "Laatste Ontvangstdatum": z.string().nullable().optional(),
  "Laatste Aanmelddatum": z.string().nullable().optional(),
});

const bodySchema = z.object({
  costs: z.array(costSchema),
});

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
  const authError = requireImportAuth(request);
  if (authError) return authError;

  const startTime = Date.now();
  let batch: { id: string } | null = null;
  try {
    batch = await prisma.importBatch.create({
      data: { endpoint: "costs", status: "running" },
    });
  } catch {
    // Batch logging should not block the import
  }

  const body = await request.json();
  if (Array.isArray(body.costs)) {
    body.costs = normalizeImportKeys(body.costs, costKeys, costAliases);
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    const summary = summariseImportError(
      parsed.error.issues,
      Array.isArray(body.costs) ? body.costs : [],
      costKeys
    );
    if (batch) {
      try {
        await prisma.importBatch.update({
          where: { id: batch.id },
          data: {
            status: "error",
            errorMessage: summary,
            durationMs: Date.now() - startTime,
            completedAt: new Date(),
          },
        });
      } catch {
        // Batch logging should not block the import
      }
    }
    return NextResponse.json({ error: JSON.parse(summary) }, { status: 400 });
  }

  try {
    const { costs } = parsed.data;

    if (costs.length === 0) {
      if (batch) {
        try {
          await prisma.importBatch.update({
            where: { id: batch.id },
            data: { status: "success", recordsReceived: 0, durationMs: Date.now() - startTime, completedAt: new Date() },
          });
        } catch { /* */ }
      }
      return NextResponse.json({ received: 0, created: 0, updated: 0, skipped: 0 });
    }

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
          costTypeCode: row["Kost Type Code"] || null,
          costTypeName: row["Kost Type Naam"] || null,
          totalTurnover:
            row["Totaal Omzet"] != null
              ? Math.round(row["Totaal Omzet"] * 100) / 100
              : null,
          totalQuantity: row["Totaal Aantal"] || null,
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
           "costTypeCode" = u.val->>'costTypeCode',
           "costTypeName" = u.val->>'costTypeName',
           "totalTurnover" = (u.val->>'totalTurnover')::numeric,
           "totalQuantity" = (u.val->>'totalQuantity')::int,
           "updatedAt" = NOW()
         FROM jsonb_array_elements($1::jsonb) AS u(val)
         WHERE t."fabricShkostId" = (u.val->>'fabricShkostId')::int`,
        JSON.stringify(costUpdateData)
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

    if (batch) {
      try {
        await prisma.importBatch.update({
          where: { id: batch.id },
          data: {
            status: "success",
            recordsReceived: costs.length,
            recordsCreated: created,
            recordsUpdated: updated,
            recordsSkipped: skipped,
            durationMs: Date.now() - startTime,
            completedAt: new Date(),
            details: {
              salesSheetsRecalculated: ssRecalculated,
            },
          },
        });
      } catch {
        // Batch logging should not block the import
      }
    }

    return NextResponse.json({
      received: costs.length,
      created,
      updated,
      skipped,
      salesSheetsRecalculated: ssRecalculated,
    });
  } catch (err) {
    if (batch) {
      try {
        await prisma.importBatch.update({
          where: { id: batch.id },
          data: {
            status: "error",
            errorMessage: err instanceof Error ? err.message : String(err),
            durationMs: Date.now() - startTime,
            completedAt: new Date(),
          },
        });
      } catch {
        // Batch logging should not block the import
      }
    }
    throw err;
  }
}
