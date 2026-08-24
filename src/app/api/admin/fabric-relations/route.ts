import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";
import { readBackfillStart } from "@/lib/sync/settings";
import { enqueueBackfill } from "@/lib/sync/runner";

export async function GET() {
  const { error } = await requireAuth(["admin"]);
  if (error) return error;

  // Fetch all FabricRelation records
  const relations = await prisma.fabricRelation.findMany({
    orderBy: { code: "asc" },
  });

  const allFabricIds = relations.map((r) => r.fabricId);

  // Check which fabricIds are active Suppliers
  const suppliers = await prisma.supplier.findMany({
    where: { fabricId: { in: allFabricIds } },
    select: { id: true, code: true, fabricId: true },
  });
  const supplierByFabricId = new Map(
    suppliers.map((s) => [s.fabricId!, { id: s.id, code: s.code }])
  );

  // Check which fabricIds are Growers (sub-entities under suppliers)
  const growers = await prisma.grower.findMany({
    where: { fabricId: { in: allFabricIds } },
    select: {
      id: true,
      fabricId: true,
      supplier: { select: { code: true, name: true } },
    },
  });
  const growerByFabricId = new Map(
    growers.map((g) => [
      g.fabricId!,
      { id: g.id, supplierCode: g.supplier.code, supplierName: g.supplier.name },
    ])
  );

  // Count lots per fabricId (via Supplier.fabricId → Lot)
  const lotsAsSupplier = await prisma.$queryRaw<
    { fabricId: number; count: number }[]
  >`
    SELECT s."fabricId" as "fabricId", CAST(COUNT(l.id) AS INT) as count
    FROM "Supplier" s
    JOIN "Lot" l ON l."supplierId" = s.id
    WHERE s."fabricId" = ANY(${allFabricIds})
    GROUP BY s."fabricId"
  `;
  const lotCountByFabricId = new Map(
    lotsAsSupplier.map((r) => [r.fabricId, r.count])
  );

  // Count transactions per fabricId (via Transaction.fabricGrowerId)
  const txByGrower = await prisma.$queryRaw<
    { fabricId: number; count: number }[]
  >`
    SELECT t."fabricGrowerId" as "fabricId", CAST(COUNT(t.id) AS INT) as count
    FROM "Transaction" t
    WHERE t."fabricGrowerId" = ANY(${allFabricIds})
    GROUP BY t."fabricGrowerId"
  `;
  const txCountByFabricId = new Map(
    txByGrower.map((r) => [r.fabricId, r.count])
  );

  // Enrich each relation with status info
  const enriched = relations.map((rel) => {
    const supplier = supplierByFabricId.get(rel.fabricId);
    const grower = growerByFabricId.get(rel.fabricId);
    const lotCount = lotCountByFabricId.get(rel.fabricId) ?? 0;
    const txCount = txCountByFabricId.get(rel.fabricId) ?? 0;

    let status: "supplier" | "grower" | "has_data" | "no_data";
    if (supplier) {
      status = "supplier";
    } else if (grower) {
      status = "grower";
    } else if (lotCount > 0 || txCount > 0) {
      status = "has_data";
    } else {
      status = "no_data";
    }

    return {
      id: rel.id,
      fabricId: rel.fabricId,
      code: rel.code,
      name: rel.name,
      accountManagerName: rel.accountManagerName,
      accountManagerCode: rel.accountManagerCode,
      updatedAt: rel.updatedAt,
      status,
      supplierId: supplier?.id ?? null,
      supplierCode: supplier?.code ?? null,
      growerInfo: grower ?? null,
      lotCount,
      txCount,
    };
  });

  // Summary counts
  const summary = {
    total: enriched.length,
    suppliers: enriched.filter((r) => r.status === "supplier").length,
    growers: enriched.filter((r) => r.status === "grower").length,
    hasData: enriched.filter((r) => r.status === "has_data").length,
    noData: enriched.filter((r) => r.status === "no_data").length,
  };

  // Relations that have data but are not activated
  const unactivatedWithData = enriched
    .filter((r) => r.status === "has_data")
    .map((r) => ({ fabricId: r.fabricId, code: r.code, name: r.name }));

  return NextResponse.json({
    relations: enriched,
    summary,
    unactivatedWithData,
  });
}

const activateSchema = z.object({
  fabricId: z.number().int(),
  companyId: z.string().uuid(),
  /** Zet ook meteen een backfill klaar. Het scherm vraagt hier eerst om. */
  backfill: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  const { error } = await requireAuth(["admin"]);
  if (error) return error;

  const body = await request.json();
  const parsed = activateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { fabricId, companyId } = parsed.data;

  // Validate FabricRelation exists
  const relation = await prisma.fabricRelation.findUnique({
    where: { fabricId },
  });
  if (!relation) {
    return NextResponse.json(
      { error: "Fabric relation not found" },
      { status: 404 }
    );
  }

  // Check not already a Supplier
  const existingSupplier = await prisma.supplier.findUnique({
    where: { fabricId },
  });
  if (existingSupplier) {
    return NextResponse.json(
      { error: "Already activated as supplier" },
      { status: 409 }
    );
  }

  // Validate company exists
  const company = await prisma.company.findUnique({
    where: { id: companyId },
  });
  if (!company) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }

  // Create Supplier from FabricRelation data
  const supplier = await prisma.supplier.create({
    data: {
      code: relation.code,
      name: relation.name,
      fabricId: relation.fabricId,
      accountManagerName: relation.accountManagerName,
      accountManagerCode: relation.accountManagerCode,
      companyId,
    },
  });

  // De leverancier bestaat nu. Lukt de backfill niet, dan is dat geen reden om
  // de activatie terug te draaien: aanmaken en backfillen zijn twee handelingen
  // die toevallig achter één knop zitten. Het scherm toont wat er misging.
  let backfill: { runId: string; jobs: number } | null = null;
  let backfillError: string | null = null;
  if (parsed.data.backfill) {
    const start = await readBackfillStart();
    if (!start) {
      backfillError = "No backfill start date is set.";
    } else {
      try {
        // enqueueBackfill weigert met een reden in plaats van te gooien; de
        // catch eromheen is voor het onverwachte, zodat een omgevallen database
        // de activatie niet alsnog op een 500 zet nadat de leverancier bestaat.
        const result = await enqueueBackfill(relation.fabricId, start);
        if (result.ok) backfill = { runId: result.runId, jobs: result.jobs };
        else backfillError = result.message;
      } catch (e) {
        backfillError = e instanceof Error ? e.message : "Could not start the backfill";
      }
    }
  }

  return NextResponse.json(
    { supplierId: supplier.id, code: supplier.code, name: supplier.name, backfill, backfillError },
    { status: 201 }
  );
}
