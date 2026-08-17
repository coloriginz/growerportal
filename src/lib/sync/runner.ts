import { randomUUID } from "crypto";
import { prisma } from "@/lib/db";
import { isDue, windowForEndpoint, type ScheduleState } from "./schedule";
import { inChainOrder, isSyncEndpoint, type SyncEndpoint } from "./types";
import { buildQuery } from "./queries";
import { fetchInto, describeError, DispatchError } from "./dispatch";

/** Een job die langer dan dit onderweg is, is dood. */
const STALE_MINUTES = 15;

/** Zoveel pogingen krijgt een job voordat hij zijn ronde meesleurt. */
const MAX_ATTEMPTS = 3;

/**
 * Zet één ronde klaar: per endpoint een job, in de verplichte volgorde.
 * Retourneert het aantal aangemaakte jobs.
 */
export async function enqueueRun(
  schedule: ScheduleState & { endpoints: string[]; windowOverrides?: unknown },
  now: Date
): Promise<number> {
  const endpoints = inChainOrder(schedule.endpoints);
  if (endpoints.length === 0) return 0;

  const runId = randomUUID();

  // In één transactie: valt het proces tussen beide schrijfacties om, dan staan
  // de jobs klaar terwijl het schema nog due is en zet de volgende tick dezelfde
  // ronde nog eens klaar.
  await prisma.$transaction(async (tx) => {
    await tx.syncJob.createMany({
      // Het venster staat gematerialiseerd op de job, dus een retry haalt exact
      // hetzelfde op. Per endpoint berekend: costs kijkt verder terug dan de rest.
      data: endpoints.map((endpoint, index) => {
        const window = windowForEndpoint(schedule, endpoint, now);
        return {
          runId,
          sequence: index,
          endpoint,
          windowFrom: window.from,
          windowTo: window.to,
          source: schedule.name === "nightly" ? "nightly" : "schedule",
        };
      }),
    });

    await tx.syncSchedule.update({
      where: { name: schedule.name },
      data: { lastRunAt: now },
    });
  });

  return endpoints.length;
}

type ClaimedJob = {
  id: string;
  endpoint: string;
  windowFrom: Date;
  windowTo: Date;
  supplierFabricId: number | null;
  /** Al opgehoogd door de claim: bij de eerste poging staat hier 1. */
  attempts: number;
};

/**
 * Claimt de volgende job in één atomaire stap. De twee NOT EXISTS-clausules
 * dragen de beide regels van het systeem:
 *   1. er staat er hoogstens één tegelijk uit
 *   2. binnen een ronde is de vorige klaar voordat de volgende gaat
 *
 * Twee ticks die elkaar overlappen kunnen in het uiterste geval allebei een job
 * claimen uit verschillende rondes — de volgorde binnen een ronde blijft dan
 * intact, en dat is de eigenschap die telt.
 */
async function claimNextJob(): Promise<ClaimedJob | null> {
  const rows = await prisma.$queryRaw<ClaimedJob[]>`
    UPDATE "SyncJob" SET
      status = 'dispatched',
      "dispatchedAt" = NOW(),
      attempts = attempts + 1
    WHERE id = (
      SELECT j.id FROM "SyncJob" j
      WHERE j.status = 'pending'
        AND NOT EXISTS (SELECT 1 FROM "SyncJob" d WHERE d.status = 'dispatched')
        AND NOT EXISTS (
          SELECT 1 FROM "SyncJob" p
          WHERE p."runId" = j."runId" AND p.sequence < j.sequence AND p.status <> 'done'
        )
      ORDER BY j."createdAt", j.sequence
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, endpoint, "windowFrom", "windowTo", "supplierFabricId", attempts`;

  return rows[0] ?? null;
}

