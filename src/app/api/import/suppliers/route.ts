import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { runImport } from "@/lib/import-batch";

const supplierSchema = z.object({
  Code: z.string().min(1),
  Naam: z.string().min(1),
  ID: z.number().int(),              // rel_id_leverancier
  "AM Naam": z.string().nullable().optional(),
  "AM Code": z.string().nullable().optional(),
});

type Supplier = z.infer<typeof supplierSchema>;

const supplierKeys = Object.keys(supplierSchema.shape);

const supplierAliases = {
  // dim_leverancier is not yet queried over SQL; add the warehouse column
  // names here once that flow exists. Any field that stays unmatched is named
  // outright in the error summary, so one test run is enough to find them.
} as const;

export async function POST(request: NextRequest) {
  return runImport(request, {
    endpoint: "suppliers",
    bodyKey: "suppliers",
    rowSchema: supplierSchema,
    schemaKeys: supplierKeys,
    aliases: supplierAliases,
    handler: async (suppliers) => {
      if (suppliers.length === 0) return { created: 0, updated: 0, skipped: 0 };
      return upsertSuppliers(suppliers);
    },
  });
}

async function upsertSuppliers(suppliers: Supplier[]) {
  // Phase 1: Pre-fetch existing FabricRelations in bulk
  const allFabricIds = suppliers.map((s) => s.ID);
  const existingRelations = await prisma.fabricRelation.findMany({
    where: { fabricId: { in: allFabricIds } },
    select: { fabricId: true },
  });
  const existingSet = new Set(existingRelations.map((r) => r.fabricId));

  // Phase 2: Split into creates and updates
  const updateData: { fabricId: number; code: string; name: string; accountManagerName: string | null; accountManagerCode: string | null }[] = [];
  const createData: typeof updateData = [];

  for (const row of suppliers) {
    const record = {
      fabricId: row.ID,
      code: row.Code,
      name: row.Naam,
      accountManagerName: row["AM Naam"] || null,
      accountManagerCode: row["AM Code"] || null,
    };
    if (existingSet.has(row.ID)) {
      updateData.push(record);
    } else {
      createData.push(record);
    }
  }

  // Phase 3: Bulk update via single raw SQL (1 query instead of N)
  if (updateData.length > 0) {
    await prisma.$executeRawUnsafe(
      `UPDATE "FabricRelation" AS t
       SET
         code = u.code,
         name = u.name,
         "accountManagerName" = u.am_name,
         "accountManagerCode" = u.am_code,
         "updatedAt" = NOW()
       FROM (
         SELECT
           (val->>'fabricId')::int AS fabric_id,
           val->>'code' AS code,
           val->>'name' AS name,
           val->>'accountManagerName' AS am_name,
           val->>'accountManagerCode' AS am_code
         FROM jsonb_array_elements($1::jsonb) AS val
       ) AS u
       WHERE t."fabricId" = u.fabric_id`,
      JSON.stringify(updateData)
    );
  }

  // Phase 4: Bulk create
  let created = createData.length;
  let errors = 0;
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

  // Phase 5: Batch-update Grower names from FabricRelation
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

  return {
    created,
    updated: updateData.length,
    skipped: errors,
    details: { growerNamesFilled },
    extra: { errors },
  };
}
