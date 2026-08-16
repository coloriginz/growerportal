import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { runImport } from "@/lib/import-batch";

const growerSchema = z.object({
  Naam: z.string().min(1),
  Code: z.string().min(1),
  ID: z.number().int(), // rel_id_kweker
  "Land Code": z.string().nullable().optional(),
  "Land Naam": z.string().nullable().optional(),
  Plaats: z.string().nullable().optional(),
});

type Grower = z.infer<typeof growerSchema>;

const growerKeys = Object.keys(growerSchema.shape);

const growerAliases = {
  // dim_kweker is not yet queried over SQL; see the note in the suppliers route.
} as const;

export async function POST(request: NextRequest) {
  return runImport(request, {
    endpoint: "growers",
    bodyKey: "growers",
    rowSchema: growerSchema,
    schemaKeys: growerKeys,
    aliases: growerAliases,
    handler: async (growers) => {
      if (growers.length === 0) return { created: 0, updated: 0, skipped: 0 };
      return upsertGrowers(growers);
    },
  });
}

async function upsertGrowers(growers: Grower[]) {
  // Build a map of incoming grower data keyed by fabricId
  const incomingMap = new Map<number, Grower>();
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

  return {
    created: 0,
    updated,
    skipped: skipped + notInDb,
    details: {
      matched,
      unchanged: skipped,
      notInDb,
      errors,
    },
    extra: {
      matched,
      unchanged: skipped,
      notInDb,
      errors,
    },
  };
}