/**
 * Verstuurt de volgende job, als er een klaarstaat.
 *
 * Twee losse velden in plaats van één job-id: de cron-ingang moet kunnen zien
 * of er zojuist iets hard misging of dat er simpelweg niets te doen was. Beide
 * `null` betekent: de wachtrij was leeg, er stond er al één uit, of de job is na
 * een tijdelijke fout teruggezet en probeert het straks nog eens.
 */
export async function dispatchNext(): Promise<{
  dispatched: string | null;
  failed: string | null;
}> {
  const job = await claimNextJob();
  if (!job) return { dispatched: null, failed: null };

  if (!isSyncEndpoint(job.endpoint)) {
    await failJob(job.id, `Onbekend endpoint: ${job.endpoint}`);
    return { dispatched: null, failed: job.id };
  }

  const batch = await prisma.importBatch.create({
    data: { endpoint: job.endpoint, status: "running" },
  });
  await prisma.syncJob.update({
    where: { id: job.id },
    data: { importBatchId: batch.id },
  });

  try {
    // supplierFabricId is nullable in de database maar niet in QueryWindow: een
    // ontbrekend id mag geen leeg filter worden, want dan haalt de query het hele
    // warehouse op in plaats van één leverancier. Hier is dat onschadelijk omdat
    // een reguliere ronde geen filter hoort te hebben; plan 2 moet bij het
    // klaarzetten van een backfill afdwingen dat het id gevuld is.
    const query = buildQuery(job.endpoint as SyncEndpoint, {
      from: job.windowFrom,
      to: job.windowTo,
      supplierFabricId: job.supplierFabricId ?? undefined,
    });
    await fetchInto(job.endpoint as SyncEndpoint, batch.id, query);
    return { dispatched: job.id, failed: null };
  } catch (error) {
    // describeError haalt ook undici's `cause` op: "fetch failed" alleen zegt niets.
    const message = describeError(error);

    if (isTransient(error) && job.attempts < MAX_ATTEMPTS) {
      // Een luide, goedkoop te herhalen fout mag de ronde niet kosten: terug in
      // de wachtrij op zijn eigen plek, de rest van de ronde blijft staan.
      await retryJob(job.id, message, batch.id);
      console.warn(
        `[sync] job ${job.id} (${job.endpoint}) poging ${job.attempts}/${MAX_ATTEMPTS} mislukt, opnieuw in de wachtrij: ${message}`
      );
      return { dispatched: null, failed: null };
    }

    await failJob(job.id, message, batch.id);
    return { dispatched: null, failed: job.id };
  }
}

/**
 * Mag deze fout opnieuw geprobeerd worden? Alleen als het aan de overkant lag en
 * vanzelf over kan gaan: een netwerkfout of timeout (DispatchError zonder
 * status), throttling (429), of een gateway die omviel (5xx).
 *
 * Een andere 4xx is een configuratiefout — 401 met een verkeerde sleutel gaat
 * met herhalen niet weg. Alles wat geen DispatchError is (een gooiende
 * buildQuery bijvoorbeeld) is ontbrekende code, en die schrijft zichzelf niet.
 */
function isTransient(error: unknown): boolean {
  if (!(error instanceof DispatchError)) return false;
  if (error.status === undefined) return true;
  return error.status === 429 || error.status >= 500;
}

/** Terug in de wachtrij, zonder de ronde af te breken. */
async function retryJob(jobId: string, message: string, batchId: string) {
  await prisma.syncJob.update({
    where: { id: jobId },
    data: { status: "pending", dispatchedAt: null, lastError: message.slice(0, 1000) },
  });
  await prisma.importBatch.update({
    where: { id: batchId },
    data: { status: "error", errorMessage: message.slice(0, 1000), completedAt: new Date() },
  });
}

async function failJob(jobId: string, message: string, batchId?: string) {
  await prisma.syncJob.update({
    where: { id: jobId },
    data: { status: "failed", lastError: message.slice(0, 1000), completedAt: new Date() },
  });
  if (batchId) {
    await prisma.importBatch.update({
      where: { id: batchId },
      data: { status: "error", errorMessage: message.slice(0, 1000), completedAt: new Date() },
    });
  }
  await cancelRestOfRun(jobId);
}

