import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireImportAuth, stripBracketKeys } from "@/lib/import-auth";

const partijSchema = z.object({
  part_id: z.number(),
  parthdr_id: z.number(),
  rel_id_leverancier: z.number(),
  Partijnummer: z.union([z.string(), z.number()]),
  "Inkoop Factuur Nummer": z.string().nullable().optional(),
  "Lever Datum/Tijd": z.string().nullable().optional(),
  "Artikel Naam": z.string().nullable().optional(),
  "Artikel Code": z.string().nullable().optional(),
  "Inkooptype Code": z.string().nullable().optional(),
  S01: z.string().nullable().optional(),
  S02: z.string().nullable().optional(),
  S03: z.string().nullable().optional(),
  art_id: z.number().nullable().optional(),
  reden_id_correctie: z.number().nullable().optional(),
  "Inkoopfactuur colli": z.number().nullable().optional(),
  "Inkoopfactuur volume": z.number().nullable().optional(),
  "Inslagcorrectie volume": z.number().nullable().optional(),
  "Facttype Sub": z.string().nullable().optional(),
});

const bodySchema = z.object({
  partijen: z.array(partijSchema),
});

/** Classify a Facttype Sub value into base lot or correction */
function isCorrection(facttypeSub: string | null | undefined): boolean {
  if (!facttypeSub) return false;
  const lower = facttypeSub.toLowerCase().trim();
  return lower === "correctie" || lower === "productiecorrectie";
}

function deriveArticleGroup(productName: string): string {
  if (!productName) return "Unknown";
  return productName.trim().split(/\s+/)[0] || "Unknown";
}

