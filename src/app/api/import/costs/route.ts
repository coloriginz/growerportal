import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireImportAuth, stripBracketKeys } from "@/lib/import-auth";

const costSchema = z.object({
  "Shkost ID": z.number().int(),
  "Parthdr ID": z.number().int(),
  "Kost Naam": z.string().nullable().optional(),
  "Kost ID": z.number().int().nullable().optional(),
  "Kost Type Code": z.string().nullable().optional(),
  "Kost Type Naam": z.string().nullable().optional(),
  "Totaal Omzet": z.number().nullable().optional(),
  "Totaal Aantal": z.number().int().nullable().optional(),
  "Salesheet Amount": z.number(),
  "Laatste Ontvangstdatum": z.string().nullable().optional(),
  "Laatste Aanmelddatum": z.string().nullable().optional(),
});

const bodySchema = z.object({
  costs: z.array(costSchema).min(1),
});

const BATCH_SIZE = 100;

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
  if (body.costs) body.costs = stripBracketKeys(body.costs);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    if (batch) {
      try {
        await prisma.importBatch.update({
          where: { id: batch.id },
          data: {
            status: "error",
            errorMessage: JSON.stringify(parsed.error.flatten()),
            durationMs: Date.now() - startTime,
            completedAt: new Date(),
          },
        });
      } catch {
        // Batch logging should not block the import
      }
    }
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const { costs } = parsed.data;

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
    const costUpdateOps: any[] = [];
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
        costUpdateOps.push(
          prisma.salesSheetCost.update({
            where: { fabricShkostId: row["Shkost ID"] },
            data: {
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
            },
          })
        );
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

    // Phase 3: Execute cost operations in batches
    for (let i = 0; i < costUpdateOps.length; i += BATCH_SIZE) {
      await prisma.$transaction(costUpdateOps.slice(i, i + BATCH_SIZE));
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

    // Phase 4: Recalculate salessheet totals using groupBy (2 queries instead of 2N)
    let ssRecalculated = 0;
    if (affectedSSIds.size > 0) {
      const ssIds = [...affectedSSIds];

      const [ssLotAggs, ssCostAggs] = await Promise.all([
        prisma.lot.groupBy({
          by: ["salesSheetId"],
          where: { salesSheetId: { in: ssIds } },
          _sum: { totalAmount: true },
        }),
        prisma.salesSheetCost.groupBy({
          by: ["salesSheetId"],
          where: { salesSheetId: { in: ssIds } },
          _sum: { amount: true },
        }),
      ]);

      const ssLotTotals = new Map<string, number>();
      for (const a of ssLotAggs) {
        if (a.salesSheetId) ssLotTotals.set(a.salesSheetId, Number(a._sum.totalAmount ?? 0));
      }
      const ssCostTotals = new Map<string, number>();
      for (const a of ssCostAggs) {
        if (a.salesSheetId) ssCostTotals.set(a.salesSheetId, Number(a._sum.amount ?? 0));
      }

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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ssUpdateOps: any[] = [];
      for (const ssId of ssIds) {
        const totalTurnover = ssLotTotals.get(ssId) ?? 0;
        const totalCosts = ssCostTotals.get(ssId) ?? 0;
        const lastReceiptDate = ssReceiptDates.get(ssId);
        const lastRegistrationDate = ssRegistrationDates.get(ssId);

        ssUpdateOps.push(
          prisma.salesSheet.update({
            where: { id: ssId },
            data: {
              totalTurnover: Math.round(totalTurnover * 100) / 100,
              totalCosts: Math.round(totalCosts * 100) / 100,
              netResult: Math.round((totalTurnover - totalCosts) * 100) / 100,
              ...(lastReceiptDate ? { lastReceiptDate } : {}),
              ...(lastRegistrationDate ? { lastRegistrationDate } : {}),
            },
          })
        );
        ssRecalculated++;
      }

      for (let i = 0; i < ssUpdateOps.length; i += BATCH_SIZE) {
        await prisma.$transaction(ssUpdateOps.slice(i, i + BATCH_SIZE));
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
