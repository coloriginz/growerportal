import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";
import { resumeBackfill } from "@/lib/sync/runner";

/**
 * Hervat een backfill die op een brok is blijven steken.
 *
 * Onbekend runId en "er valt niets te hervatten" zijn twee verschillende
 * antwoorden. Zonder de telling vooraf zou een typefout in het runId dezelfde
 * 409 opleveren als een backfill die gewoon nog loopt, en dan zoek je de fout
 * in de wachtrij in plaats van in de URL.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { error } = await requireAuth(["admin"]);
  if (error) return error;

  const { runId } = await params;

  const bestaat = await prisma.syncJob.count({ where: { runId, source: "backfill" } });
  if (bestaat === 0) {
    return NextResponse.json({ error: "Unknown backfill." }, { status: 404 });
  }

  const resumed = await resumeBackfill(runId);
  if (resumed === 0) {
    return NextResponse.json(
      { error: "Nothing to resume — this backfill has no failed or cancelled jobs." },
      { status: 409 }
    );
  }

  return NextResponse.json({ resumed });
}
