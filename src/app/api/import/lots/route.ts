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
});

const bodySchema = z.object({
  partijen: z.array(partijSchema).min(1),
});

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

    // Round IDs (DAX/Power Automate can send 1.0 instead of 1)
    for (const row of partijen) {
      row.part_id = Math.round(row.part_id);
      row.parthdr_id = Math.round(row.parthdr_id);
      row.rel_id_leverancier = Math.round(row.rel_id_leverancier);
      if (row.art_id) row.art_id = Math.round(row.art_id);
      if (row.reden_id_correctie) row.reden_id_correctie = Math.round(row.reden_id_correctie);
    }

    // Group by parthdr_id
    const byParthdr = new Map<number, typeof partijen>();
    for (const row of partijen) {
      if (!byParthdr.has(row.parthdr_id)) byParthdr.set(row.parthdr_id, []);
      byParthdr.get(row.parthdr_id)!.push(row);
    }

    const allParthdrIds = [...byParthdr.keys()];
    const allPartIds = partijen.map((p) => p.part_id);

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
      await prisma.salesSheet.createMany({ data: ssCreateData });
      // Fetch new salessheet IDs
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
            correctionReasonId: row.reden_id_correctie || null,
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
            correctionReasonId: row.reden_id_correctie || null,
            invoicedColli: row["Inkoopfactuur colli"] || null,
            invoicedVolume: row["Inkoopfactuur volume"] || null,
            correctionVolume: row["Inslagcorrectie volume"] || null,
          });
          lotCreated++;
        }
      }
    }

    // Phase 6: Execute lot operations
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
           "correctionReasonId" = (u.val->>'correctionReasonId')::int,
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
      try {
        await prisma.lot.createMany({ data: lotCreateData });
      } catch {
        // Fallback to individual creates if batch fails (e.g. unique constraint)
        for (const data of lotCreateData) {
          try {
            await prisma.lot.create({ data });
          } catch {
            skipped++;
            lotCreated--;
          }
        }
      }
    }

    if (batch) {
      try {
        await prisma.importBatch.update({
          where: { id: batch.id },
          data: {
            status: "success",
            recordsReceived: partijen.length,
            recordsCreated: lotCreated,
            recordsUpdated: lotUpdated,
            recordsSkipped: skipped,
            durationMs: Date.now() - startTime,
            completedAt: new Date(),
            details: {
              salesSheets: { created: ssCreated, updated: ssUpdated },
              lots: { created: lotCreated, updated: lotUpdated },
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