export async function POST(request: NextRequest) {
  const authError = requireImportAuth(request);
  if (authError) return authError;

  const startTime = Date.now();
  let batch: { id: string } | null = null;
  try {
    batch = await prisma.importBatch.create({
      data: { endpoint: "lots", status: "running" },
    });
  } catch {
    // Batch logging should not block the import
  }

  const body = await request.json();
  if (body.partijen) body.partijen = stripBracketKeys(body.partijen);
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
    const { partijen } = parsed.data;

    if (partijen.length === 0) {
      if (batch) {
        try {
          await prisma.importBatch.update({
            where: { id: batch.id },
            data: { status: "success", recordsReceived: 0, durationMs: Date.now() - startTime, completedAt: new Date() },
          });
        } catch { /* */ }
      }
      return NextResponse.json({ received: 0, salesSheets: { created: 0, updated: 0 }, lots: { created: 0, updated: 0 }, skipped: 0 });
    }

    // Round IDs (DAX/Power Automate can send 1.0 instead of 1)
    for (const row of partijen) {
      row.part_id = Math.round(row.part_id);
      row.parthdr_id = Math.round(row.parthdr_id);
      row.rel_id_leverancier = Math.round(row.rel_id_leverancier);
      if (row.art_id) row.art_id = Math.round(row.art_id);
      if (row.reden_id_correctie) row.reden_id_correctie = Math.round(row.reden_id_correctie);
    }

    // Split rows by Facttype Sub: base rows vs correction rows
    const baseRows = partijen.filter((r) => !isCorrection(r["Facttype Sub"]));
    const correctionRows = partijen.filter((r) => isCorrection(r["Facttype Sub"]));

    // Group by parthdr_id
    const byParthdr = new Map<number, typeof partijen>();
    for (const row of baseRows) {
      if (!byParthdr.has(row.parthdr_id)) byParthdr.set(row.parthdr_id, []);
      byParthdr.get(row.parthdr_id)!.push(row);
    }

    const allParthdrIds = [...byParthdr.keys()];
    const allPartIds = baseRows.map((p) => p.part_id);

    // Phase 1: Pre-fetch all existing data in parallel (3 queries)
    const [suppliers, existingSalesSheets, existingLots] = await Promise.all([
      prisma.supplier.findMany({
        where: { fabricId: { not: null } },
        select: { id: true, fabricId: true },
      }),
      prisma.salesSheet.findMany({
        where: { fabricParthdrId: { in: allParthdrIds } },
        select: { id: true, fabricParthdrId: true },
      }),
      prisma.lot.findMany({
        where: { fabricPartId: { in: allPartIds } },
        select: { id: true, fabricPartId: true },
      }),
    ]);

    const supplierMap = new Map<number, string>();
    for (const s of suppliers) {
      if (s.fabricId) supplierMap.set(s.fabricId, s.id);
    }

    const ssMap = new Map<number, string>();
    for (const ss of existingSalesSheets) {
      if (ss.fabricParthdrId) ssMap.set(ss.fabricParthdrId, ss.id);
    }

    const lotExistsSet = new Set<number>();
    for (const l of existingLots) {
      if (l.fabricPartId) lotExistsSet.add(l.fabricPartId);
    }

    // Phase 2: Collect potential invoice numbers for new salessheets and check collisions
    const newSsInvoiceNumbers: string[] = [];
    for (const [parthdrId, rows] of byParthdr) {
      if (ssMap.has(parthdrId)) continue;
      const supplierId = supplierMap.get(rows[0].rel_id_leverancier);
      if (!supplierId) continue;
      let inv = rows[0]["Inkoop Factuur Nummer"]?.trim() || null;
      if (!inv || ["", "xxx", "volgt", "test", "restpartijen"].includes(inv)) {
        inv = `FABRIC-${parthdrId}`;
      }
      newSsInvoiceNumbers.push(inv);
    }

    const existingInvoices =
      newSsInvoiceNumbers.length > 0
        ? await prisma.salesSheet.findMany({
            where: { invoiceNumber: { in: newSsInvoiceNumbers } },
            select: { invoiceNumber: true },
          })
        : [];
    const usedInvoiceNumbers = new Set(existingInvoices.map((inv) => inv.invoiceNumber));

    // Phase 3: Build salessheet operations
    let ssCreated = 0,
      ssUpdated = 0;
    let lotCreated = 0,
      lotUpdated = 0;
    let skipped = 0;

    const ssUpdateData: { fabricParthdrId: number; deliveryDate: string }[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ssCreateData: any[] = [];

    for (const [parthdrId, rows] of byParthdr) {
      const firstRow = rows[0];
      const supplierId = supplierMap.get(firstRow.rel_id_leverancier);
      if (!supplierId) {
        skipped += rows.length;
        continue;
      }

      const deliveryDate = firstRow["Lever Datum/Tijd"]
        ? new Date(firstRow["Lever Datum/Tijd"])
        : new Date();

      if (ssMap.has(parthdrId)) {
        ssUpdateData.push({
          fabricParthdrId: parthdrId,
          deliveryDate: deliveryDate.toISOString(),
        });
        ssUpdated++;
      } else {
        let invoiceNumber = firstRow["Inkoop Factuur Nummer"]?.trim() || null;
        if (
          !invoiceNumber ||
          ["", "xxx", "volgt", "test", "restpartijen"].includes(invoiceNumber)
        ) {
          invoiceNumber = `FABRIC-${parthdrId}`;
        }
        if (usedInvoiceNumbers.has(invoiceNumber)) {
          invoiceNumber = `${invoiceNumber}-${parthdrId}`;
        }
        usedInvoiceNumbers.add(invoiceNumber);

        ssCreateData.push({
          invoiceNumber,
          fabricParthdrId: parthdrId,
          supplierId,
          invoiceDate: deliveryDate,
          deliveryDate,
          totalTurnover: 0,
          totalCosts: 0,
          netResult: 0,
        });
        ssCreated++;
      }
    }

    // Phase 4: Execute salessheet operations
    if (ssUpdateData.length > 0) {
      await prisma.$executeRawUnsafe(
        `UPDATE "SalesSheet" AS t
         SET
           "deliveryDate" = (u.val->>'deliveryDate')::timestamp,
           "updatedAt" = NOW()
         FROM jsonb_array_elements($1::jsonb) AS u(val)
         WHERE t."fabricParthdrId" = (u.val->>'fabricParthdrId')::int`,
        JSON.stringify(ssUpdateData)
      );
    }

    if (ssCreateData.length > 0) {
      // Use raw SQL INSERT ... ON CONFLICT for bulk upsert + RETURNING to get IDs
      const ssJsonData = ssCreateData.map((d: Record<string, unknown>) => ({
        invoiceNumber: d.invoiceNumber,
        fabricParthdrId: d.fabricParthdrId,
        supplierId: d.supplierId,
        invoiceDate: d.invoiceDate instanceof Date ? d.invoiceDate.toISOString() : d.invoiceDate,
        deliveryDate: d.deliveryDate instanceof Date ? d.deliveryDate.toISOString() : d.deliveryDate,
        totalTurnover: d.totalTurnover ?? 0,
        totalCosts: d.totalCosts ?? 0,
        netResult: d.netResult ?? 0,
      }));

      // Insert with ON CONFLICT on fabricParthdrId (unique)
      await prisma.$executeRawUnsafe(
        `INSERT INTO "SalesSheet" (
           id, "invoiceNumber", "fabricParthdrId", "supplierId",
           "invoiceDate", "deliveryDate", "totalTurnover", "totalCosts", "netResult",
           "createdAt", "updatedAt"
         )
         SELECT
           gen_random_uuid()::text,
           v.val->>'invoiceNumber',
           (v.val->>'fabricParthdrId')::int,
           v.val->>'supplierId',
           (v.val->>'invoiceDate')::timestamp,
           (v.val->>'deliveryDate')::timestamp,
           COALESCE((v.val->>'totalTurnover')::numeric, 0),
           COALESCE((v.val->>'totalCosts')::numeric, 0),
           COALESCE((v.val->>'netResult')::numeric, 0),
           NOW(),
           NOW()
         FROM jsonb_array_elements($1::jsonb) AS v(val)
         ON CONFLICT ("fabricParthdrId") DO UPDATE SET
           "deliveryDate" = EXCLUDED."deliveryDate",
           "updatedAt" = NOW()`,
        JSON.stringify(ssJsonData)
      );

      // Fetch all salessheet IDs (both new and existing) for lot creation
      const newSalesSheets = await prisma.salesSheet.findMany({
        where: {
          fabricParthdrId: {
            in: ssCreateData.map((d: { fabricParthdrId: number }) => d.fabricParthdrId),
          },
        },
        select: { id: true, fabricParthdrId: true },
      });
      for (const ss of newSalesSheets) {
        if (ss.fabricParthdrId) ssMap.set(ss.fabricParthdrId, ss.id);
      }
    }

    // Phase 5: Build lot operations
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lotUpdateData: any[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lotCreateData: any[] = [];

    for (const [parthdrId, rows] of byParthdr) {
      const firstRow = rows[0];
      const supplierId = supplierMap.get(firstRow.rel_id_leverancier);
      if (!supplierId) continue;

      const salesSheetId = ssMap.get(parthdrId);
      if (!salesSheetId) continue;

      const deliveryDate = firstRow["Lever Datum/Tijd"]
        ? new Date(firstRow["Lever Datum/Tijd"])
        : new Date();

      for (const row of rows) {
        const lotNumber = String(row.Partijnummer).trim();
        if (!lotNumber) {
          skipped++;
          continue;
        }

        const productName = row["Artikel Naam"]?.trim() || "Unknown";
        const stemLength = row.S01 ? parseInt(row.S01, 10) || 0 : 0;

        if (lotExistsSet.has(row.part_id)) {
          lotUpdateData.push({
            fabricPartId: row.part_id,
            lotNumber,
            productName,
            articleGroup: deriveArticleGroup(productName),
            articleCode: row["Artikel Code"] || null,
            purchaseType: row["Inkooptype Code"] || null,
            s1: row.S01 || null,
            s2: row.S02 || null,
            s3: row.S03 || null,
            invoicedColli: row["Inkoopfactuur colli"] ?? null,
            invoicedVolume: row["Inkoopfactuur volume"] ?? null,
            correctionVolume: row["Inslagcorrectie volume"] ?? null,
          });
          lotUpdated++;
        } else {
          lotCreateData.push({
            lotNumber,
            refNumber: lotNumber,
            fabricPartId: row.part_id,
            fabricParthdrId: parthdrId,
            supplierId,
            salesSheetId,
            articleCode: row["Artikel Code"] || null,
            productName,
            articleGroup: deriveArticleGroup(productName),
            purchaseType: row["Inkooptype Code"] || null,
            fabricArticleId: row.art_id || null,
            colli: row["Inkoopfactuur colli"] || 0,
            stemLength,
            totalStems: row["Inkoopfactuur volume"] || 0,
            avgPrice: 0,
            totalAmount: 0,
            deliveryDate,
            status: "sold",
            s1: row.S01 || null,
            s2: row.S02 || null,
            s3: row.S03 || null,
            invoicedColli: row["Inkoopfactuur colli"] || null,
            invoicedVolume: row["Inkoopfactuur volume"] || null,
            correctionVolume: row["Inslagcorrectie volume"] || null,
          });
          lotCreated++;
        }
      }
    }

    // Phase 6: Execute lot operations — deduplicate updates by fabricPartId
    if (lotUpdateData.length > 0) {
      const updateDedupMap = new Map<number, (typeof lotUpdateData)[0]>();
      for (const d of lotUpdateData) {
        updateDedupMap.set(d.fabricPartId, d);
      }
      const dedupCount = lotUpdateData.length - updateDedupMap.size;
      if (dedupCount > 0) {
        lotUpdated -= dedupCount;
        skipped += dedupCount;
      }
      // Replace with deduped array
      lotUpdateData.length = 0;
      lotUpdateData.push(...updateDedupMap.values());
    }
    if (lotUpdateData.length > 0) {
      await prisma.$executeRawUnsafe(
        `UPDATE "Lot" AS t
         SET
           "lotNumber" = u.val->>'lotNumber',
           "productName" = u.val->>'productName',
           "articleGroup" = u.val->>'articleGroup',
           "articleCode" = u.val->>'articleCode',
           "purchaseType" = u.val->>'purchaseType',
           s1 = u.val->>'s1',
           s2 = u.val->>'s2',
           s3 = u.val->>'s3',
           "invoicedColli" = (u.val->>'invoicedColli')::int,
           "invoicedVolume" = (u.val->>'invoicedVolume')::int,
           "correctionVolume" = (u.val->>'correctionVolume')::int,
           "updatedAt" = NOW()
         FROM jsonb_array_elements($1::jsonb) AS u(val)
         WHERE t."fabricPartId" = (u.val->>'fabricPartId')::int`,
        JSON.stringify(lotUpdateData)
      );
    }

    if (lotCreateData.length > 0) {
      // Deduplicate by fabricPartId — PostgreSQL INSERT ON CONFLICT cannot affect the same row twice
      const dedupMap = new Map<number, Record<string, unknown>>();
      for (const d of lotCreateData) {
        dedupMap.set(d.fabricPartId as number, d);
      }
      const dedupedCreateData = [...dedupMap.values()];
      const dupCount = lotCreateData.length - dedupedCreateData.length;
      if (dupCount > 0) {
        lotCreated -= dupCount;
        skipped += dupCount;
      }

      const lotJsonData = dedupedCreateData.map((d: Record<string, unknown>) => ({
        lotNumber: d.lotNumber,
        refNumber: d.refNumber,
        fabricPartId: d.fabricPartId,
        fabricParthdrId: d.fabricParthdrId,
        supplierId: d.supplierId,
        salesSheetId: d.salesSheetId,
        articleCode: d.articleCode,
        productName: d.productName,
        articleGroup: d.articleGroup,
        purchaseType: d.purchaseType,
        fabricArticleId: d.fabricArticleId,
        colli: d.colli ?? 0,
        stemLength: d.stemLength ?? 0,
        totalStems: d.totalStems ?? 0,
        avgPrice: d.avgPrice ?? 0,
        totalAmount: d.totalAmount ?? 0,
        deliveryDate: d.deliveryDate instanceof Date ? d.deliveryDate.toISOString() : d.deliveryDate,
        status: d.status ?? "sold",
        s1: d.s1,
        s2: d.s2,
        s3: d.s3,
        invoicedColli: d.invoicedColli,
        invoicedVolume: d.invoicedVolume,
        correctionVolume: d.correctionVolume,
      }));

      const insertResult = await prisma.$executeRawUnsafe(
        `INSERT INTO "Lot" (
           id, "lotNumber", "refNumber", "fabricPartId", "fabricParthdrId",
           "supplierId", "salesSheetId", "articleCode", "productName", "articleGroup",
           "purchaseType", "fabricArticleId", colli, "stemLength", "totalStems",
           "avgPrice", "totalAmount", "deliveryDate", status,
           s1, s2, s3, "invoicedColli", "invoicedVolume", "correctionVolume",
           "createdAt", "updatedAt"
         )
         SELECT
           gen_random_uuid()::text,
           v.val->>'lotNumber',
           v.val->>'refNumber',
           (v.val->>'fabricPartId')::int,
           (v.val->>'fabricParthdrId')::int,
           v.val->>'supplierId',
           v.val->>'salesSheetId',
           v.val->>'articleCode',
           v.val->>'productName',
           v.val->>'articleGroup',
           v.val->>'purchaseType',
           (v.val->>'fabricArticleId')::int,
           COALESCE((v.val->>'colli')::int, 0),
           COALESCE((v.val->>'stemLength')::int, 0),
           COALESCE((v.val->>'totalStems')::int, 0),
           COALESCE((v.val->>'avgPrice')::numeric, 0),
           COALESCE((v.val->>'totalAmount')::numeric, 0),
           (v.val->>'deliveryDate')::timestamp,
           COALESCE(v.val->>'status', 'sold'),
           v.val->>'s1',
           v.val->>'s2',
           v.val->>'s3',
           (v.val->>'invoicedColli')::int,
           (v.val->>'invoicedVolume')::int,
           (v.val->>'correctionVolume')::int,
           NOW(),
           NOW()
         FROM jsonb_array_elements($1::jsonb) AS v(val)
         ON CONFLICT ("fabricPartId") DO UPDATE SET
           "lotNumber" = EXCLUDED."lotNumber",
           "productName" = EXCLUDED."productName",
           "articleGroup" = EXCLUDED."articleGroup",
           "articleCode" = EXCLUDED."articleCode",
           "purchaseType" = EXCLUDED."purchaseType",
           s1 = EXCLUDED.s1,
           s2 = EXCLUDED.s2,
           s3 = EXCLUDED.s3,
           "invoicedColli" = EXCLUDED."invoicedColli",
           "invoicedVolume" = EXCLUDED."invoicedVolume",
           "correctionVolume" = EXCLUDED."correctionVolume",
           "updatedAt" = NOW()`,
        JSON.stringify(lotJsonData)
      );
      // insertResult = number of rows affected (inserts + updates)
      // Adjust counts: if some were actually updates (ON CONFLICT), our lotCreated count is too high
      const actualAffected = Number(insertResult);
      if (actualAffected < lotCreateData.length) {
        const diff = lotCreateData.length - actualAffected;
        lotCreated -= diff;
        skipped += diff;
      }
    }

    // Phase 7: Process correction rows → LotCorrection records
    let correctionsCreated = 0;
    let correctionsUpdated = 0;
    let correctionsSkipped = 0;

    if (correctionRows.length > 0) {
      // Find parent lots for correction rows by lotNumber + supplier
      const corrLotNumbers = [...new Set(correctionRows.map((r) => String(r.Partijnummer).trim()))];
      const corrSupplierFabricIds = [...new Set(correctionRows.map((r) => r.rel_id_leverancier))];
      const corrSupplierIds = corrSupplierFabricIds
        .map((fid) => supplierMap.get(fid))
        .filter(Boolean) as string[];

      const parentLots = corrSupplierIds.length > 0 && corrLotNumbers.length > 0
        ? await prisma.lot.findMany({
            where: {
              lotNumber: { in: corrLotNumbers },
              supplierId: { in: corrSupplierIds },
            },
            select: { id: true, lotNumber: true, supplierId: true },
          })
        : [];

      // Build lookup: "lotNumber::supplierId" → lot.id
      const lotLookup = new Map<string, string>();
      for (const lot of parentLots) {
        lotLookup.set(`${lot.lotNumber}::${lot.supplierId}`, lot.id);
      }

      // Check which corrections already exist
      const corrFabricPartIds = correctionRows.map((r) => r.part_id);
      const existingCorrections = await prisma.lotCorrection.findMany({
        where: { fabricPartId: { in: corrFabricPartIds } },
        select: { fabricPartId: true },
      });
      const existingCorrSet = new Set(existingCorrections.map((c) => c.fabricPartId));

      // Deduplicate correction rows by fabricPartId (part_id)
      const corrDedupMap = new Map<number, (typeof correctionRows)[0]>();
      for (const row of correctionRows) {
        corrDedupMap.set(row.part_id, row);
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const corrCreateData: any[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const corrUpdateData: any[] = [];

      for (const row of corrDedupMap.values()) {
        const lotNumber = String(row.Partijnummer).trim();
        const supplierId = supplierMap.get(row.rel_id_leverancier);
        if (!supplierId) {
          correctionsSkipped++;
          continue;
        }

        const lotId = lotLookup.get(`${lotNumber}::${supplierId}`);
        if (!lotId) {
          correctionsSkipped++;
          continue;
        }

        const corrData = {
          lotId,
          fabricPartId: row.part_id,
          facttypeSub: row["Facttype Sub"]?.toLowerCase().trim() || "correctie",
          correctionReasonId: row.reden_id_correctie || null,
          correctionVolume: row["Inslagcorrectie volume"] ?? null,
          correctionColli: row["Inkoopfactuur colli"] ?? null,
        };

        if (existingCorrSet.has(row.part_id)) {
          corrUpdateData.push(corrData);
          correctionsUpdated++;
        } else {
          corrCreateData.push(corrData);
          correctionsCreated++;
        }
      }

      // Bulk insert new corrections
      if (corrCreateData.length > 0) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "LotCorrection" (
             id, "lotId", "fabricPartId", "facttypeSub",
             "correctionReasonId", "correctionVolume", "correctionColli",
             "createdAt", "updatedAt"
           )
           SELECT
             gen_random_uuid()::text,
             v.val->>'lotId',
             (v.val->>'fabricPartId')::int,
             v.val->>'facttypeSub',
             (v.val->>'correctionReasonId')::int,
             (v.val->>'correctionVolume')::int,
             (v.val->>'correctionColli')::int,
             NOW(),
             NOW()
           FROM jsonb_array_elements($1::jsonb) AS v(val)
           ON CONFLICT ("lotId", "fabricPartId") DO UPDATE SET
             "facttypeSub" = EXCLUDED."facttypeSub",
             "correctionReasonId" = EXCLUDED."correctionReasonId",
             "correctionVolume" = EXCLUDED."correctionVolume",
             "correctionColli" = EXCLUDED."correctionColli",
             "updatedAt" = NOW()`,
          JSON.stringify(corrCreateData)
        );
      }

      // Bulk update existing corrections
      if (corrUpdateData.length > 0) {
        await prisma.$executeRawUnsafe(
          `UPDATE "LotCorrection" AS t
           SET
             "facttypeSub" = u.val->>'facttypeSub',
             "correctionReasonId" = (u.val->>'correctionReasonId')::int,
             "correctionVolume" = (u.val->>'correctionVolume')::int,
             "correctionColli" = (u.val->>'correctionColli')::int,
             "updatedAt" = NOW()
           FROM jsonb_array_elements($1::jsonb) AS u(val)
           WHERE t."fabricPartId" = (u.val->>'fabricPartId')::int`,
          JSON.stringify(corrUpdateData)
        );
      }

      // Update aggregate correctionVolume on parent lots
      const affectedLotIds = [...new Set([
        ...corrCreateData.map((d: { lotId: string }) => d.lotId),
        ...corrUpdateData.map((d: { lotId: string }) => d.lotId),
      ])];

      if (affectedLotIds.length > 0) {
        await prisma.$executeRawUnsafe(
          `UPDATE "Lot" AS l
           SET "correctionVolume" = sub.total_vol,
               "updatedAt" = NOW()
           FROM (
             SELECT "lotId", SUM("correctionVolume") AS total_vol
             FROM "LotCorrection"
             WHERE "lotId" = ANY($1::text[])
             GROUP BY "lotId"
           ) AS sub
           WHERE l.id = sub."lotId"`,
          affectedLotIds
        );
      }
    }

    if (batch) {
      try {
        await prisma.importBatch.update({
          where: { id: batch.id },
          data: {
            status: "success",
            recordsReceived: partijen.length,
            recordsCreated: lotCreated + correctionsCreated,
            recordsUpdated: lotUpdated + correctionsUpdated,
            recordsSkipped: skipped + correctionsSkipped,
            durationMs: Date.now() - startTime,
            completedAt: new Date(),
            details: {
              salesSheets: { created: ssCreated, updated: ssUpdated },
              lots: { created: lotCreated, updated: lotUpdated },
              corrections: { created: correctionsCreated, updated: correctionsUpdated, skipped: correctionsSkipped },
            },
          },
        });
      } catch {
        // Batch logging should not block the import
      }
    }

    return NextResponse.json({
      received: partijen.length,
      salesSheets: { created: ssCreated, updated: ssUpdated },
      lots: { created: lotCreated, updated: lotUpdated },
      corrections: { created: correctionsCreated, updated: correctionsUpdated, skipped: correctionsSkipped },
      skipped,
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
