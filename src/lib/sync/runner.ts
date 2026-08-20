import { randomUUID } from "crypto";
import { prisma } from "@/lib/db";
import { isDue, windowForEndpoint, type ScheduleState } from "./schedule";
import { backfillJobs, quarterChunks, quarterLabel } from "./backfill";
import { inChainOrder, isSyncEndpoint, type SyncEndpoint } from "./types";
import { buildQuery } from "./queries";
import { fetchInto, describeError, DispatchError } from "./dispatch";

/** Een job die langer dan dit onderweg is, is dood. */
const STALE_MINUTES = 15;

/**
 * Een batch zonder job die langer dan dit op 'running' staat, is dood. Ruim
 * boven de 300 seconden functielimiet van de import-routes, dus een import die
 * nog echt aan het werk is raakt hij niet.
 */
const ORPHAN_BATCH_MINUTES = 60;

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
          source: schedule.name,
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

/**
 * Zet een ronde klaar zonder naar het schema te kijken. Voor de knop "run now":
 * lastRunAt wordt gewoon gestempeld, zodat de eerstvolgende tick er niet nóg een
 * ronde bovenop zet.
 */
export async function enqueueRunNow(name: string, now: Date = new Date()): Promise<number> {
  const schedule = await prisma.syncSchedule.findUnique({ where: { name } });
  if (!schedule) throw new Error(`Unknown schedule '${name}'`);
  return enqueueRun(schedule, now);
}

export type BackfillPlan = { chunks: number; jobs: number; from: Date; to: Date };

/**
 * Wat een backfill gaat kosten, zonder iets klaar te zetten. De bevestiging in
 * het scherm draait hierop, en bewust niet op een telling uit Fabric: dat zou
 * de knop afhankelijk maken van een flow die aantoonbaar uit kan vallen — op
 * 19 augustus lag die anderhalve dag plat.
 */
export function planBackfill(startDate: Date, now: Date = new Date()): BackfillPlan {
  const chunks = quarterChunks(startDate, now);
  return {
    chunks: chunks.length,
    jobs: backfillJobs(chunks).length,
    from: chunks[0]?.from ?? startDate,
    to: chunks[chunks.length - 1]?.to ?? startDate,
  };
}

/**
 * Een backfill is klaargezet, of hij is geweigerd met een reden die op het
 * scherm mag. Geen exception: de twee weigeringen hieronder zijn verwachte
 * antwoorden, geen storingen. Wie ze als `Error` gooit dwingt zijn aanroeper
 * tot een `catch` die er niet van te onderscheiden is als de database wegvalt —
 * dan wordt een uitgevallen Neon een 409 met "er loopt al een backfill".
 */
export type EnqueueBackfillResult =
  | { ok: true; runId: string; jobs: number }
  | { ok: false; reason: "already_running" | "nothing_to_backfill"; message: string };

/**
 * Zet een backfill klaar voor één leverancier: kwekers vooraan, daarna per
 * kalenderkwartaal partijen, orderregels en kosten, alles onder één runId.
 *
 * Weigert als er al een open backfill voor hem staat: twee tegelijk leveren
 * dezelfde upserts op en maken de voortgang onleesbaar. Die controle is
 * advies, geen slot — twee gelijktijdige aanroepen kunnen er allebei langs.
 * Dat is aanvaard: dit hangt achter een admin-knop die met de hand wordt
 * ingedrukt, en het ergste gevolg is dubbel werk, geen verkeerde data.
 *
 * Geen transactie om de `createMany` heen, anders dan bij `enqueueRun`. Die
 * heeft er één omdat hij twee dingen schrijft — de jobs én `lastRunAt` — en een
 * halve schrijfactie daar dezelfde ronde nog eens laat klaarzetten. Hier is het
 * één statement, en dat is in Postgres al atomair.
 */
export async function enqueueBackfill(
  supplierFabricId: number,
  startDate: Date,
  now: Date = new Date()
): Promise<EnqueueBackfillResult> {
  const bestaand = await prisma.syncJob.findFirst({
    where: {
      supplierFabricId,
      source: "backfill",
      status: { in: ["pending", "dispatched"] },
    },
    select: { runId: true },
  });
  if (bestaand) {
    return {
      ok: false,
      reason: "already_running",
      message: `A backfill for this supplier is already running (${bestaand.runId}).`,
    };
  }

  const specs = backfillJobs(quarterChunks(startDate, now));
  if (specs.length === 0) {
    return {
      ok: false,
      reason: "nothing_to_backfill",
      message: "The backfill start date is in the future; there is nothing to backfill.",
    };
  }

  const runId = randomUUID();
  await prisma.syncJob.createMany({
    data: specs.map((spec) => ({
      runId,
      sequence: spec.sequence,
      endpoint: spec.endpoint,
      windowFrom: spec.from,
      windowTo: spec.to,
      supplierFabricId,
      source: "backfill",
      priority: 1,
    })),
  });

  return { ok: true, runId, jobs: specs.length };
}

