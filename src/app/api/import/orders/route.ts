import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireImportAuth, stripBracketKeys } from "@/lib/import-auth";

const orderSchema = z.object({
  ordreg_id: z.number(),
  part_id: z.number(),
  parthdr_id: z.number(),
  rel_id_kweker: z.number(),
  rel_id_leverancier: z.number(),
  _datum_key_vertrek: z.string(),
  Verkooptype: z.string().nullable().optional(),
  Verkoopvolume: z.number().nullable().optional(),
  Verkoop_colli: z.number().nullable().optional(),
  Afrekenomzet: z.number().nullable().optional(),
  "Gem afrekenprijs": z.number().nullable().optional(),
});

const bodySchema = z.object({
  orders: z.array(orderSchema).min(1),
});

const BATCH_SIZE = 100;

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
  if (body.orders) body.orders = stripBracketKeys(body.orders);
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

    // Build supplier lookup
    const supplierFabricIds = [...new Set(orders.map((o) => o.rel_id_leverancier))];
    const suppliers = await prisma.supplier.findMany({
      where: { fabricId: { in: supplierFabricIds } },
      select: { id: true, fabricId: true },
    });
    const supplierMap = new Map<number, string>();
    for (const s of suppliers) {
      if (s.fabricId) supplierMap.set(s.fabricId, s.id);
    }

    // Round IDs (DAX/Power Automate can send 1.0 instead of 1)
    for (const row of orders) {
      row.ordreg_id = Math.round(row.ordreg_id);
      row.part_id = Math.round(row.part_id);
      row.parthdr_id = Math.round(row.parthdr_id);
      row.rel_id_kweker = Math.round(row.rel_id_kweker);
      row.rel_id_leverancier = Math.round(row.rel_id_leverancier);
    }

    // Build grower pairs: fabricKwekerId → supplierId
    const growerPairs = new Map<number, string>();
    for (const row of orders) {
      if (!growerPairs.has(row.rel_id_kweker)) {
        const supplierId = supplierMap.get(row.rel_id_leverancier);
        if (supplierId) growerPairs.set(row.rel_id_kweker, supplierId);
      }
    }

    // Phase 1: Pre-fetch existing growers, FabricRelations, lots, transactions in parallel
    const growerFabricIds = [...growerPairs.keys()];
    const lotPartIds = [...new Set(orders.map((o) => o.part_id))];
    const allOrdregIds = orders.map((o) => o.ordreg_id);

    const [existingGrowers, fabricRelations, lots, existingTransactions] = await Promise.all([
      prisma.grower.findMany({
        where: { fabricId: { in: growerFabricIds } },
        select: { id: true, fabricId: true, name: true },
      }),
      prisma.fabricRelation.findMany({
        where: { fabricId: { in: growerFabricIds } },
        select: { fabricId: true, name: true },
      }),
      prisma.lot.findMany({
        where: { fabricPartId: { in: lotPartIds } },
        select: { id: true, fabricPartId: true, supplierId: true },
      }),
      prisma.transaction.findMany({
        where: { fabricOrdregId: { in: allOrdregIds } },
        select: { id: true, fabricOrdregId: true },
      }),
    ]);

    // Build lookup maps
    const growerMap = new Map<number, string>();
    const existingGrowerMap = new Map<number, { id: string; name: string | null }>();
    for (const g of existingGrowers) {
      if (g.fabricId) {
        existingGrowerMap.set(g.fabricId, { id: g.id, name: g.name });
        growerMap.set(g.fabricId, g.id);
      }
    }

    const nameMap = new Map<number, string>();
    for (const fr of fabricRelations) {
      nameMap.set(fr.fabricId, fr.name);
    }

    const lotMap = new Map<number, { id: string; supplierId: string }>();
    for (const l of lots) {
      if (l.fabricPartId) lotMap.set(l.fabricPartId, { id: l.id, supplierId: l.supplierId });
    }

    const txExistsSet = new Set<number>();
    for (const t of existingTransactions) {
      if (t.fabricOrdregId) txExistsSet.add(t.fabricOrdregId);
    }

    // Phase 2: Upsert growers in bulk
    let growersCreated = 0,
      growersExisting = 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const growerUpdateOps: any[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const growerCreateData: any[] = [];

    for (const [fabricKwekerId, supplierId] of growerPairs) {
      const existing = existingGrowerMap.get(fabricKwekerId);
      if (existing) {
        growersExisting++;
        const frName = nameMap.get(fabricKwekerId);
        if (frName && existing.name !== frName) {
          growerUpdateOps.push(
            prisma.grower.update({
              where: { fabricId: fabricKwekerId },
              data: { name: frName },
            })
          );
        }
      } else {
        growerCreateData.push({
          fabricId: fabricKwekerId,
          supplierId,
          name: nameMap.get(fabricKwekerId) || null,
        });
        growersCreated++;
      }
    }

    for (let i = 0; i < growerUpdateOps.length; i += BATCH_SIZE) {
      await prisma.$transaction(growerUpdateOps.slice(i, i + BATCH_SIZE));
    }

    if (growerCreateData.length > 0) {
      try {
        await prisma.grower.createMany({ data: growerCreateData });
      } catch {
        // Fallback to individual creates (race condition / duplicates)
        for (const data of growerCreateData) {
          try {
            await prisma.grower.create({ data });
          } catch {
            growersCreated--;
          }
        }
      }
      // Fetch new grower IDs
      const newGrowers = await prisma.grower.findMany({
        where: {
          fabricId: {
            in: growerCreateData.map((d: { fabricId: number }) => d.fabricId),
          },
        },
        select: { id: true, fabricId: true },
      });
      for (const g of newGrowers) {
        if (g.fabricId) growerMap.set(g.fabricId, g.id);
      }
    }

    // Phase 3: Build transaction operations
    let txCreated = 0,
      txUpdated = 0,
      txSkipped = 0;
    const affectedLotIds = new Set<string>();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const txUpdateOps: any[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const txCreateData: any[] = [];

    for (const row of orders) {
      const lotInfo = lotMap.get(row.part_id);
      if (!lotInfo) {
        txSkipped++;
        continue;
      }

      const date = new Date(row._datum_key_vertrek);
      if (isNaN(date.getTime())) {
        txSkipped++;
        continue;
      }

      const salesType = row.Verkooptype?.trim() || "Unknown";
      const stems = row.Verkoopvolume ?? 0;
      const amount = row.Afrekenomzet ?? 0;
      const pricePerStem = row["Gem afrekenprijs"] ?? 0;

      if (txExistsSet.has(row.ordreg_id)) {
        txUpdateOps.push(
          prisma.transaction.update({
            where: { fabricOrdregId: row.ordreg_id },
            data: {
              date,
              salesType,
              stems,
              pricePerStem: Math.round(pricePerStem * 10000) / 10000,
              amount: Math.round(amount * 100) / 100,
              fabricGrowerId: row.rel_id_kweker,
            },
          })
        );
        txUpdated++;
      } else {
        txCreateData.push({
          lotId: lotInfo.id,
          fabricOrdregId: row.ordreg_id,
          fabricGrowerId: row.rel_id_kweker,
          date,
          salesType,
          stems,
          pricePerStem: Math.round(pricePerStem * 10000) / 10000,
          amount: Math.round(amount * 100) / 100,
        });
        txCreated++;
      }
      affectedLotIds.add(lotInfo.id);
    }

    // Phase 4: Execute transaction operations in batches
    for (let i = 0; i < txUpdateOps.length; i += BATCH_SIZE) {
      await prisma.$transaction(txUpdateOps.slice(i, i + BATCH_SIZE));
    }

    if (txCreateData.length > 0) {
      try {
        await prisma.transaction.createMany({ data: txCreateData });
      } catch {
        // Fallback to individual creates
        for (const data of txCreateData) {
          try {
            await prisma.transaction.create({ data });
          } catch {
            txSkipped++;
            txCreated--;
          }
        }
      }
    }

    // Phase 5: Recalculate lot aggregates using groupBy (2 queries instead of N)
    let lotsRecalculated = 0;
    if (affectedLotIds.size > 0) {
      const affectedLotIdArr = [...affectedLotIds];

      const [lotAggregates, firstTxPerLot] = await Promise.all([
        prisma.transaction.groupBy({
          by: ["lotId"],
          where: { lotId: { in: affectedLotIdArr } },
          _sum: { stems: true, amount: true },
        }),
        prisma.transaction.findMany({
          where: {
            lotId: { in: affectedLotIdArr },
            fabricGrowerId: { not: null },
          },
          select: { lotId: true, fabricGrowerId: true },
          distinct: ["lotId"],
        }),
      ]);

      const lotGrowerMap = new Map<string, number>();
      for (const tx of firstTxPerLot) {
        if (tx.fabricGrowerId) lotGrowerMap.set(tx.lotId, tx.fabricGrowerId);
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lotUpdateOps: any[] = [];
      for (const agg of lotAggregates) {
        const totalStems = agg._sum.stems ?? 0;
        const totalAmount = Number(agg._sum.amount ?? 0);
        const avgPrice = totalStems > 0 ? totalAmount / totalStems : 0;
        const fabricGrowerId = lotGrowerMap.get(agg.lotId);
        const growerId = fabricGrowerId ? growerMap.get(fabricGrowerId) || null : null;

        lotUpdateOps.push(
          prisma.lot.update({
            where: { id: agg.lotId },
            data: {
              totalStems,
              totalAmount: Math.round(totalAmount * 100) / 100,
              avgPrice: Math.round(avgPrice * 10000) / 10000,
              ...(growerId ? { growerId } : {}),
            },
          })
        );
        lotsRecalculated++;
      }

      for (let i = 0; i < lotUpdateOps.length; i += BATCH_SIZE) {
        await prisma.$transaction(lotUpdateOps.slice(i, i + BATCH_SIZE));
      }
    }

    // Phase 6: Recalculate salessheet totals using groupBy (3 queries instead of 2N)
    let ssRecalculated = 0;
    if (affectedLotIds.size > 0) {
      const affectedLotRecords = await prisma.lot.findMany({
        where: { id: { in: [...affectedLotIds] } },
        select: { salesSheetId: true },
      });
      const affectedSSIds = [...new Set(affectedLotRecords.map((l) => l.salesSheetId).filter(Boolean))] as string[];

      if (affectedSSIds.length > 0) {
        const [ssLotAggs, ssCostAggs] = await Promise.all([
          prisma.lot.groupBy({
            by: ["salesSheetId"],
            where: { salesSheetId: { in: affectedSSIds } },
            _sum: { totalAmount: true },
          }),
          prisma.salesSheetCost.groupBy({
            by: ["salesSheetId"],
            where: { salesSheetId: { in: affectedSSIds } },
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

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ssUpdateOps: any[] = [];
        for (const ssId of affectedSSIds) {
          const totalTurnover = ssLotTotals.get(ssId) ?? 0;
          const totalCosts = ssCostTotals.get(ssId) ?? 0;
          ssUpdateOps.push(
            prisma.salesSheet.update({
              where: { id: ssId },
              data: {
                totalTurnover: Math.round(totalTurnover * 100) / 100,
                totalCosts: Math.round(totalCosts * 100) / 100,
                netResult: Math.round((totalTurnover - totalCosts) * 100) / 100,
              },
            })
          );
          ssRecalculated++;
        }

        for (let i = 0; i < ssUpdateOps.length; i += BATCH_SIZE) {
          await prisma.$transaction(ssUpdateOps.slice(i, i + BATCH_SIZE));
        }
      }
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
