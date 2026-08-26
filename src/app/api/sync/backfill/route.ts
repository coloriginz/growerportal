import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";
import { readBackfillStart } from "@/lib/sync/settings";
import { describeStart, hasStart, resolveBackfillStart } from "@/lib/sync/backfill-start";
import { quarterLabel } from "@/lib/sync/backfill";
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

  // Waaróm een backfill bij dit kwartaal begint staat nergens opgeslagen — de
  // jobs dragen alleen hun venster. Het is wel af te leiden: de startdatum is
  // het latere van de globale datum en de eerste levering, dus begint hij later
  // dan de globale datum, dan heeft de eerste levering hem opgeschoven. Verzet
  // iemand de instelling terwijl een backfill loopt, dan klopt de reden niet
  // meer terwijl het kwartaal zelf blijft kloppen; die kaart staat hooguit een
  // ronde of wat.
  const globalStart = await readBackfillStart();
  const globalQuarter = globalStart ? quarterLabel(globalStart) : null;

  return NextResponse.json({
    backfills: backfills.map((b) => ({
      ...b,
      code: perId.get(b.supplierFabricId)?.code ?? null,
      name: perId.get(b.supplierFabricId)?.name ?? null,
      fromSource: globalQuarter === null ? null : b.from === globalQuarter ? "setting" : "fabric",
    })),
  });
}

const bodySchema = z.object({ supplierFabricId: z.number().int() });

/**
 * Zet een backfill klaar voor één leverancier, vanaf zijn eerste
 * consignatiepartij maar nooit vóór de ingestelde basisdatum.
 *
 * Het oplossen van die datum gebeurt hier en niet in `enqueueBackfill`: die
 * blijft een zuivere wachtrijfunctie, zodat een hangende vraag-flow niet in de
 * queue-logica terechtkomt.
 */
export async function POST(request: NextRequest) {
  const { error } = await requireAuth(["admin"]);
  if (error) return error;

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const globalStart = await readBackfillStart();
  if (!globalStart) {
    return NextResponse.json(
      { error: "No backfill start date is set. Set one on the Schedules tab first." },
      { status: 409 }
    );
  }

  const resolution = await resolveBackfillStart(parsed.data.supplierFabricId, globalStart);
  if (!hasStart(resolution)) {
    return NextResponse.json(
      { error: "This relation has no consignment lots in Fabric, so there is nothing to backfill." },
      { status: 409 }
    );
  }

  // Geen try/catch: enqueueBackfill geeft zijn weigeringen terug in plaats van
  // ze te gooien, zodat "er loopt er al een" niet op dezelfde hoop belandt als
  // een database die wegvalt. Die laatste hoort een 500 te zijn.
  const result = await enqueueBackfill(parsed.data.supplierFabricId, resolution.start);
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 409 });
  }

  return NextResponse.json(
    {
      runId: result.runId,
      jobs: result.jobs,
      plan: planBackfill(resolution.start),
      start: describeStart(resolution),
    },
    { status: 201 }
  );
}
