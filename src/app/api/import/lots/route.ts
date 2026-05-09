import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireImportAuth } from "@/lib/import-auth";

const partijSchema = z.object({
  part_id: z.number().int(),
  parthdr_id: z.number().int(),
  rel_id_leverancier: z.number().int(),
  Partijnummer: z.union([z.string(), z.number()]),
  "Inkoop Factuur Nummer": z.string().nullable().optional(),
  "Lever Datum/Tijd": z.string().nullable().optional(),
  "Artikel Naam": z.string().nullable().optional(),
  "Artikel Code": z.string().nullable().optional(),
  "Inkooptype Code": z.string().nullable().optional(),
  S01: z.string().nullable().optional(),
  S02: z.string().nullable().optional(),
  S03: z.string().nullable().optional(),
  art_id: z.number().int().nullable().optional(),
  reden_id_correctie: z.number().int().nullable().optional(),
  "Inkoopfactuur colli": z.number().int().nullable().optional(),
  "Inkoopfactuur volume": z.number().int().nullable().optional(),
  "Inslagcorrectie volume": z.number().int().nullable().optional(),
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

    // Build supplier lookup: fabricId → UUID
    const supplierMap = new Map<number, string>();
    const suppliers = await prisma.supplier.findMany({
      where: { fabricId: { not: null } },
      select: { id: true, fabricId: true },
    });
    for (const s of suppliers) {
      if (s.fabricId) supplierMap.set(s.fabricId, s.id);
    }

    // Group partijen by parthdr_id for salessheet creation
    const byParthdr = new Map<number, typeof partijen>();
    for (const row of partijen) {
      if (!byParthdr.has(row.parthdr_id)) byParthdr.set(row.parthdr_id, []);
      byParthdr.get(row.parthdr_id)!.push(row);
    }

    let ssCreated = 0, ssUpdated = 0;
    let lotCreated = 0, lotUpdated = 0;
    let skipped = 0;

    for (const [parthdrId, rows] of byParthdr) {
      const firstRow = rows[0];
      const supplierId = supplierMap.get(firstRow.rel_id_leverancier);
      if (!supplierId) {
        skipped += rows.length;
        continue;
      }

      // Determine invoice number
      let invoiceNumber = firstRow["Inkoop Factuur Nummer"]?.trim() || null;
      if (!invoiceNumber || ["", "xxx", "volgt", "test", "restpartijen"].includes(invoiceNumber)) {
        invoiceNumber = `FABRIC-${parthdrId}`;
      }

      const deliveryDate = firstRow["Lever Datum/Tijd"]
        ? new Date(firstRow["Lever Datum/Tijd"])
        : new Date();

      // Upsert SalesSheet
      try {
        const existing = await prisma.salesSheet.findUnique({ where: { fabricParthdrId: parthdrId } });
        if (existing) {
          await prisma.salesSheet.update({
            where: { fabricParthdrId: parthdrId },
            data: { deliveryDate },
          });
          ssUpdated++;
        } else {
          // Check for invoiceNumber collision
          const existingByInvoice = await prisma.salesSheet.findUnique({ where: { invoiceNumber } });
          if (existingByInvoice) {
            invoiceNumber = `${invoiceNumber}-${parthdrId}`;
          }
          await prisma.salesSheet.create({
            data: {
              invoiceNumber,
              fabricParthdrId: parthdrId,
              supplierId,
              invoiceDate: deliveryDate,
              deliveryDate,
              totalTurnover: 0,
              totalCosts: 0,
              netResult: 0,
            },
          });
          ssCreated++;
        }
      } catch {
        skipped += rows.length;
        continue;
      }

      // Get salesSheet ID
      const salesSheet = await prisma.salesSheet.findUnique({
        where: { fabricParthdrId: parthdrId },
        select: { id: true },
      });
      if (!salesSheet) continue;

      // Upsert lots
      for (const row of rows) {
        const lotNumber = String(row.Partijnummer).trim();
        if (!lotNumber) { skipped++; continue; }

        const productName = row["Artikel Naam"]?.trim() || "Unknown";
        const stemLength = row.S01 ? parseInt(row.S01, 10) || 0 : 0;

        try {
          const existingLot = await prisma.lot.findUnique({ where: { fabricPartId: row.part_id } });
          if (existingLot) {
            await prisma.lot.update({
              where: { fabricPartId: row.part_id },
              data: {
                lotNumber,
                productName,
                articleGroup: deriveArticleGroup(productName),
                articleCode: row["Artikel Code"] || null,
                purchaseType: row["Inkooptype Code"] || null,
                s1: row.S01 || null,
                s2: row.S02 || null,
                s3: row.S03 || null,
                correctionReasonId: row.reden_id_correctie || null,
                invoicedColli: row["Inkoopfactuur colli"] || null,
                invoicedVolume: row["Inkoopfactuur volume"] || null,
                correctionVolume: row["Inslagcorrectie volume"] || null,
              },
            });
            lotUpdated++;
          } else {
            await prisma.lot.create({
              data: {
                lotNumber,
                refNumber: lotNumber,
                fabricPartId: row.part_id,
                fabricParthdrId: parthdrId,
                supplierId,
                salesSheetId: salesSheet.id,
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
              },
            });
            lotCreated++;
          }
        } catch {
          skipped++;
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
