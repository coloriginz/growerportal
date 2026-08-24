import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";
import { classificeerOvergeslagen, type SkippedRelation } from "@/lib/sync/skipped";

/**
 * Eén overgeslagen relatie met een gezicht: het rel_id uit `skippedSuppliers`,
 * aangevuld uit `FabricRelation`. Blijft `code` en `name` null, dan kent de
 * portal die relatie helemaal niet — die regel blijft staan, want juist dan is
 * het nuttig te zien dát er iets wegvalt.
 */
type SkippedRelationRow = SkippedRelation & {
  code: string | null;
  name: string | null;
  /** `FabricRelation` heeft geen land; dit komt van de kweker met hetzelfde rel_id, als die bestaat. */
  country: string | null;
  accountManagerName: string | null;
  /** Er is al een `Supplier` met dit fabricId — dan valt er niets te activeren. */
  alBestaat: boolean;
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireAuth(["admin"]);
  if (error) return error;

  const { id } = await params;

  const batch = await prisma.importBatch.findUnique({
    where: { id },
    select: { id: true, endpoint: true, startedAt: true, recordsSkipped: true, details: true },
  });
  if (!batch) {
    return NextResponse.json({ error: "Import batch not found" }, { status: 404 });
  }

  const details = batch.details as { skippedSuppliers?: unknown } | null;
  const { kwekers, interneBoekingen } = classificeerOvergeslagen(details?.skippedSuppliers);

  const relIds = [...kwekers, ...interneBoekingen].map((r) => r.relId);

  // Drie queries over alle rel_ids tegelijk, niet één per relatie: een ronde kan
  // er vijftig overslaan.
  const [relations, suppliers, growers] = relIds.length
    ? await Promise.all([
        prisma.fabricRelation.findMany({
          where: { fabricId: { in: relIds } },
          select: { fabricId: true, code: true, name: true, accountManagerName: true },
        }),
        prisma.supplier.findMany({
          where: { fabricId: { in: relIds } },
          select: { fabricId: true },
        }),
        prisma.grower.findMany({
          where: { fabricId: { in: relIds }, country: { not: null } },
          select: { fabricId: true, country: true },
        }),
      ])
    : [[], [], []];

  const relationByFabricId = new Map(relations.map((r) => [r.fabricId, r]));
  const activated = new Set(suppliers.map((s) => s.fabricId));
  const countryByFabricId = new Map(growers.map((g) => [g.fabricId!, g.country]));

  const enrich = (relatie: SkippedRelation): SkippedRelationRow => {
    const relation = relationByFabricId.get(relatie.relId);
    return {
      ...relatie,
      code: relation?.code ?? null,
      name: relation?.name ?? null,
      country: countryByFabricId.get(relatie.relId) ?? null,
      accountManagerName: relation?.accountManagerName ?? null,
      alBestaat: activated.has(relatie.relId),
    };
  };

  return NextResponse.json({
    batchId: batch.id,
    endpoint: batch.endpoint,
    startedAt: batch.startedAt,
    recordsSkipped: batch.recordsSkipped,
    kwekers: kwekers.map(enrich),
    interneBoekingen: interneBoekingen.map(enrich),
  });
}
