import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";
import { readBackfillStart } from "@/lib/sync/settings";
import { enqueueBackfill, openBackfills, planBackfill } from "@/lib/sync/runner";

/** De lopende backfills met hun voortgang, voor de kaart op het Schedules-tabblad. */
export async function GET() {
  const { error } = await requireAuth(["admin"]);
  if (error) return error;

  const backfills = await openBackfills();
  if (backfills.length === 0) return NextResponse.json({ backfills: [] });

  // Een backfill kan gestart zijn vanuit het overgeslagen-paneel, waar de
  // leverancier op datzelfde moment pas wordt aangemaakt. Ontbreekt hij toch,
  // dan blijft de kaart staan met alleen zijn Fabric-id — beter dan verdwijnen.
  const suppliers = await prisma.supplier.findMany({
    where: { fabricId: { in: backfills.map((b) => b.supplierFabricId) } },
    select: { fabricId: true, code: true, name: true },
  });
  const perId = new Map<number, { code: string; name: string }>();
  for (const supplier of suppliers) {
    if (supplier.fabricId !== null) {
      perId.set(supplier.fabricId, { code: supplier.code, name: supplier.name });
    }
  }

  return NextResponse.json({
    backfills: backfills.map((b) => ({
      ...b,
      code: perId.get(b.supplierFabricId)?.code ?? null,
      name: perId.get(b.supplierFabricId)?.name ?? null,
    })),
  });
}

const bodySchema = z.object({ supplierFabricId: z.number().int() });

/** Zet een backfill klaar voor één leverancier, vanaf de ingestelde basisdatum. */
export async function POST(request: NextRequest) {
  const { error } = await requireAuth(["admin"]);
  if (error) return error;

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const start = await readBackfillStart();
  if (!start) {
    return NextResponse.json(
      { error: "No backfill start date is set. Set one on the Schedules tab first." },
      { status: 409 }
    );
  }

  // Geen try/catch: enqueueBackfill geeft zijn weigeringen terug in plaats van
  // ze te gooien, zodat "er loopt er al een" niet op dezelfde hoop belandt als
  // een database die wegvalt. Die laatste hoort een 500 te zijn.
  const result = await enqueueBackfill(parsed.data.supplierFabricId, start);
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 409 });
  }

  return NextResponse.json(
    { runId: result.runId, jobs: result.jobs, plan: planBackfill(start) },
    { status: 201 }
  );
}
