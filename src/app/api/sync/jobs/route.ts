import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";

/**
 * Hoe lang een misgelopen ronde blijft staan nadat hij is afgebroken. Lang
 * genoeg dat iemand die 's ochtends inlogt de nachtelijke mislukking nog ziet,
 * kort genoeg dat het scherm geen archief wordt — daarvoor is de historie.
 */
const RECENT_FAILURE_MINUTES = 120;

/**
 * De rondes die aandacht verdienen. Twee soorten:
 *
 *   - `running`: minstens één job moet nog beginnen of is onderweg. Dit is wat
 *     de batch-historie niet kan tonen — een job die nog in de wachtrij staat
 *     heeft nog geen batch.
 *   - `failed`: een job is gefaald, waarna de runner de rest van de ronde heeft
 *     geannuleerd. Er staat dan niets meer pending of dispatched, dus zonder
 *     deze tak zou de ronde uit het antwoord vallen en zag mislukken er op het
 *     scherm precies zo uit als slagen: het blok verdwijnt.
 *
 * Een geslaagde ronde verdwijnt nog steeds — die staat compleet in de historie.
 */
export async function GET() {
  const { error } = await requireAuth(["admin"]);
  if (error) return error;

  const [open, recentlyFailed] = await Promise.all([
    prisma.syncJob.findMany({
      where: { status: { in: ["pending", "dispatched"] } },
      select: { runId: true },
      distinct: ["runId"],
    }),
    prisma.syncJob.findMany({
      where: {
        status: "failed",
        completedAt: { gte: new Date(Date.now() - RECENT_FAILURE_MINUTES * 60000) },
      },
      select: { runId: true },
      distinct: ["runId"],
    }),
  ]);

  const runIds = [...new Set([...open, ...recentlyFailed].map((o) => o.runId))];
  if (runIds.length === 0) return NextResponse.json({ runs: [] });

  const jobs = await prisma.syncJob.findMany({
    where: { runId: { in: runIds } },
    orderBy: [{ createdAt: "asc" }, { sequence: "asc" }],
  });

  const batchIds = jobs.map((j) => j.importBatchId).filter((id): id is string => !!id);
  const batches = batchIds.length
    ? await prisma.importBatch.findMany({
        where: { id: { in: batchIds } },
        select: { id: true, status: true, recordsReceived: true, durationMs: true },
      })
    : [];
  const batchMap = new Map(batches.map((b) => [b.id, b]));

  const runs = runIds
    .map((runId) => {
      const runJobs = jobs.filter((j) => j.runId === runId);
      // Een gefaalde job breekt de rest van zijn ronde af, dus "er is er één
      // gefaald" en "er staat er nog een klaar" sluiten elkaar in de praktijk
      // uit. Faalt het toch allebei, dan weegt de fout zwaarder.
      const failedJob = runJobs.find((j) => j.status === "failed");
      return {
        runId,
        source: runJobs[0].source,
        state: failedJob ? ("failed" as const) : ("running" as const),
        startedAt: runJobs[0].createdAt,
        failedAt: failedJob?.completedAt ?? null,
        jobs: runJobs.map((j) => ({
          ...j,
          batch: j.importBatchId ? batchMap.get(j.importBatchId) ?? null : null,
        })),
      };
    })
    // Wat nu loopt eerst, daarna de mislukkingen, elk met de nieuwste bovenaan.
    .sort((a, b) => {
      if (a.state !== b.state) return a.state === "running" ? -1 : 1;
      return b.startedAt.getTime() - a.startedAt.getTime();
    });

  return NextResponse.json({ runs });
}
