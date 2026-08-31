import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { runImport } from "@/lib/import-batch";
import { resolveWithdrawalScope } from "@/lib/sync/withdrawal";
import { isoDate } from "@/lib/sync/queries/helpers";
import { findJobForBatch, resolveScopedSupplierId } from "@/lib/sync/job-context";

// Vercel kapt een functie zonder dit af op de standaardlimiet; de lots- en
// orders-import over een breed venster halen die niet.
export const maxDuration = 300;

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
  bron_feit_extra: z.string().nullable().optional(),
  reden_id: z.number().nullable().optional(),
});

type Order = z.infer<typeof orderSchema>;

const orderKeys = Object.keys(orderSchema.shape);

const orderAliases = {
  // Warehouse columns in marts.fct_orders that carry a different name.
  // Afrekenomzet needs no entry: it has no column of its own (it is aantal x
  // afrekenprijs), so the query has to alias it either way.
  Verkoopvolume: ["vor_aantal"],
  Verkoop_colli: ["vor_colli"],
  "Gem afrekenprijs": ["afrekenprijs_per_steel"],
} as const;

export async function POST(request: NextRequest) {
  return runImport(request, {
    endpoint: "orders",
    bodyKey: "orders",
    rowSchema: orderSchema,
    schemaKeys: orderKeys,
    aliases: orderAliases,
    handler: async (orders, batchId, context) => {
      if (orders.length === 0) return { created: 0, updated: 0, skipped: 0 };
      return upsertOrders(orders, batchId, context.priorRows);
    },
  });
}

