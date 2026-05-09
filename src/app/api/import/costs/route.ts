import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireImportAuth } from "@/lib/import-auth";

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

export async function POST(request: NextRequest) {
  const authError = requireImportAuth(request);
  if (authError) return authError;

  const body = await request.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { costs } = parsed.data;

  // Build salessheet lookup: fabricParthdrId → UUID
  const parthdrIds = [...new Set(costs.map((c) => c["Parthdr ID"]))];
  const salesSheets = await prisma.salesSheet.findMany({
    where: { fabricParthdrId: { in: parthdrIds } },
    select: { id: true, fabricParthdrId: true },
  });
  const ssMap = new Map<number, string>();
  for (const ss of salesSheets) {
    if (ss.fabricParthdrId) ssMap.set(ss.fabricParthdrId, ss.id);
  }

  let created = 0, updated = 0, skipped = 0;
  const affectedSSIds = new Set<string>();

  for (const row of costs) {
    const salesSheetId = ssMap.get(row["Parthdr ID"]);
    if (!salesSheetId) { skipped++; continue; }

    const description = row["Kost Naam"]?.trim() || "Unknown cost";
    const amount = Math.round(row["Salesheet Amount"] * 100) / 100;

    try {
      const existing = await prisma.salesSheetCost.findUnique({
        where: { fabricShkostId: row["Shkost ID"] },
      });

      if (existing) {
        await prisma.salesSheetCost.update({
          where: { fabricShkostId: row["Shkost ID"] },
          data: {
            description,
            amount,
            fabricKostId: row["Kost ID"] || null,
            costTypeCode: row["Kost Type Code"] || null,
            costTypeName: row["Kost Type Naam"] || null,
            totalTurnover: row["Totaal Omzet"] != null ? Math.round(row["Totaal Omzet"] * 100) / 100 : null,
            totalQuantity: row["Totaal Aantal"] || null,
          },
        });
        updated++;
      } else {
        await prisma.salesSheetCost.create({
          data: {
            salesSheetId,
            description,
            amount,
            fabricShkostId: row["Shkost ID"],
            fabricKostId: row["Kost ID"] || null,
            costTypeCode: row["Kost Type Code"] || null,
            costTypeName: row["Kost Type Naam"] || null,
            totalTurnover: row["Totaal Omzet"] != null ? Math.round(row["Totaal Omzet"] * 100) / 100 : null,
            totalQuantity: row["Totaal Aantal"] || null,
          },
        });
        created++;
      }
      affectedSSIds.add(salesSheetId);
    } catch {
      skipped++;
    }
  }

  // Recalculate salessheet totals + update receipt/registration dates
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

    // Find latest receipt/registration dates from cost rows for this salessheet
    const ssSourceRows = costs.filter((c) => ssMap.get(c["Parthdr ID"]) === ssId);
    let lastReceiptDate: Date | null = null;
    let lastRegistrationDate: Date | null = null;
    for (const r of ssSourceRows) {
      if (r["Laatste Ontvangstdatum"]) {
        const d = new Date(r["Laatste Ontvangstdatum"]);
        if (!isNaN(d.getTime()) && (!lastReceiptDate || d > lastReceiptDate)) lastReceiptDate = d;
      }
      if (r["Laatste Aanmelddatum"]) {
        const d = new Date(r["Laatste Aanmelddatum"]);
        if (!isNaN(d.getTime()) && (!lastRegistrationDate || d > lastRegistrationDate)) lastRegistrationDate = d;
      }
    }

    await prisma.salesSheet.update({
      where: { id: ssId },
      data: {
        totalTurnover: Math.round(totalTurnover * 100) / 100,
        totalCosts: Math.round(totalCosts * 100) / 100,
        netResult: Math.round((totalTurnover - totalCosts) * 100) / 100,
        ...(lastReceiptDate ? { lastReceiptDate } : {}),
        ...(lastRegistrationDate ? { lastRegistrationDate } : {}),
      },
    });
    ssRecalculated++;
  }

  return NextResponse.json({
    received: costs.length,
    created,
    updated,
    skipped,
    salesSheetsRecalculated: ssRecalculated,
  });
}