export type OpenBackfill = {
  runId: string;
  supplierFabricId: number;
  total: number;
  done: number;
  failed: number;
  /** Waar hij nu is, als "lots 2025 Q3"; null als er niets meer wacht. */
  current: string | null;
  /** Zijn eerstvolgende brok staat klaar, maar een geplande ronde gaat voor. */
  waitingOnRound: boolean;
};

/**
 * De backfills die nog niet klaar zijn, met hun voortgang, voor de kaart in het
 * scherm. Een afgeronde backfill verdwijnt; zijn historie staat in de batchlijst.
 *
 * De jobs in twee stappen in plaats van één: eerst de runIds die nog een job
 * hebben die niet `done` is, dan alleen de jobs van die runs. Alles ophalen en
 * in geheugen filteren werkt vandaag — vierendertig rijen per backfill — maar
 * dan groeit wat er over de lijn komt met elke backfill die ooit gedraaid
 * heeft, terwijl het antwoord juist krimpt.
 */
export async function openBackfills(): Promise<OpenBackfill[]> {
  const openRuns = await prisma.syncJob.findMany({
    where: { source: "backfill", status: { not: "done" } },
    select: { runId: true },
    distinct: ["runId"],
  });
  if (openRuns.length === 0) return [];

  const jobs = await prisma.syncJob.findMany({
    where: { runId: { in: openRuns.map((r) => r.runId) } },
    select: {
      runId: true,
      supplierFabricId: true,
      status: true,
      sequence: true,
      endpoint: true,
      windowFrom: true,
    },
    orderBy: [{ runId: "asc" }, { sequence: "asc" }],
  });

  const perRun = new Map<string, typeof jobs>();
  for (const job of jobs) {
    const rijen = perRun.get(job.runId);
    if (rijen) rijen.push(job);
    else perRun.set(job.runId, [job]);
  }

  // Dat een backfill op een geplande ronde wacht is niet aan zijn eigen rijen te
  // zien: het zit in de sortering van claimNextJob. Staat er ergens een job met
  // priority 0 open, dan pakt de claim die eerst — pending omdat de sortering
  // hem voorrang geeft, dispatched omdat er er maar één tegelijk uit staat. Eén
  // vraag beantwoordt dat voor alle backfills tegelijk.
  const geplandeRonde = await prisma.syncJob.findFirst({
    where: { priority: 0, status: { in: ["pending", "dispatched"] } },
    select: { id: true },
  });

  const backfills: OpenBackfill[] = [];
  for (const [runId, rijen] of perRun) {
    // `supplierFabricId` is nullable in het schema omdat een geplande ronde hem
    // leeg laat. Bij een backfill vult enqueueBackfill hem altijd, maar het type
    // weet dat niet en met de hand aangemaakte rijen ook niet. Zo'n run is niet
    // te tonen — de kaart heeft er de leverancier bij nodig — dus hij valt weg.
    const supplierFabricId = rijen[0].supplierFabricId;
    if (supplierFabricId === null) continue;

    const lopend =
      rijen.find((r) => r.status === "dispatched") ?? rijen.find((r) => r.status === "pending");

    backfills.push({
      runId,
      supplierFabricId,
      total: rijen.length,
      done: rijen.filter((r) => r.status === "done").length,
      failed: rijen.filter((r) => r.status === "failed").length,
      // Het kwartaal, niet de begindatum van het venster: "2025 Q3" is wat het
      // scherm vraagt en wat de brok in de bevestiging ook heette. Volgnummer 0
      // is de stamdata-job, die alle kwartalen overspant en dus bij geen enkel
      // hoort.
      current: lopend
        ? lopend.sequence === 0
          ? lopend.endpoint
          : `${lopend.endpoint} ${quarterLabel(lopend.windowFrom)}`
        : null,
      // Alleen als zijn eigen brok nog wacht. Staat die op `dispatched`, dan is
      // hij zelf aan de beurt en wacht hij nergens op — ook niet op de ronde die
      // daarna komt.
      waitingOnRound: geplandeRonde !== null && lopend?.status === "pending",
    });
  }

  return backfills;
}