async function upsertOrders(orders: Order[], batchId: string | null, priorRows: number) {
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
    if (row.reden_id != null) row.reden_id = Math.round(row.reden_id);
  }

  // Build grower pairs: fabricKwekerId → supplierId
  const growerPairs = new Map<number, string>();
  for (const row of validOrders) {
    if (!growerPairs.has(row.rel_id_kweker)) {
      const supplierId = supplierMap.get(row.rel_id_leverancier);
      if (supplierId) growerPairs.set(row.rel_id_kweker, supplierId);
    }
  }

  // Phase 1: Pre-fetch existing growers, FabricRelations, lots
  const growerFabricIds = [...growerPairs.keys()];
  const lotPartIds = [...new Set(validOrders.map((o) => o.part_id))];

  const [existingGrowers, fabricRelations, lots] = await Promise.all([
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
      // Bewust géén lastImportBatchId: elke import stempelt alleen het model
      // waar hij verantwoordelijk voor is. Deze kweker is een bijproduct — hij
      // wordt aangemaakt om de orderregel niet te hoeven weggooien. Stempelen we
      // hem wel, dan pikt deze ronde de herkomst in van de growers-ronde die tien
      // seconden eerder liep, en meldt die er drie terwijl er nog één zijn id draagt.
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

  // Phase 3: Collect all transaction data per lot
  let txSkipped = 0;
  /** Per Fabric-relatie hoeveel orderregels hun partij tegenspraken. */
  const mismatchByRelId = new Map<number, number>();
  /*
   * Partijen die deze ronde niet mag opruimen. Een overgeslagen rij wordt niet
   * teruggeschreven, dus zonder deze uitzondering zou de vensterbrede opruiming
   * hem aanzien voor een intrekking en de bestaande omzet weggooien — terwijl er
   * juist iets aan de hand is dat we níét konden verwerken.
   */
  const keepLotIds = new Set<string>();
  const affectedLotIds = new Set<string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const txDataByLot = new Map<string, any[]>();

  for (const row of validOrders) {
    const lotInfo = lotMap.get(row.part_id);
    if (!lotInfo) {
      txSkipped++;
      continue;
    }

    /*
     * De partij bepaalt van wie de omzet is, en de orderregel moet dat bevestigen.
     *
     * `lotMap` droeg de leverancier van de partij al mee maar deed er niets mee,
     * zodat een orderregel zijn omzet stilzwijgend op de partij van een andere
     * leverancier kon zetten. Vandaag komt dat niet voor — nul van 3.673.261
     * orderregels spreken hun partij tegen (gemeten 26-08-2026) — dus dit kost
     * niets zolang de bron consistent is.
     *
     * Loopt het wél uiteen, dan is de ketenvolgorde uit de pas of Fabric heeft de
     * partij herbestemd naar een relatie die hier geen leverancier is
     * (`supplierMap.get` geeft dan undefined, wat nooit gelijk is aan de
     * leverancier van de partij). Overslaan en melden is dan het enige veilige:
     * de omzet van de één op de partij van de ander schrijven is precies wat
     * niet mag, en de volgende lots-ronde zet de partij alsnog goed.
     */
    const rowSupplierId = supplierMap.get(row.rel_id_leverancier);
    if (rowSupplierId !== lotInfo.supplierId) {
      txSkipped++;
      mismatchByRelId.set(
        row.rel_id_leverancier,
        (mismatchByRelId.get(row.rel_id_leverancier) ?? 0) + 1
      );
      // Deze partij houdt zijn bestaande transacties, ook bij een vensterbrede
      // opruiming. De regel is overgeslagen en wordt dus niet teruggeschreven;
      // zou het venster hem wél wegruimen, dan maakt een conflict dat de
      // volgende lots-ronde oplost onderweg stilletjes omzet leeg.
      keepLotIds.add(lotInfo.id);
      continue;
    }

    const date = new Date(row._datum_key_vertrek);
    if (isNaN(date.getTime())) {
      txSkipped++;
      keepLotIds.add(lotInfo.id);
      continue;
    }

    const salesType = row.Verkooptype?.trim() || "Unknown";
    const stems = row.Verkoopvolume ?? 0;
    const amount = row.Afrekenomzet ?? 0;
    const pricePerStem = row["Gem afrekenprijs"] ?? 0;
    const bronFeitExtra = row.bron_feit_extra?.trim() || "origineel";
    const correctionReasonId = row.reden_id ?? null;

    if (!txDataByLot.has(lotInfo.id)) txDataByLot.set(lotInfo.id, []);
    txDataByLot.get(lotInfo.id)!.push({
      lotId: lotInfo.id,
      fabricOrdregId: row.ordreg_id,
      fabricGrowerId: row.rel_id_kweker,
      date: date.toISOString(),
      salesType,
      stems,
      pricePerStem: Math.round(pricePerStem * 10000) / 10000,
      amount: Math.round(amount * 1000) / 1000,
      bronFeitExtra,
      correctionReasonId,
    });
    affectedLotIds.add(lotInfo.id);
  }

  // Phase 4: Delete+reinsert scoped to fabricOrdregIds in this batch
  // Only delete transactions whose ordregId appears in the batch, preserving
  // older transactions outside Power Automate's rolling query window.
  let txDeleted = 0;
  let txWritten = 0;
  let txWithdrawn = 0;
  let withdrawalMode = "pairs";
  let withdrawalReason: string | null = null;

  if (affectedLotIds.size > 0) {
    // Collect all transaction data for bulk operations
    const allTxData: Record<string, unknown>[] = [];
    for (const txs of txDataByLot.values()) {
      allTxData.push(...txs);
    }

    // Build unique (lotId, fabricOrdregId) pairs for scoped delete
    const deletePairs: { lotId: string; fabricOrdregId: number }[] = [];
    const seenPairs = new Set<string>();
    for (const tx of allTxData) {
      const key = `${tx.lotId}::${tx.fabricOrdregId}`;
      if (!seenPairs.has(key)) {
        seenPairs.add(key);
        deletePairs.push({ lotId: tx.lotId as string, fabricOrdregId: tx.fabricOrdregId as number });
      }
    }

    /*
     * Phase 4a: opruimen wat Fabric heeft ingetrokken.
     *
     * De paar-delete hieronder raakt alleen ordregels die de payload noemt, dus
     * een orderregel die het warehouse laat vallen bleef eeuwig staan. Binnen het
     * venster van een sync-job is de payload compleet, en mag alles wat daar niet
     * in zit dus weg. resolveWithdrawalScope bewaakt wanneer dat vaststaat.
     *
     * Dit vangt óók de partij waarvan álle regels zijn ingetrokken: die staat
     * niet in affectedLotIds en zou langs de paar-delete heen glippen. Vandaar
     * dat de verwijderde partijen hieronder alsnog in affectedLotIds komen, zodat
     * fase 5 en 6 hun totalen herrekenen.
     */
    const job = await findJobForBatch(batchId);
    const scope = resolveWithdrawalScope({
      job,
      supplierId: await resolveScopedSupplierId(job?.supplierFabricId ?? null),
      payloadRows: orders.length,
      priorRows,
    });
    withdrawalMode = scope.mode;
    if (scope.mode === "pairs") withdrawalReason = scope.reason;

    if (scope.mode === "window") {
      const withdrawn = await prisma.$queryRawUnsafe<{ lotId: string }[]>(
        `WITH payload AS (
           SELECT DISTINCT
             v.val->>'lotId' AS lot_id,
             (v.val->>'fabricOrdregId')::int AS ordreg_id
           FROM jsonb_array_elements($1::jsonb) AS v(val)
         )
         DELETE FROM "Transaction" t
         USING "Lot" l
         WHERE t."lotId" = l.id
           AND t.date >= $2::timestamp
           AND t.date <  $3::timestamp
           AND ($4::text IS NULL OR l."supplierId" = $4::text)
           AND NOT (t."lotId" = ANY($5::text[]))
           AND NOT EXISTS (
             SELECT 1 FROM payload p
             WHERE p.lot_id = t."lotId" AND p.ordreg_id = t."fabricOrdregId"
           )
         RETURNING t."lotId" AS "lotId"`,
        JSON.stringify(deletePairs),
        // Dezelfde UTC-dagrand als de vraag aan Fabric (`isoDate`), zodat de
        // opruiming exact het venster dekt dat is uitgevraagd — niet meer.
        isoDate(scope.from),
        isoDate(scope.to),
        scope.supplierId,
        [...keepLotIds]
      );
      txWithdrawn = withdrawn.length;
      for (const row of withdrawn) affectedLotIds.add(row.lotId);
    }

    // Delete only transactions matching (lotId, fabricOrdregId) pairs from this batch
    if (deletePairs.length > 0) {
      const CHUNK_SIZE = 5000;
      for (let i = 0; i < deletePairs.length; i += CHUNK_SIZE) {
        const chunk = deletePairs.slice(i, i + CHUNK_SIZE);
        const deleted = await prisma.$executeRawUnsafe(
          `DELETE FROM "Transaction" t
           USING (
             SELECT DISTINCT
               v.val->>'lotId' AS lot_id,
               (v.val->>'fabricOrdregId')::int AS ordreg_id
             FROM jsonb_array_elements($1::jsonb) AS v(val)
           ) AS batch
           WHERE t."lotId" = batch.lot_id
             AND t."fabricOrdregId" = batch.ordreg_id`,
          JSON.stringify(chunk)
        );
        txDeleted += deleted;
      }
    }

    // Insert all transactions from batch
    if (allTxData.length > 0) {
      const CHUNK_SIZE = 5000;
      for (let i = 0; i < allTxData.length; i += CHUNK_SIZE) {
        const chunk = allTxData.slice(i, i + CHUNK_SIZE);
        await prisma.$executeRawUnsafe(
          `INSERT INTO "Transaction" (
             id, "lotId", "fabricOrdregId", "fabricGrowerId",
             date, "salesType", stems, "pricePerStem", amount,
             "bronFeitExtra", "correctionReasonId", "lastImportBatchId",
             "createdAt", "updatedAt"
           )
           SELECT
             gen_random_uuid()::text,
             v.val->>'lotId',
             (v.val->>'fabricOrdregId')::int,
             (v.val->>'fabricGrowerId')::int,
             (v.val->>'date')::timestamp,
             v.val->>'salesType',
             COALESCE((v.val->>'stems')::int, 0),
             COALESCE((v.val->>'pricePerStem')::numeric, 0),
             COALESCE((v.val->>'amount')::numeric, 0),
             COALESCE(v.val->>'bronFeitExtra', 'origineel'),
             (v.val->>'correctionReasonId')::int,
             $2,
             NOW(),
             NOW()
           FROM jsonb_array_elements($1::jsonb) AS v(val)`,
          JSON.stringify(chunk),
          batchId
        );
      }
      txWritten = allTxData.length;
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
         WHERE "lotId" IN (SELECT jsonb_array_elements_text($1::jsonb))
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
        JSON.stringify(affectedSSIds)
      );
    }
  }

  // Deze import schrijft opnieuw weg wat hij verwijderde, dus het aantal
  // ingevoegde rijen is niet het aantal nieuwe orderregels — dat was het wel in
  // de kolom "created" van het importscherm, en dan lijkt een ronde over een
  // smal venster duizenden regels te vinden die de vorige ronde gemist zou
  // hebben. Wat er stond en teruggezet is, is een wijziging; wat er niet stond,
  // is nieuw. Meer dan geschreven verwijderd betekent dat een orderregel is
  // opgesplitst of samengevoegd: dan is er niets nieuws, alleen minder rijen.
  const txUpdated = Math.min(txWritten, txDeleted);
  const txCreated = txWritten - txUpdated;

  return {
    created: txCreated,
    updated: txUpdated,
    skipped: txSkipped + skippedNoOrdregId,
    details: {
      growers: { created: growersCreated, existing: growersExisting },
      recalculated: { lots: lotsRecalculated, salesSheets: ssRecalculated },
      skippedNoOrdregId,
      txWritten,
      txDeleted,
      // Alleen aanwezig als er iets is ingetrokken. Dit is geen wijziging maar
      // een verdwijning: omzet die de portal liet zien en die er niet was.
      ...(txWithdrawn > 0 ? { txWithdrawn } : {}),
      // Waarom er níét vensterbreed is opgeruimd. Zonder dit is het verschil
      // tussen "niets ingetrokken" en "niet gekeken" onzichtbaar.
      ...(withdrawalReason ? { withdrawalSkipped: withdrawalReason } : {}),
      // Alleen aanwezig als er iets te melden is, zodat de aanwezigheid van de
      // sleutel zelf het signaal is.
      ...(mismatchByRelId.size > 0
        ? { supplierMismatch: Object.fromEntries(mismatchByRelId) }
        : {}),
    },
    extra: {
      valid: validOrders.length,
      skippedNoOrdregId,
      growers: { created: growersCreated, existing: growersExisting },
      transactions: {
        created: txCreated,
        updated: txUpdated,
        written: txWritten,
        deleted: txDeleted,
        withdrawn: txWithdrawn,
        skipped: txSkipped,
      },
      withdrawal: { mode: withdrawalMode, ...(withdrawalReason ? { reason: withdrawalReason } : {}) },
      recalculated: { lots: lotsRecalculated, salesSheets: ssRecalculated },
    },
  };
}
