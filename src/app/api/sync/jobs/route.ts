import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";

/**
 * De lopende rondes: elke ronde waarvan minstens één job nog moet beginnen of
 * onderweg is. Dit is wat de batch-historie niet kan tonen — een job die nog in
 * de wachtrij staat heeft nog geen batch.
 */
export async function GET() {
  const { error } = await requireAuth(["admin"]);
  if (error) return error;

  const open = await prisma.syncJob.findMany({
    where: { status: { in: ["pending", "dispatched"] } },
    select: { runId: true },
    distinct: ["runId"],
  });

  if (open.length === 0) return NextResponse.json({ runs: [] });

  const jobs = await prisma.syncJob.findMany({
    where: { runId: { in: open.map((o) => o.runId) } },
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

  const runs = [...new Set(jobs.map((j) => j.runId))].map((runId) => ({
    runId,
    source: jobs.find((j) => j.runId === runId)!.source,
    jobs: jobs
      .filter((j) => j.runId === runId)
      .map((j) => ({ ...j, batch: j.importBatchId ? batchMap.get(j.importBatchId) ?? null : null })),
  }));

  return NextResponse.json({ runs });
}
