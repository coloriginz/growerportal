import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireImportAuth, stripBracketKeys } from "@/lib/import-auth";

const growerSchema = z.object({
  Naam: z.string().min(1),
  Code: z.string().min(1),
  ID: z.number().int(), // rel_id_kweker
  "Land Code": z.string().nullable().optional(),
  "Land Naam": z.string().nullable().optional(),
  Plaats: z.string().nullable().optional(),
});

const bodySchema = z.object({
  growers: z.array(growerSchema),
});

export async function POST(request: NextRequest) {
  const authError = requireImportAuth(request);
  if (authError) return authError;

  const startTime = Date.now();
  let batch: { id: string } | null = null;
  try {
    batch = await prisma.importBatch.create({
      data: { endpoint: "growers", status: "running" },
    });
  } catch {
    // Batch logging should not block the import
  }

  const body = await request.json();
  if (body.growers) body.growers = stripBracketKeys(body.growers);
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
    const { growers } = parsed.data;

    if (growers.length === 0) {
      if (batch) {
        try {
          await prisma.importBatch.update({
            where: { id: batch.id },
            data: { status: "success", recordsReceived: 0, durationMs: Date.now() - startTime, completedAt: new Date() },
          });
        } catch { /* */ }
      }
      return NextResponse.json({ received: 0, created: 0, updated: 0 });
    }

    // Build a map of incoming grower data keyed by fabricId
    const incomingMap = new Map<number, (typeof growers)[number]>();
    for (const row of growers) {
      incomingMap.set(row.ID, row);
    }

    // Find existing Grower records that match the incoming fabricIds
    const existingGrowers = await prisma.grower.findMany({
      where: {
        fabricId: { in: Array.from(incomingMap.keys()) },
      },
      select: { id: true, fabricId: true, name: true, code: true, country: true, city: true },
    });

    let updated = 0;
    let skipped = 0;
    let errors = 0;

    for (const existing of existingGrowers) {
      const row = incomingMap.get(existing.fabricId!);
      if (!row) continue;

      // Check if any field actually changed
      const newName = row.Naam;
      const newCode = row.Code;
      const newCountry = row["Land Naam"] || null;
      const newCity = row.Plaats || null;

      const hasChanges =
        existing.name !== newName ||
        existing.code !== newCode ||
        existing.country !== newCountry ||
        existing.city !== newCity;

      if (!hasChanges) {
        skipped++;
        continue;
      }

      try {
        await prisma.grower.update({
          where: { id: existing.id },
          data: {
            name: newName,
            code: newCode,
            country: newCountry,
            city: newCity,
          },
        });
        updated++;
      } catch {
        errors++;
      }
    }

    const matched = existingGrowers.length;
    const notInDb = incomingMap.size - matched;

    if (batch) {
      try {
        await prisma.importBatch.update({
          where: { id: batch.id },
          data: {
            status: "success",
            recordsReceived: growers.length,
            recordsCreated: 0,
            recordsUpdated: updated,
            recordsSkipped: skipped + notInDb,
            durationMs: Date.now() - startTime,
            completedAt: new Date(),
            details: {
              matched,
              unchanged: skipped,
              notInDb,
              errors,
            },
          },
        });
      } catch {
        // Batch logging should not block the import
      }
    }

    return NextResponse.json({
      received: growers.length,
      matched,
      updated,
      unchanged: skipped,
      notInDb,
      errors,
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
