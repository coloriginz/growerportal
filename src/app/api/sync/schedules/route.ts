import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";
import { windowAdvies } from "@/lib/sync/schedule";

export async function GET() {
  const { error } = await requireAuth(["admin"]);
  if (error) return error;

  const schedules = await prisma.syncSchedule.findMany({ orderBy: { name: "asc" } });

  // Wanneer liep dit schema voor het laatst helemaal goed? Dat is afgeleid en niet
  // opgeslagen: lastRunAt wordt gestempeld bij het klaarzetten, niet bij het slagen,
  // en kan dus nooit als alarm dienen. De laatste ronde waarvan élke job op done
  // staat is het echte antwoord.
  const jobs = await prisma.syncJob.findMany({
    where: { source: { in: schedules.map((s) => s.name) } },
    select: { runId: true, source: true, status: true, completedAt: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  const perRun = new Map<string, { source: string; statussen: string[]; klaar: Date | null; start: Date }>();
  for (const j of jobs) {
    const r = perRun.get(j.runId) ?? { source: j.source, statussen: [], klaar: null, start: j.createdAt };
    r.statussen.push(j.status);
    if (j.completedAt && (!r.klaar || j.completedAt > r.klaar)) r.klaar = j.completedAt;
    if (j.createdAt < r.start) r.start = j.createdAt;
    perRun.set(j.runId, r);
  }

  const laatstGoed = new Map<string, Date>();
  for (const r of perRun.values()) {
    if (r.statussen.every((s) => s === "done") && r.klaar) {
      const huidig = laatstGoed.get(r.source);
      if (!huidig || r.klaar > huidig) laatstGoed.set(r.source, r.klaar);
    }
  }

  const vastgelopen = await prisma.syncJob.count({ where: { status: "dispatched" } });

  return NextResponse.json({
    schedules: schedules.map((s) => ({
      ...s,
      lastSuccessAt: laatstGoed.get(s.name) ?? null,
      warnings: windowAdvies(s),
    })),
    stuckJobs: vastgelopen,
  });
}
