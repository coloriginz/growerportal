import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireImportAuth, stripBracketKeys } from "@/lib/import-auth";

const supplierSchema = z.object({
  Code: z.string().min(1),
  Naam: z.string().min(1),
  ID: z.number().int(),              // rel_id_leverancier
  "AM Naam": z.string().nullable().optional(),
  "AM Code": z.string().nullable().optional(),
});

const bodySchema = z.object({
  suppliers: z.array(supplierSchema).min(1),
});

const BATCH_SIZE = 100;

export async function POST(request: NextRequest) {
  const authError = requireImportAuth(request);
  if (authError) return authError;

  const startTime = Date.now();
  let batch: { id: string } | null = null;
  try {
    batch = await prisma.importBatch.create({
      data: { endpoint: "suppliers", status: "running" },
    });
  } catch {
    // Batch logging should not block the import
  }

  const body = await request.json();
  if (body.suppliers) body.suppliers = stripBracketKeys(body.suppliers);
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
    const { suppliers } = parsed.data;

    // Phase 1: Pre-fetch all existing FabricRelations in bulk
    const allFabricIds = suppliers.map((s) => s.ID);
    const existingRelations = await prisma.fabricRelation.findMany({
      where: { fabricId: { in: allFabricIds } },
      select: { fabricId: true },
    });
    const existingSet = new Set(existingRelations.map((r) => r.fabricId));

    // Phase 2: Split into creates and updates
    let created = 0;
    let updated = 0;
    let errors = 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateOps: any[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const createData: any[] = [];

    for (const row of suppliers) {
      if (existingSet.has(row.ID)) {
        updateOps.push(
          prisma.fabricRelation.update({
            where: { fabricId: row.ID },
            data: {
              code: row.Code,
              name: row.Naam,
              accountManagerName: row["AM Naam"] || null,
              accountManagerCode: row["AM Code"] || null,
            },
          })
        );
        updated++;
      } else {
        createData.push({
          fabricId: row.ID,
          code: row.Code,
          name: row.Naam,
          accountManagerName: row["AM Naam"] || null,
          accountManagerCode: row["AM Code"] || null,
        });
        created++;
      }
    }

    // Phase 3: Execute in batches
    for (let i = 0; i < updateOps.length; i += BATCH_SIZE) {
      await prisma.$transaction(updateOps.slice(i, i + BATCH_SIZE));
    }

    if (createData.length > 0) {
      try {
        await prisma.fabricRelation.createMany({ data: createData });
      } catch {
        // Fallback to individual creates
        for (const data of createData) {
          try {
            await prisma.fabricRelation.create({ data });
          } catch {
            errors++;
            created--;
          }
        }
      }
    }

    // Phase 4: Batch-update Grower names from FabricRelation
    let growerNamesFilled = 0;
    try {
      growerNamesFilled = await prisma.$executeRaw`
        UPDATE "Grower" g
        SET name = fr.name
        FROM "FabricRelation" fr
        WHERE g."fabricId" = fr."fabricId"
          AND (g.name IS NULL OR g.name != fr.name)
      `;
    } catch {
      // Name sync should not block the import
    }

    if (batch) {
      try {
        await prisma.importBatch.update({
          where: { id: batch.id },
          data: {
            status: "success",
            recordsReceived: suppliers.length,
            recordsCreated: created,
            recordsUpdated: updated,
            recordsSkipped: errors,
            durationMs: Date.now() - startTime,
            completedAt: new Date(),
            details: {
              growerNamesFilled,
            },
          },
        });
      } catch {
        // Batch logging should not block the import
      }
    }

    return NextResponse.json({
      received: suppliers.length,
      created,
      updated,
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
