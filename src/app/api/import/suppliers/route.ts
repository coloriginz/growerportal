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

    let created = 0;
    let updated = 0;
    let errors = 0;

    for (const row of suppliers) {
      try {
        const result = await prisma.fabricRelation.upsert({
          where: { fabricId: row.ID },
          update: {
            code: row.Code,
            name: row.Naam,
            accountManagerName: row["AM Naam"] || null,
            accountManagerCode: row["AM Code"] || null,
          },
          create: {
            fabricId: row.ID,
            code: row.Code,
            name: row.Naam,
            accountManagerName: row["AM Naam"] || null,
            accountManagerCode: row["AM Code"] || null,
          },
        });
        // Check if it was created or updated by comparing createdAt timestamps
        const isNew = result.createdAt.getTime() > Date.now() - 5000;
        if (isNew) created++;
        else updated++;
      } catch {
        errors++;
      }
    }

    // Batch-update Grower names from FabricRelation
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
