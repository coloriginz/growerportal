import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireImportAuth, normalizeImportKeys, summariseImportError } from "@/lib/import-auth";

type Handler<Row> = (
  rows: Row[],
  batchId: string | null
) => Promise<{
  created: number;
  updated: number;
  skipped: number;
  details?: Record<string, unknown>;
  extra?: Record<string, unknown>;
}>;

type Options<Row> = {
  endpoint: string;
  /**
   * De sleutel waaronder de rijen in de body staan, bv. "costs". Meerdere
   * waarden mag: dan wordt de eerste gebruikt die een array bevat.
   *
   * Dat is nodig omdat de sleutel bij één endpoint afwijkt van de endpoint-naam.
   * De lots-route heet `lots` maar verwachtte alleen `partijen`, een naam uit de
   * DAX-tijd. De portal-gestuurde sync bouwt de sleutel op uit de endpoint-naam
   * en stuurt dus `lots`. Beide accepteren houdt de oude flows werkend zonder de
   * nieuwe te breken.
   */
  bodyKey: string | readonly string[];
  rowSchema: z.ZodType<Row>;
  schemaKeys: readonly string[];
  aliases?: Readonly<Record<string, readonly string[]>>;
  handler: Handler<Row>;
};

/**
 * Draagt het patroon dat alle vijf de import-routes delen.
 *
 * De batch wordt hergebruikt als de aanroeper een batchId meestuurt. Dat doet de
 * portal-gestuurde sync, die de batch al opent bij het versturen zodat stilte
 * zichtbaar is. Zonder batchId maakt deze omhulling er zelf een, precies zoals
 * de routes het altijd deden — daardoor kunnen de oude DAX-flows blijven draaien
 * tijdens de overstap.
 */
export async function runImport<Row>(
  request: NextRequest,
  options: Options<Row>
): Promise<NextResponse> {
  const authError = requireImportAuth(request);
  if (authError) return authError;

  const startTime = Date.now();
  const body = await request.json();
  const providedBatchId = typeof body.batchId === "string" ? body.batchId : null;

  let batchId: string | null = providedBatchId;
  if (!batchId) {
    try {
      const created = await prisma.importBatch.create({
        data: { endpoint: options.endpoint, status: "running" },
      });
      batchId = created.id;
    } catch {
      // Batch logging should not block the import
    }
  }

  const finish = async (data: Record<string, unknown>) => {
    if (!batchId) return;
    try {
      await prisma.importBatch.update({
        where: { id: batchId },
        data: { ...data, durationMs: Date.now() - startTime, completedAt: new Date() },
      });
    } catch {
      // Batch logging should not block the import
    }
  };

  // Een ontbrekende of niet-array sleutel is een fout, geen lege import. Anders
  // levert een flow die de verkeerde sleutel stuurt een geslaagde import van
  // niets op — precies de stilte die dit ontwerp zichtbaar hoort te maken.
  // Een lege array blijft geldig: dat is wat een rustige nacht oplevert.
  const accepted = Array.isArray(options.bodyKey) ? options.bodyKey : [options.bodyKey];
  const usedKey = accepted.find((key) => Array.isArray(body[key]));
  const rawRows = usedKey === undefined ? undefined : body[usedKey];
  if (!Array.isArray(rawRows)) {
    const problem = {
      error: `Body key ${accepted.map((k) => `"${k}"`).join(" or ")} is missing or not an array`,
      expectedKey: accepted.length === 1 ? accepted[0] : accepted,
      received: accepted.some((k) => k in body)
        ? accepted
            .filter((k) => k in body)
            .map((k) => `${k}: ${body[k] === null ? "null" : typeof body[k]}`)
            .join(", ")
        : "missing",
      keysReceived:
        body && typeof body === "object" && !Array.isArray(body) ? Object.keys(body) : [],
    };
    const summary = JSON.stringify(problem);
    await finish({ status: "error", errorMessage: summary });
    await markJobFailed(batchId, summary);
    return NextResponse.json({ error: problem }, { status: 400 });
  }

  const rows = normalizeImportKeys(rawRows, options.schemaKeys, options.aliases ?? {});

  const parsed = z.object({ rows: z.array(options.rowSchema) }).safeParse({ rows });
  if (!parsed.success) {
    const summary = summariseImportError(parsed.error.issues, rows, options.schemaKeys);
    await finish({ status: "error", errorMessage: summary });
    await markJobFailed(batchId, summary);
    return NextResponse.json({ error: JSON.parse(summary) }, { status: 400 });
  }

  try {
    const result = await options.handler(parsed.data.rows, batchId);
    await finish({
      status: "success",
      recordsReceived: parsed.data.rows.length,
      recordsCreated: result.created,
      recordsUpdated: result.updated,
      recordsSkipped: result.skipped,
      ...(result.details ? { details: result.details } : {}),
    });
    await markJobDone(batchId);
    return NextResponse.json({
      received: parsed.data.rows.length,
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      ...(result.extra ?? {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finish({ status: "error", errorMessage: message });
    await markJobFailed(batchId, message);
    throw error;
  }
}

async function markJobDone(batchId: string | null) {
  if (!batchId) return;
  try {
    await prisma.syncJob.updateMany({
      where: { importBatchId: batchId, status: "dispatched" },
      data: { status: "done", completedAt: new Date() },
    });
  } catch {
    // De import is geslaagd; de jobstatus mag dat niet ongedaan maken.
  }
}

async function markJobFailed(batchId: string | null, message: string) {
  if (!batchId) return;
  try {
    await prisma.syncJob.updateMany({
      where: { importBatchId: batchId, status: "dispatched" },
      data: { status: "failed", lastError: message.slice(0, 1000), completedAt: new Date() },
    });
  } catch {
    // idem
  }
}
