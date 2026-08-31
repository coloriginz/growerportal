import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { runImport } from "@/lib/import-batch";
import { findJobForBatch, resolveScopedSupplierId } from "@/lib/sync/job-context";

// Vercel kapt een functie zonder dit af op de standaardlimiet; de lots- en
// orders-import over een breed venster halen die niet.
export const maxDuration = 300;

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
    handler: async (growers, batchId) => {
      if (growers.length === 0) return { created: 0, updated: 0, skipped: 0 };
      return upsertGrowers(growers, batchId);
    },
  });
}

async function upsertGrowers(growers: Grower[], batchId: string | null) {
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
          lastImportBatchId: batchId,
        },
      });
      updated++;
    } catch {
      errors++;
    }
  }

  const matched = existingGrowers.length;
  const notInDb = incomingMap.size - matched;

  /*
   * Kwekers die de portal nog niet heeft, aanmaken.
   *
   * Dit kon lang niet, en dat was geen keuze maar een gevolg: `Grower.supplierId`
   * is verplicht en `marts.dim_kweker` draagt geen leverancier. De enige plek waar
   * kwekers ontstonden was daarom de orders-import, als bijproduct — met alleen
   * een naam, zonder code, land of plaats. Bij een herbouw vanaf een lege database
   * levert de growers-ronde dan nul, en staat de stamdata pas compleet nadat de
   * orders eroverheen zijn gegaan.
   *
   * De leverancier komt uit de sync-job, niet uit de rijen. Dat is precies genoeg:
   * een backfill draait altijd per leverancier — de growers-job staat op sequence
   * 0 met `supplierFabricId` gevuld — en dat is óók de leverancier waar de query
   * de kwekers doorheen filtert (`growerViaPartijenClause`). Bij een ongescopete
   * nachtronde is er geen leverancier en blijft het bij bijwerken: liever een
   * kweker die nog niet bestaat dan een kweker onder een gegokte leverancier.
   *
   * Bestaande kwekers verhuizen nooit. Dat een kweker via meerdere leveranciers
   * kan leveren is bekend en onopgelost (1.364 in Fabric, zie
   * `tasks/todo-kweker-bij-meerdere-leveranciers.md`); die knoop wordt hier niet
   * doorgehakt, want dat is een modelbeslissing en geen importdetail.
   */
  let created = 0;
  let createSkippedNoSupplier = 0;

  if (notInDb > 0) {
    const job = await findJobForBatch(batchId);
    const supplierId = await resolveScopedSupplierId(job?.supplierFabricId ?? null);

    if (!supplierId) {
      createSkippedNoSupplier = notInDb;
    } else {
      const bestaand = new Set(existingGrowers.map((g) => g.fabricId));
      const nieuw = [...incomingMap.values()]
        .filter((row) => !bestaand.has(row.ID))
        .map((row) => ({
          fabricId: row.ID,
          supplierId,
          name: row.Naam,
          code: row.Code,
          country: row["Land Naam"] || null,
          city: row.Plaats || null,
          lastImportBatchId: batchId,
        }));

      try {
        created = (await prisma.grower.createMany({ data: nieuw, skipDuplicates: true })).count;
      } catch {
        // Terugvallen op één voor één: één botsing mag de rest niet meenemen.
        for (const data of nieuw) {
          try {
            await prisma.grower.create({ data });
            created++;
          } catch {
            errors++;
          }
        }
      }
    }
  }

  const details = {
    matched,
    unchanged: skipped,
    notInDb,
    created,
    errors,
    // Alleen aanwezig als er iets te melden is: een ongescopete ronde die kwekers
    // ziet die de portal niet heeft, kan ze niet plaatsen en dat hoort zichtbaar
    // te zijn in plaats van weg te vallen in `skipped`.
    ...(createSkippedNoSupplier > 0 ? { createSkippedNoSupplier } : {}),
  };

  return {
    created,
    updated,
    skipped: skipped + notInDb - created,
    details,
    extra: details,
  };
}