/**
 * Een gefaalde job breekt de rest van zijn ronde af. Orders die verwijzen naar
 * partijen die er niet zijn worden stil weggegooid; een halve ronde die je ziet
 * is beter dan een hele die gaten trekt.
 *
 * Bij een backfill geldt dit alleen binnen de brok: elke brok is een eigen
 * runId en de andere brokken lopen gewoon door.
 */
async function cancelRestOfRun(jobId: string): Promise<void> {
  const job = await prisma.syncJob.findUnique({
    where: { id: jobId },
    select: { runId: true, sequence: true },
  });
  if (!job) return;

  await prisma.syncJob.updateMany({
    where: { runId: job.runId, sequence: { gt: job.sequence }, status: "pending" },
    data: { status: "cancelled", completedAt: new Date() },
  });
}

/**
 * Ruimt jobs op die verstuurd zijn maar nooit iets terugstuurden: de flow is
 * gevallen, de SQL liep vast, of de terugpost kwam niet aan. Zonder dit blijft
 * een batch eeuwig op 'running' staan — precies het gat dat er nu zit.
 */
export async function reapStaleJobs(now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_MINUTES * 60000);
  const stale = await prisma.syncJob.findMany({
    where: { status: "dispatched", dispatchedAt: { lt: cutoff } },
    select: { id: true, attempts: true, importBatchId: true },
  });

  for (const job of stale) {
    const message = `Geen resultaat binnen ${STALE_MINUTES} minuten`;
    // Drie pogingen: opnieuw ophalen is veilig omdat alle endpoints upserten.
    const retry = job.attempts < MAX_ATTEMPTS;

    await prisma.syncJob.update({
      where: { id: job.id },
      data: retry
        ? { status: "pending", dispatchedAt: null, lastError: message }
        : { status: "failed", lastError: message, completedAt: now },
    });

    if (job.importBatchId) {
      await prisma.importBatch.update({
        where: { id: job.importBatchId },
        data: { status: "error", errorMessage: message, completedAt: now },
      });
    }
    if (!retry) await cancelRestOfRun(job.id);
  }

  return stale.length;
}

/** Eén tick: opruimen, kijken of er een ronde due is, en de volgende versturen. */
export async function tick(now: Date = new Date()) {
  const reaped = await reapStaleJobs(now);

  // De volgorde bepaalt welke ronde als eerste in de wachtrij belandt. De
  // nachtronde gaat voor: die brengt suppliers en growers mee, en zonder die
  // twee gooit de lots-import partijen stilzwijgend weg. Schema's op tijdstip
  // (atTime gevuld) dus vóór schema's op interval, met de naam als tiebreaker
  // zodat de volgorde ook bij een derde schema vastligt.
  const schedules = await prisma.syncSchedule.findMany({
    orderBy: [{ atTime: { sort: "asc", nulls: "last" } }, { name: "asc" }],
  });
  let enqueued = 0;
  for (const schedule of schedules) {
    if (isDue(schedule, now)) enqueued += await enqueueRun(schedule, now);
  }

  const { dispatched, failed } = await dispatchNext();

  // Een gefaalde ronde is verder nergens zichtbaar: enqueueRun stempelt
  // lastRunAt bij het klaarzetten, dus het "overdue"-alarm gaat hier niet van
  // af. De functielogs zijn vandaag het enige kanaal dat er is.
  if (failed) {
    const job = await prisma.syncJob.findUnique({
      where: { id: failed },
      select: { endpoint: true, lastError: true },
    });
    console.warn(`[sync] job ${failed} (${job?.endpoint}) gefaald: ${job?.lastError}`);
  }

  return { reaped, enqueued, dispatched, failed };
}