/**
 * Zet een gestrande backfill weer aan vanaf de brok waar hij bleef steken.
 * Retourneert het aantal jobs dat weer op `pending` staat.
 *
 * Een gefaalde job annuleert de rest van zijn run — streng, en terecht, want
 * een gat middenin een backfill ziet niemand terug. Maar zonder hervatten begin
 * je na een storing in kwartaal negen weer bij kwartaal één. De vensters staan
 * al gematerialiseerd op de geannuleerde jobs, dus hervatten is niet meer dan
 * ze terugzetten en de gefaalde job zijn pogingen teruggeven.
 *
 * Het statusfilter is de hele veiligheid. `done` valt erbuiten, anders haalt
 * elke hervatting het hele verleden opnieuw op; `dispatched` en `pending` ook,
 * dus een backfill die nog loopt wordt hier niet uit zijn ritme gehaald. En een
 * teruggezette job kan pas aan de beurt komen als zijn voorganger `done` is —
 * dat bewaakt claimNextJob al.
 *
 * Geen transactie eromheen: één updateMany is één statement, en dat is in
 * Postgres al atomair.
 */
export async function resumeBackfill(runId: string): Promise<number> {
  const hersteld = await prisma.syncJob.updateMany({
    // Alleen backfills: een geannuleerde geplande ronde terugzetten zou een
    // venster van weken geleden opnieuw ophalen, en dat lost het schema zelf op.
    where: { runId, source: "backfill", status: { in: ["failed", "cancelled"] } },
    data: {
      status: "pending",
      attempts: 0,
      lastError: null,
      dispatchedAt: null,
      completedAt: null,
    },
  });

  return hersteld.count;
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
 * Claimt de volgende job in één atomaire stap. De twee NOT EXISTS-clausules en
 * de sortering dragen samen de drie regels van het systeem:
 *   1. er staat er hoogstens één tegelijk uit
 *   2. binnen een ronde is de vorige klaar voordat de volgende gaat
 *   3. een backfill komt pas aan de beurt als er geen geplande ronde wacht
 *
 * Die derde regel is enkel deze ORDER BY. Een extra NOT EXISTS is overbodig:
 * staat er een gewone job te wachten, dan pakt de sortering die per definitie
 * eerst. Een lopende backfill-job wordt niet afgebroken — hij maakt zijn brok
 * af en de rest van de backfill wacht tot de ronde klaar is.
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
      ORDER BY j.priority, j."createdAt", j.sequence
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
 * Een backfill is één runId over al zijn kwartalen — dat is het enige wat de
 * kwekers vóór alle kwartalen houdt — dus een gestrande brok annuleert daar de
 * hele rest van de backfill. Streng, en terecht: een gat middenin ziet niemand
 * terug. `resumeBackfill` zet hem daarna terug op het gestrande kwartaal.
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
export async function reapStaleJobs(
  now: Date
): Promise<{ reaped: number; orphanBatches: number }> {
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

  return { reaped: stale.length, orphanBatches: await reapOrphanBatches(now) };
}

/**
 * De lus hierboven vindt vastlopers via SyncJob.importBatchId. Een batch waar
 * nooit een job bij hoorde — een handmatige import, of een oude flow die is
 * omgevallen — blijft daardoor eeuwig op 'running' staan en telt mee als
 * "loopt nog" in het admin-scherm. Die zet dit op 'error'.
 *
 * De leeftijdsgrens is de hele veiligheid: hij mag geen import raken die nog
 * bezig is. Daarom ORPHAN_BATCH_MINUTES ruim boven de functielimiet, en de
 * NOT EXISTS zodat een batch waar wél een job bij hoort altijd van de lus
 * hierboven blijft.
 */
async function reapOrphanBatches(now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - ORPHAN_BATCH_MINUTES * 60000);
  const message = `Opgeruimd: stond langer dan ${ORPHAN_BATCH_MINUTES} minuten op 'running' zonder dat er ooit een afronding kwam`;

  return prisma.$executeRaw`
    UPDATE "ImportBatch" b SET
      status = 'error',
      "errorMessage" = ${message},
      "completedAt" = ${now}
    WHERE b.status = 'running'
      AND b."startedAt" < ${cutoff}
      AND NOT EXISTS (
        SELECT 1 FROM "SyncJob" j WHERE j."importBatchId" = b.id
      )`;
}

/** Eén tick: opruimen, kijken of er een ronde due is, en de volgende versturen. */
export async function tick(now: Date = new Date()) {
  const { reaped, orphanBatches } = await reapStaleJobs(now);

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

  return { reaped, orphanBatches, enqueued, dispatched, failed };
}
