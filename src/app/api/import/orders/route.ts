import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireImportAuth } from "@/lib/import-auth";

const orderSchema = z.object({
  ordreg_id: z.number().int(),
  part_id: z.number().int(),
  parthdr_id: z.number().int(),
  rel_id_kweker: z.number().int(),
  rel_id_leverancier: z.number().int(),
  _datum_key_vertrek: z.string(),
  Verkooptype: z.string().nullable().optional(),
  Verkoopvolume: z.number().int().nullable().optional(),
  Verkoop_colli: z.number().int().nullable().optional(),
  Afrekenomzet: z.number().nullable().optional(),
  "Gem afrekenprijs": z.number().nullable().optional(),
});

const bodySchema = z.object({
  orders: z.array(orderSchema).min(1),
});

export async function POST(request: NextRequest) {
  const authError = requireImportAuth(request);
  if (authError) return authError;

  const startTime = Date.now();
  let batch: { id: string } | null = null;
  try {
    batch = await prisma.importBatch.create({
      data: { endpoint: "orders", status: "running" },
    });
  } catch {
    // Batch logging should not block the import
  }

  const body = await request.json();
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
    const { orders } = parsed.data;

    // Build lot lookup: fabricPartId → lot UUID
    const lotPartIds = [...new Set(orders.map((o) => o.part_id))];
    const lots = await prisma.lot.findMany({
      where: { fabricPartId: { in: lotPartIds } },
      select: { id: true, fabricPartId: true, supplierId: true },
    });
    const lotMap = new Map<number, { id: string; supplierId: string }>();
    for (const l of lots) {
      if (l.fabricPartId) lotMap.set(l.fabricPartId, { id: l.id, supplierId: l.supplierId });
    }

    // Build supplier lookup for grower creation
    const supplierFabricIds = [...new Set(orders.map((o) => o.rel_id_leverancier))];
    const suppliers = await prisma.supplier.findMany({
      where: { fabricId: { in: supplierFabricIds } },
      select: { id: true, fabricId: true },
    });
    const supplierMap = new Map<number, string>();
    for (const s of suppliers) {
      if (s.fabricId) supplierMap.set(s.fabricId, s.id);
    }

    // 1. Upsert growers (kwekers)
    const growerPairs = new Map<number, string>(); // fabricKwekerId → supplierId
    for (const row of orders) {
      if (!growerPairs.has(row.rel_id_kweker)) {
        const supplierId = supplierMap.get(row.rel_id_leverancier);
        if (supplierId) growerPairs.set(row.rel_id_kweker, supplierId);
      }
    }

    let growersCreated = 0;
    let growersExisting = 0;
    const growerMap = new Map<number, string>(); // fabricId → grower UUID

    for (const [fabricKwekerId, supplierId] of growerPairs) {
      const existing = await prisma.grower.findUnique({ where: { fabricId: fabricKwekerId } });
      if (existing) {
        growerMap.set(fabricKwekerId, existing.id);
        growersExisting++;
      } else {
        try {
          const grower = await prisma.grower.create({
            data: { fabricId: fabricKwekerId, supplierId },
          });
          growerMap.set(fabricKwekerId, grower.id);
          growersCreated++;
        } catch {
          // Duplicate race condition
          const found = await prisma.grower.findUnique({ where: { fabricId: fabricKwekerId } });
          if (found) growerMap.set(fabricKwekerId, found.id);
        }
      }
    }

    // 2. Upsert transactions
    let txCreated = 0, txUpdated = 0, txSkipped = 0;

    // Track affected lots for aggregate recalculation
    const affectedLotIds = new Set<string>();

    for (const row of orders) {
      const lotInfo = lotMap.get(row.part_id);
      if (!lotInfo) { txSkipped++; continue; }

      const date = new Date(row._datum_key_vertrek);
      if (isNaN(date.getTime())) { txSkipped++; continue; }

      const salesType = row.Verkooptype?.trim() || "Unknown";
      const stems = row.Verkoopvolume ?? 0;
      const amount = row.Afrekenomzet ?? 0;
      const pricePerStem = row["Gem afrekenprijs"] ?? 0;

      try {
        const existing = await prisma.transaction.findUnique({
          where: { fabricOrdregId: row.ordreg_id },
        });

        if (existing) {
          await prisma.transaction.update({
            where: { fabricOrdregId: row.ordreg_id },
            data: {
              date,
              salesType,
              stems,
              pricePerStem: Math.round(pricePerStem * 10000) / 10000,
              amount: Math.round(amount * 100) / 100,
              fabricGrowerId: row.rel_id_kweker,
            },
          });
          txUpdated++;
        } else {
          await prisma.transaction.create({
            data: {
              lotId: lotInfo.id,
              fabricOrdregId: row.ordreg_id,
              fabricGrowerId: row.rel_id_kweker,
              date,
              salesType,
              stems,
              pricePerStem: Math.round(pricePerStem * 10000) / 10000,
              amount: Math.round(amount * 100) / 100,
            },
          });
          txCreated++;
        }
        affectedLotIds.add(lotInfo.id);
      } catch {
        txSkipped++;
      }
    }

    // 3. Recalculate aggregates for affected lots
    let lotsRecalculated = 0;
    for (const lotId of affectedLotIds) {
      const agg = await prisma.transaction.aggregate({
        where: { lotId },
        _sum: { stems: true, amount: true },
      });
      const totalStems = agg._sum.stems ?? 0;
      const totalAmount = Number(agg._sum.amount ?? 0);
      const avgPrice = totalStems > 0 ? totalAmount / totalStems : 0;

      // Find grower from first transaction
      const firstTx = await prisma.transaction.findFirst({
        where: { lotId, fabricGrowerId: { not: null } },
        select: { fabricGrowerId: true },
      });
      const growerId = firstTx?.fabricGrowerId
        ? growerMap.get(firstTx.fabricGrowerId) || null
        : null;

      await prisma.lot.update({
        where: { id: lotId },
        data: {
          totalStems,
          totalAmount: Math.round(totalAmount * 100) / 100,
          avgPrice: Math.round(avgPrice * 10000) / 10000,
          ...(growerId ? { growerId } : {}),
        },
      });
      lotsRecalculated++;
    }

    // 4. Recalculate salessheet totals for affected salessheets
    const affectedSSIds = new Set<string>();
    const affectedLots = await prisma.lot.findMany({
      where: { id: { in: [...affectedLotIds] } },
      select: { salesSheetId: true },
    });
    for (const l of affectedLots) {
      if (l.salesSheetId) affectedSSIds.add(l.salesSheetId);
    }

    let ssRecalculated = 0;
    for (const ssId of affectedSSIds) {
      const lotAgg = await prisma.lot.aggregate({
        where: { salesSheetId: ssId },
        _sum: { totalAmount: true },
      });
      const costAgg = await prisma.salesSheetCost.aggregate({
        where: { salesSheetId: ssId },
        _sum: { amount: true },
      });
      const totalTurnover = Number(lotAgg._sum.totalAmount ?? 0);
      const totalCosts = Number(costAgg._sum.amount ?? 0);

      await prisma.salesSheet.update({
        where: { id: ssId },
        data: {
          totalTurnover: Math.round(totalTurnover * 100) / 100,
          totalCosts: Math.round(totalCosts * 100) / 100,
          netResult: Math.round((totalTurnover - totalCosts) * 100) / 100,
        },
      });
      ssRecalculated++;
    }

    if (batch) {
      try {
        await prisma.importBatch.update({
          where: { id: batch.id },
          data: {
            status: "success",
            recordsReceived: orders.length,
            recordsCreated: txCreated,
            recordsUpdated: txUpdated,
            recordsSkipped: txSkipped,
            durationMs: Date.now() - startTime,
            completedAt: new Date(),
            details: {
              growers: { created: growersCreated, existing: growersExisting },
              recalculated: { lots: lotsRecalculated, salesSheets: ssRecalculated },
            },
          },
        });
      } catch {
        // Batch logging should not block the import
      }
    }

    return NextResponse.json({
      received: orders.length,
      growers: { created: growersCreated, existing: growersExisting },
      transactions: { created: txCreated, updated: txUpdated, skipped: txSkipped },
      recalculated: { lots: lotsRecalculated, salesSheets: ssRecalculated },
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
