import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireImportAuth, stripBracketKeys } from "@/lib/import-auth";

const orderSchema = z.object({
  ordreg_id: z.number().nullable().optional(),
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

    // Filter out rows without ordreg_id (zero-volume DAX rows with BLANK ordreg_id)
    const validOrders = orders.filter((o) => o.ordreg_id != null);
    const skippedNoOrdregId = orders.length - validOrders.length;

    // Round IDs (DAX/Power Automate can send 1.0 instead of 1)
    for (const row of validOrders) {
      row.ordreg_id = Math.round(row.ordreg_id!);
      row.part_id = Math.round(row.part_id);
      row.parthdr_id = Math.round(row.parthdr_id);
      row.rel_id_kweker = Math.round(row.rel_id_kweker);
      row.rel_id_leverancier = Math.round(row.rel_id_leverancier);
    }

    // Build grower pairs: fabricKwekerId → supplierId
    const growerPairs = new Map<number, string>();
    for (const row of validOrders) {
      if (!growerPairs.has(row.rel_id_kweker)) {
        const supplierId = supplierMap.get(row.rel_id_leverancier);
        if (supplierId) growerPairs.set(row.rel_id_kweker, supplierId);
      }
    }

    // Phase 1: Pre-fetch existing growers, FabricRelations, lots, transactions in parallel
    const growerFabricIds = [...growerPairs.keys()];
    const lotPartIds = [...new Set(validOrders.map((o) => o.part_id))];
    const allOrdregIds = validOrders.map((o) => o.ordreg_id as number);

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

    // Phase 2: Upsert growers
    let growersCreated = 0,
      growersExisting = 0;

    const growerUpdateData: { fabricId: number; name: string }[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const growerCreateData: any[] = [];

    for (const [fabricKwekerId, supplierId] of growerPairs) {
      const existing = existingGrowerMap.get(fabricKwekerId);
      if (existing) {
        growersExisting++;
        const frName = nameMap.get(fabricKwekerId);
        if (frName && existing.name !== frName) {
          growerUpdateData.push({ fabricId: fabricKwekerId, name: frName });
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

    if (growerUpdateData.length > 0) {
      await prisma.$executeRawUnsafe(
        `UPDATE "Grower" AS t
         SET
           name = u.val->>'name',
           "updatedAt" = NOW()
         FROM jsonb_array_elements($1::jsonb) AS u(val)
         WHERE t."fabricId" = (u.val->>'fabricId')::int`,
        JSON.stringify(growerUpdateData)
      );
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

    // Deduplicate updates by ordreg_id (last one wins, avoids non-deterministic UPDATE...FROM)
    const txUpdateMap = new Map<number, {
      fabricOrdregId: number;
      date: string;
      salesType: string;
      stems: number;
      pricePerStem: number;
      amount: number;
      fabricGrowerId: number;
    }>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const txCreateData: any[] = [];

    for (const row of validOrders) {
      const ordregId = row.ordreg_id as number;
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

      if (txExistsSet.has(ordregId)) {
        txUpdateMap.set(ordregId, {
          fabricOrdregId: ordregId,
          date: date.toISOString(),
          salesType,
          stems,
          pricePerStem: Math.round(pricePerStem * 10000) / 10000,
          amount: Math.round(amount * 100) / 100,
          fabricGrowerId: row.rel_id_kweker,
        });
        txUpdated++;
      } else {
        txCreateData.push({
          lotId: lotInfo.id,
          fabricOrdregId: ordregId,
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

    // Phase 4: Execute transaction operations
    const txUpdateData = [...txUpdateMap.values()];
    if (txUpdateData.length > 0) {
      await prisma.$executeRawUnsafe(
        `UPDATE "Transaction" AS t
         SET
           date = (u.val->>'date')::timestamp,
           "salesType" = u.val->>'salesType',
           stems = (u.val->>'stems')::int,
           "pricePerStem" = (u.val->>'pricePerStem')::numeric,
           amount = (u.val->>'amount')::numeric,
           "fabricGrowerId" = (u.val->>'fabricGrowerId')::int,
           "updatedAt" = NOW()
         FROM jsonb_array_elements($1::jsonb) AS u(val)
         WHERE t."fabricOrdregId" = (u.val->>'fabricOrdregId')::int`,
        JSON.stringify(txUpdateData)
      );
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

    // Phase 5: Recalculate lot aggregates via single raw SQL
    let lotsRecalculated = 0;
    if (affectedLotIds.size > 0) {
      const affectedLotIdArr = [...affectedLotIds];

      // Single SQL: aggregate transactions + update lots + assign grower via JOIN
      lotsRecalculated = await prisma.$executeRawUnsafe(
        `UPDATE "Lot" AS l
         SET
           "totalStems" = COALESCE(agg.total_stems, 0),
           "totalAmount" = ROUND(COALESCE(agg.total_amount, 0)::numeric, 2),
           "avgPrice" = CASE WHEN COALESCE(agg.total_stems, 0) > 0
             THEN ROUND((COALESCE(agg.total_amount, 0) / agg.total_stems)::numeric, 4)
             ELSE 0 END,
           "growerId" = COALESCE(g.id, l."growerId"),
           "updatedAt" = NOW()
         FROM (
           SELECT
             "lotId",
             SUM(stems)::int as total_stems,
             SUM(amount) as total_amount,
             MIN("fabricGrowerId") FILTER (WHERE "fabricGrowerId" IS NOT NULL) as fabric_grower_id
           FROM "Transaction"
           WHERE "lotId" IN (SELECT jsonb_array_elements_text($1::jsonb)::uuid)
           GROUP BY "lotId"
         ) AS agg
         LEFT JOIN "Grower" g ON g."fabricId" = agg.fabric_grower_id
         WHERE l.id = agg."lotId"`,
        JSON.stringify(affectedLotIdArr)
      );
    }

    // Phase 6: Recalculate salessheet totals via single raw SQL
    let ssRecalculated = 0;
    if (affectedLotIds.size > 0) {
      const affectedLotRecords = await prisma.lot.findMany({
        where: { id: { in: [...affectedLotIds] } },
        select: { salesSheetId: true },
      });
      const affectedSSIds = [...new Set(affectedLotRecords.map((l) => l.salesSheetId).filter(Boolean))] as string[];

      if (affectedSSIds.length > 0) {
        ssRecalculated = await prisma.$executeRawUnsafe(
          `WITH ss_ids AS (
             SELECT jsonb_array_elements_text($1::jsonb) AS id
           ),
           lot_totals AS (
             SELECT "salesSheetId", SUM("totalAmount") as total
             FROM "Lot"
             WHERE "salesSheetId" IN (SELECT id::uuid FROM ss_ids)
             GROUP BY "salesSheetId"
           ),
           cost_totals AS (
             SELECT "salesSheetId", SUM(amount) as total
             FROM "SalesSheetCost"
             WHERE "salesSheetId" IN (SELECT id::uuid FROM ss_ids)
             GROUP BY "salesSheetId"
           )
           UPDATE "SalesSheet" AS ss
           SET
             "totalTurnover" = ROUND(COALESCE(lt.total, 0)::numeric, 2),
             "totalCosts" = ROUND(COALESCE(ct.total, 0)::numeric, 2),
             "netResult" = ROUND((COALESCE(lt.total, 0) - COALESCE(ct.total, 0))::numeric, 2),
             "updatedAt" = NOW()
           FROM ss_ids
           LEFT JOIN lot_totals lt ON lt."salesSheetId" = ss_ids.id::uuid
           LEFT JOIN cost_totals ct ON ct."salesSheetId" = ss_ids.id::uuid
           WHERE ss.id = ss_ids.id::uuid`,
          JSON.stringify(affectedSSIds)
        );
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
            recordsSkipped: txSkipped + skippedNoOrdregId,
            durationMs: Date.now() - startTime,
            completedAt: new Date(),
            details: {
              growers: { created: growersCreated, existing: growersExisting },
              recalculated: { lots: lotsRecalculated, salesSheets: ssRecalculated },
              skippedNoOrdregId,
            },
          },
        });
      } catch {
        // Batch logging should not block the import
      }
    }

    return NextResponse.json({
      received: orders.length,
      valid: validOrders.length,
      skippedNoOrdregId,
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
