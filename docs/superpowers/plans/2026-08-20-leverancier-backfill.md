# Backfill per leverancier — implementatieplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** een leverancier die je aanzet krijgt zijn hele historie vanaf een instelbare basisdatum, opgehaald in kwartaalbrokken die de dagelijkse sync niet in de weg zitten.

**Architecture:** de bestaande wachtrij doet al het werk. Een backfill is één `runId` met jobs in ketenvolgorde — kwekers vooraan, daarna per kalenderkwartaal partijen, orderregels en kosten. Een nieuwe kolom `priority` zorgt dat een gewone ronde altijd voorgaat. Het onderstel bestond al: `SyncJob.supplierFabricId` en de vier query-builders accepteren een leverancier; er was alleen nooit iets dat het veld vulde.

**Tech Stack:** Next.js 15 App Router, Prisma 6 op Neon, Zod 4, shadcn/ui op Base UI, Remix Icons, sonner.

**Spec:** [docs/superpowers/specs/2026-08-20-leverancier-backfill-design.md](../specs/2026-08-20-leverancier-backfill-design.md)

## Global Constraints

- UI-teksten in het **Engels**; comments in de stijl van de omringende code (die is Nederlands in `src/lib/sync/`).
- Comments leggen uit **waarom**, niet wat. Dichtheid als de buren.
- Geen `any` zonder noodzaak.
- **`prisma db push` werkt niet op dit werkstation**: poort 5432 is dicht, elke Prisma-verbinding vanaf de commandline eindigt op P1001. Schemawijzigingen worden met de hand toegepast via de Neon HTTP-driver, met exact de SQL die Prisma zou genereren. Productie heeft diezelfde SQL later apart nodig.
- **Geen dev-server** (`npm run dev` faalt op Windows) en **geen `next build`** tijdens het werk. Verifiëren met `npx tsc --noEmit`, `npx next lint` en `npm run check`.
- De testdatabase bevragen via `@neondatabase/serverless`:
  ```js
  require("dotenv").config({ quiet: true });
  const { neon } = require("@neondatabase/serverless");
  const sql = neon(process.env.DATABASE_URL);
  ```
  Tijdelijke scripts heten `scripts/tmp-*.js` en worden opgeruimd vóór de commit.
- Fabric is rechtstreeks te bevragen met `node scripts/fabric-query.js "SELECT ..."` (device-code login, token gecachet).
- **Paginering en sortering:** een `ORDER BY` op een niet-unieke sleutel plus `OFFSET` laat rijen springen. Sluit altijd af met een unieke kolom.
- **Tailwind:** de basis-`DialogContent` draagt `sm:max-w-sm`. Een `max-w-*` zonder `sm:`-prefix werkt niet op desktop.
- **Base UI `SelectValue`** toont de rauwe waarde, niet het label. Geef een functie als children mee als de waarde een id is.

---

## Bestandsindeling

| bestand | verantwoordelijkheid |
|---|---|
| `src/lib/sync/backfill.ts` | **nieuw** — kwartaalindeling en joblijst, pure functies zonder database |
| `scripts/checks/backfill.ts` | **nieuw** — controles op die pure functies |
| `prisma/schema.prisma` | `SyncJob.priority`, index aangepast |
| `src/lib/sync/runner.ts` | `enqueueBackfill()`, `resumeBackfill()`, `claimNextJob()` sorteert op priority |
| `src/lib/sync/settings.ts` | **nieuw** — lezen en schrijven van `sync.backfillStartDate` |
| `src/app/api/sync/settings/route.ts` | **nieuw** — `GET`/`PUT`, admin-only |
| `src/app/api/sync/backfill/route.ts` | **nieuw** — `POST` start, `GET` toont open backfills |
| `src/app/api/sync/backfill/[runId]/resume/route.ts` | **nieuw** — `POST` hervat |
| `src/app/api/admin/fabric-relations/route.ts` | `POST` accepteert `backfill: boolean` |
| `src/app/(portal)/admin/imports/backfill-card.tsx` | **nieuw** — voortgangskaart |
| `src/app/(portal)/admin/imports/schedules-tab.tsx` | datumveld + de kaart inhangen |
| `src/app/(portal)/admin/imports/skipped-dialog.tsx` | bevestiging vóór activeren |
| `src/app/(portal)/suppliers/[id]/supplier-detail.tsx` | backfill-knop op een bestaande leverancier |

---

### Task 1: De kwartaalindeling

**Files:**
- Create: `src/lib/sync/backfill.ts`
- Create: `scripts/checks/backfill.ts`
- Modify: `package.json` (het `check`-script)

**Interfaces:**
- Consumes: `SyncEndpoint` uit `src/lib/sync/types.ts`
- Produces:
  ```ts
  export type BackfillChunk = { from: Date; to: Date; label: string };
  export function quarterChunks(startDate: Date, now: Date): BackfillChunk[];
  export type BackfillJobSpec = { sequence: number; endpoint: SyncEndpoint; from: Date; to: Date; label: string | null };
  export function backfillJobs(chunks: readonly BackfillChunk[]): BackfillJobSpec[];
  ```

- [x] **Step 1: Schrijf de controles (dit faalt nog)**

Create `scripts/checks/backfill.ts`, in de vorm van `scripts/checks/purchase-type.ts`:

```ts
import { quarterChunks, backfillJobs } from "../../src/lib/sync/backfill";

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) console.log(`PASS ${label}`);
  else {
    failures++;
    console.log(`FAIL ${label}${detail ? " — " + detail : ""}`);
  }
}

const d = (s: string) => new Date(s + "T00:00:00.000Z");

// Een basisdatum middenin een kwartaal begint bij het begin van dat kwartaal:
// anders mist de eerste brok de leveringen van januari en februari.
const midden = quarterChunks(d("2024-02-14"), d("2024-05-05"));
check("begint bij het begin van het kwartaal",
  midden[0].from.toISOString().startsWith("2024-01-01"));
check("het lopende kwartaal telt mee", midden.length === 2);
check("de laatste brok loopt tot het volgende kwartaal",
  midden[1].to.toISOString().startsWith("2024-07-01"));
check("brokken sluiten op elkaar aan",
  midden[0].to.getTime() === midden[1].from.getTime(),
  "een gat tussen twee brokken is data die niemand ooit ophaalt");
check("het label is leesbaar", midden[0].label === "2024 Q1" && midden[1].label === "2024 Q2");

// Elf kwartalen van 2024 Q1 tot en met 2026 Q3.
check("2024-01-01 tot augustus 2026 is elf kwartalen",
  quarterChunks(d("2024-01-01"), d("2026-08-20")).length === 11);

check("een basisdatum in de toekomst levert niets op",
  quarterChunks(d("2027-01-01"), d("2026-08-20")).length === 0,
  "liever nul brokken dan een backfill die achteruit loopt");

check("dezelfde invoer levert dezelfde vensters",
  JSON.stringify(quarterChunks(d("2024-02-14"), d("2024-05-05"))) === JSON.stringify(midden),
  "een tweede backfill moet met de eerste te vergelijken zijn");

// De joblijst.
const jobs = backfillJobs(quarterChunks(d("2026-01-01"), d("2026-08-20")));
check("kwekers staan vooraan", jobs[0].endpoint === "growers" && jobs[0].sequence === 0,
  "de lots-import gooit partijen weg waarvan de kweker ontbreekt");
check("kwekers krijgen de volle spanwijdte",
  jobs[0].from.toISOString().startsWith("2026-01-01") &&
  jobs[0].to.toISOString().startsWith("2026-10-01"));
check("drie endpoints per kwartaal", jobs.length === 1 + 3 * 3);
check("de ketenvolgorde klopt binnen een kwartaal",
  jobs[1].endpoint === "lots" && jobs[2].endpoint === "orders" && jobs[3].endpoint === "costs");
check("volgnummers lopen door zonder gat",
  jobs.every((j, i) => j.sequence === i),
  "de wachtrij wacht op het vorige volgnummer; een gat zet alles stil");
check("leveranciers zitten er niet bij",
  jobs.every((j) => j.endpoint !== "suppliers"),
  "die bestaat al — dat is de aanleiding voor de backfill");

console.log(failures === 0 ? "\nalle controles geslaagd" : `\n${failures} controle(s) gefaald`);
process.exit(failures === 0 ? 0 : 1);
```

- [x] **Step 2: Draai het en zie het falen**

Run: `npx tsx scripts/checks/backfill.ts`
Expected: FAIL, `quarterChunks` bestaat nog niet.

- [x] **Step 3: Schrijf de functies**

Create `src/lib/sync/backfill.ts`:

```ts
import type { SyncEndpoint } from "./types";

/** Eén kalenderkwartaal: `from` inclusief, `to` exclusief. */
export type BackfillChunk = { from: Date; to: Date; label: string };

/** Het begin van het kwartaal waar deze datum in valt, in UTC. */
function quarterStart(date: Date): Date {
  const start = new Date(Date.UTC(date.getUTCFullYear(), Math.floor(date.getUTCMonth() / 3) * 3, 1));
  return start;
}

function addQuarter(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 3, 1));
}

/**
 * De brokken van een backfill: kalenderkwartalen vanaf het kwartaal waarin de
 * basisdatum valt tot en met het kwartaal van nu.
 *
 * Kalenderkwartalen en niet "elke negentig dagen vanaf de basisdatum": ze zijn
 * leesbaar in het scherm en een tweede backfill levert exact dezelfde vensters
 * op, zodat twee rondes te vergelijken zijn.
 *
 * Waarom kwartalen en geen jaren of maanden: gemeten op 20 augustus is het
 * zwaarste kwartaal van de zwaarste kandidaat 6.372 orderregels. Power Automate
 * kwam niet meer terug bij 15.229 en net wel bij 11.128, dus een kwartaal past
 * met ruime marge terwijl een jaar dat niet doet.
 */
export function quarterChunks(startDate: Date, now: Date): BackfillChunk[] {
  const chunks: BackfillChunk[] = [];
  const laatste = quarterStart(now);

  for (let from = quarterStart(startDate); from <= laatste; from = addQuarter(from)) {
    const to = addQuarter(from);
    const kwartaal = Math.floor(from.getUTCMonth() / 3) + 1;
    chunks.push({ from, to, label: `${from.getUTCFullYear()} Q${kwartaal}` });
  }

  return chunks;
}

/** Eén job binnen een backfill, nog zonder runId. */
export type BackfillJobSpec = {
  sequence: number;
  endpoint: SyncEndpoint;
  from: Date;
  to: Date;
  /** Het kwartaal waar deze job bij hoort; null voor de stamdata vooraan. */
  label: string | null;
};

/** De endpoints die per kwartaal herhaald worden, in ketenvolgorde. */
const PER_KWARTAAL: readonly SyncEndpoint[] = ["lots", "orders", "costs"];

/**
 * De joblijst van een backfill, in de volgorde waarin de wachtrij hem afwerkt.
 *
 * Kwekers staan vooraan en maar één keer: die query kent geen datumvenster —
 * hij pakt alle kwekers van deze leverancier via zijn partijen. Hij moet wél
 * eerst, want de lots-import gooit partijen stilzwijgend weg waarvan de kweker
 * ontbreekt. Zijn venster is de volle spanwijdte, puur omdat de kolommen niet
 * leeg mogen zijn; de query gebruikt het niet.
 *
 * Leveranciers zitten er niet bij: die bestaat al, dat is de aanleiding.
 *
 * Alles in één runId, niet één runId per kwartaal. De wachtrij wacht binnen een
 * run op het vorige volgnummer, en dat is precies wat hier nodig is: kwekers
 * vóór alle kwartalen, en binnen een kwartaal de ketenvolgorde. Met een runId
 * per kwartaal is er geen mechanisme dat kwekers vóór de rest houdt.
 */
export function backfillJobs(chunks: readonly BackfillChunk[]): BackfillJobSpec[] {
  if (chunks.length === 0) return [];

  const jobs: BackfillJobSpec[] = [
    {
      sequence: 0,
      endpoint: "growers",
      from: chunks[0].from,
      to: chunks[chunks.length - 1].to,
      label: null,
    },
  ];

  for (const chunk of chunks) {
    for (const endpoint of PER_KWARTAAL) {
      jobs.push({
        sequence: jobs.length,
        endpoint,
        from: chunk.from,
        to: chunk.to,
        label: chunk.label,
      });
    }
  }

  return jobs;
}
```

- [x] **Step 4: Draai het en zie het slagen, en neem het op in `npm run check`**

Run: `npx tsx scripts/checks/backfill.ts`
Expected: PASS op alle regels.

Voeg in `package.json` ` && tsx scripts/checks/backfill.ts` toe aan het `check`-script, achter de bestaande.

Run: `npm run check`
Expected: geen enkele FAIL.

- [x] **Step 5: Commit**

```bash
git add src/lib/sync/backfill.ts scripts/checks/backfill.ts package.json
git commit -m "feat: split a backfill into calendar quarters in chain order"
```

---

### Task 2: De basisdatum

**Files:**
- Create: `src/lib/sync/settings.ts`
- Create: `src/app/api/sync/settings/route.ts`

**Interfaces:**
- Produces:
  ```ts
  export const BACKFILL_START_KEY = "sync.backfillStartDate";
  export function parseIsoDay(value: string): Date | null;
  export function toIsoDay(date: Date): string;
  export async function readBackfillStart(): Promise<Date | null>;
  export async function writeBackfillStart(date: Date): Promise<void>;
  ```

- [x] **Step 1: Schrijf de leeslaag**

Create `src/lib/sync/settings.ts`:

```ts
import { prisma } from "@/lib/db";

/**
 * De basisdatum voor backfills. Eén instelling voor alle leveranciers; een
 * datum per leverancier is een verfijning waar nu geen vraag achter zit.
 *
 * Bewust niet in `/api/admin/settings`: die route geeft 403 zodra `isTest`
 * onwaar is en controleert geen rol — hij is gebouwd voor de e-mailinstellingen
 * van de testomgeving. Deze moet juist op productie werken en admin-only zijn.
 */
export const BACKFILL_START_KEY = "sync.backfillStartDate";

/**
 * Een kalenderdag in ISO-vorm als UTC-middernacht, of null als de tekst geen
 * bestaande dag is.
 *
 * De terugvergelijking met de invoer is de kern: `new Date("2024-02-30T…")`
 * levert geen ongeldige datum op maar 1 maart. Alleen een NaN-controle laat
 * zo'n dag stilletjes opschuiven.
 */
export function parseIsoDay(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === value ? parsed : null;
}

/** De ISO-dag van een UTC-middernacht, de vorm waarin de instelling opgeslagen staat. */
export function toIsoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Null als de instelling ontbreekt of onleesbaar is; nooit een gegokte datum. */
export async function readBackfillStart(): Promise<Date | null> {
  const row = await prisma.setting.findUnique({ where: { key: BACKFILL_START_KEY } });
  if (!row) return null;

  return parseIsoDay(row.value);
}

export async function writeBackfillStart(date: Date): Promise<void> {
  const value = toIsoDay(date);
  await prisma.setting.upsert({
    where: { key: BACKFILL_START_KEY },
    create: { key: BACKFILL_START_KEY, value },
    update: { value },
  });
}
```

- [x] **Step 2: Schrijf de route**

Create `src/app/api/sync/settings/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api-helpers";
import { parseIsoDay, readBackfillStart, toIsoDay, writeBackfillStart } from "@/lib/sync/settings";
import { quarterChunks } from "@/lib/sync/backfill";

export async function GET() {
  const { error } = await requireAuth(["admin"]);
  if (error) return error;

  const start = await readBackfillStart();
  return NextResponse.json({
    backfillStartDate: start ? start.toISOString().slice(0, 10) : null,
    // Het scherm waarschuwt met dit getal; laat de server rekenen zodat de
    // definitie van "een kwartaal" op één plek staat.
    quarters: start ? quarterChunks(start, new Date()).length : 0,
  });
}

const bodySchema = z.object({
  backfillStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
});

export async function PUT(request: NextRequest) {
  const { error } = await requireAuth(["admin"]);
  if (error) return error;

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // De regex laat 2024-02-30 en 2024-13-45 door; pas het parsen scheidt een
  // bestaande dag van een die er alleen uitziet als één.
  const date = parseIsoDay(parsed.data.backfillStartDate);
  if (!date) {
    return NextResponse.json({ error: "Not a valid date" }, { status: 400 });
  }

  // De datum wordt als UTC-middernacht bewaard, maar het scherm stuurt de
  // kalenderdag van de gebruiker. Tussen 22:00 UTC en middernacht is die dag
  // hier al morgen, en `date.getTime() > Date.now()` zou "vandaag" dan als
  // toekomst weigeren. De grens ligt daarom een dag verderop.
  const grens = toIsoDay(new Date(Date.now() + 24 * 60 * 60 * 1000));
  if (toIsoDay(date) > grens) {
    return NextResponse.json(
      { error: "A start date in the future would backfill nothing" },
      { status: 400 }
    );
  }

  await writeBackfillStart(date);
  return NextResponse.json({
    // De opgeslagen vorm terug, niet de invoer: dat is wat een volgende GET geeft.
    backfillStartDate: toIsoDay(date),
    quarters: quarterChunks(date, new Date()).length,
  });
}
```

- [x] **Step 3: Verifieer tegen de testdatabase**

Schrijf `scripts/tmp-settings.js` dat met de Neon HTTP-driver de rij zet en terugleest, en controleer dat `readBackfillStart` een datum teruggeeft en `null` bij een onzinwaarde. Ruim het script op.

Run: `npx tsc --noEmit` en `npx next lint --file src/app/api/sync/settings/route.ts`
Expected: allebei schoon.

- [x] **Step 4: Commit**

```bash
git add src/lib/sync/settings.ts src/app/api/sync/settings
git commit -m "feat: store the backfill start date outside the test-only settings route"
```

---

### Task 3: Voorrang in de wachtrij

**Files:**
- Modify: `prisma/schema.prisma` (model `SyncJob`)
- Modify: `src/lib/sync/runner.ts` (`claimNextJob`, rond regel 94)

**Interfaces:**
- Produces: `SyncJob.priority Int @default(0)` — 0 is een geplande ronde, 1 een backfill.

- [x] **Step 1: Voeg de kolom toe aan het schema**

In `prisma/schema.prisma`, model `SyncJob`, onder `source`:

```prisma
  /// 0 = geplande ronde, 1 = backfill. De claim sorteert hierop, zodat werk aan
  /// het verleden nooit voorgaat op de dagelijkse sync.
  priority         Int       @default(0)
```

En vervang `@@index([status, createdAt])` door:

```prisma
  @@index([status, priority, createdAt])
```

- [x] **Step 2: Zet de kolom op de testdatabase**

`prisma db push` kan niet (poort 5432 dicht). Voer met de Neon HTTP-driver exact uit wat Prisma zou genereren:

```sql
ALTER TABLE "SyncJob" ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0;
DROP INDEX IF EXISTS "SyncJob_status_createdAt_idx";
CREATE INDEX "SyncJob_status_priority_createdAt_idx" ON "SyncJob"("status", "priority", "createdAt");
```

Controleer daarna via `information_schema.columns` en `pg_indexes` dat kolom en index er staan.
**Noteer deze SQL in je rapportage:** productie heeft hem later apart nodig.

- [x] **Step 3: Laat de claim erop sorteren**

In `src/lib/sync/runner.ts`, in `claimNextJob()`, wordt

```
      ORDER BY j."createdAt", j.sequence
```

vervangen door

```
      ORDER BY j.priority, j."createdAt", j.sequence
```

En de doc-comment boven de functie krijgt er een derde regel bij:

```
 *   3. een backfill komt pas aan de beurt als er geen geplande ronde wacht
```

met daaronder:

```
 * Die derde regel is enkel deze ORDER BY. Een extra NOT EXISTS is overbodig:
 * staat er een gewone job te wachten, dan pakt de sortering die per definitie
 * eerst. Een lopende backfill-job wordt niet afgebroken — hij maakt zijn brok
 * af en de rest van de backfill wacht tot de ronde klaar is.
```

- [x] **Step 4: Verifieer de voorrang tegen echte rijen**

Schrijf `scripts/tmp-priority.js`: leeg de wachtrij, zet met de HTTP-driver twee jobs klaar — één met `priority = 1` en een oudere `createdAt`, één met `priority = 0` en een nieuwere — en voer daarna dezelfde `SELECT` uit die in `claimNextJob` staat (zonder de `UPDATE`, dus alleen het subselect). Controleer dat de gewone job terugkomt, niet de backfill.

Draai dezelfde proef nogmaals met alleen de backfill-job in de wachtrij en controleer dat die dan wél terugkomt.

Ruim de proefrijen én het script op.

- [x] **Step 5: Commit**

```bash
git add prisma/schema.prisma src/lib/sync/runner.ts
git commit -m "feat: let a scheduled round outrank a backfill in the queue"
```

---

### Task 4: Een backfill klaarzetten

**Files:**
- Modify: `src/lib/sync/runner.ts` (nieuwe export, naast `enqueueRun`)
- Create: `src/app/api/sync/backfill/route.ts`

**Interfaces:**
- Consumes: `quarterChunks`, `backfillJobs` (taak 1), `readBackfillStart` (taak 2), `priority` (taak 3)
- Produces:
  ```ts
  export type BackfillPlan = { chunks: number; jobs: number; from: Date; to: Date };
  export function planBackfill(startDate: Date, now?: Date): BackfillPlan;
  export async function enqueueBackfill(
    supplierFabricId: number, startDate: Date, now?: Date
  ): Promise<{ runId: string; jobs: number }>;
  export async function openBackfills(): Promise<Array<{
    runId: string; supplierFabricId: number; total: number; done: number;
    failed: number; current: string | null;
  }>>;
  ```

- [x] **Step 1: Schrijf de runner-functies**

Voeg toe aan `src/lib/sync/runner.ts`:

```ts
import { quarterChunks, backfillJobs } from "./backfill";

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
 * Zet een backfill klaar voor één leverancier. Gooit als er al een open
 * backfill voor hem loopt: twee tegelijk leveren dezelfde upserts op en maken
 * de voortgang onleesbaar.
 */
export async function enqueueBackfill(
  supplierFabricId: number,
  startDate: Date,
  now: Date = new Date()
): Promise<{ runId: string; jobs: number }> {
  const bestaand = await prisma.syncJob.findFirst({
    where: {
      supplierFabricId,
      source: "backfill",
      status: { in: ["pending", "dispatched"] },
    },
    select: { runId: true },
  });
  if (bestaand) {
    throw new Error(`Er loopt al een backfill voor deze leverancier (${bestaand.runId})`);
  }

  const specs = backfillJobs(quarterChunks(startDate, now));
  if (specs.length === 0) {
    throw new Error("De basisdatum ligt in de toekomst; er valt niets te backfillen");
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

  return { runId, jobs: specs.length };
}

/** De lopende backfills met hun voortgang, voor de kaart in het scherm. */
export async function openBackfills() {
  const jobs = await prisma.syncJob.findMany({
    where: { source: "backfill" },
    select: {
      runId: true, supplierFabricId: true, status: true,
      sequence: true, endpoint: true, windowFrom: true,
    },
    orderBy: [{ runId: "asc" }, { sequence: "asc" }],
  });

  const perRun = new Map<string, typeof jobs>();
  for (const job of jobs) {
    if (!perRun.has(job.runId)) perRun.set(job.runId, []);
    perRun.get(job.runId)!.push(job);
  }

  return [...perRun.entries()]
    .map(([runId, rijen]) => {
      const done = rijen.filter((r) => r.status === "done").length;
      const failed = rijen.filter((r) => r.status === "failed").length;
      const lopend = rijen.find((r) => r.status === "dispatched") ??
        rijen.find((r) => r.status === "pending");
      return {
        runId,
        supplierFabricId: rijen[0].supplierFabricId!,
        total: rijen.length,
        done,
        failed,
        current: lopend ? `${lopend.endpoint} ${lopend.windowFrom.toISOString().slice(0, 10)}` : null,
      };
    })
    // Afgeronde backfills verdwijnen uit de kaart; de batchlijst houdt de historie.
    .filter((b) => b.done < b.total || b.failed > 0);
}
```

- [x] **Step 2: Schrijf de route**

Create `src/app/api/sync/backfill/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";
import { readBackfillStart } from "@/lib/sync/settings";
import { enqueueBackfill, openBackfills, planBackfill } from "@/lib/sync/runner";

export async function GET() {
  const { error } = await requireAuth(["admin"]);
  if (error) return error;

  const backfills = await openBackfills();
  const ids = backfills.map((b) => b.supplierFabricId);
  const suppliers = await prisma.supplier.findMany({
    where: { fabricId: { in: ids } },
    select: { fabricId: true, code: true, name: true },
  });
  const perId = new Map(suppliers.map((s) => [s.fabricId!, s]));

  return NextResponse.json({
    backfills: backfills.map((b) => ({
      ...b,
      code: perId.get(b.supplierFabricId)?.code ?? null,
      name: perId.get(b.supplierFabricId)?.name ?? null,
    })),
  });
}

const bodySchema = z.object({ supplierFabricId: z.number().int() });

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

  try {
    const result = await enqueueBackfill(parsed.data.supplierFabricId, start);
    return NextResponse.json({ ...result, plan: planBackfill(start) }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not start the backfill" },
      { status: 409 }
    );
  }
}
```

- [x] **Step 3: Verifieer met een echte, kleine leverancier**

`COLXIMA` heeft 106 partijen sinds 2024 — klein genoeg om af te ronden, groot genoeg om meerdere kwartalen te raken.

Zet met de HTTP-driver `sync.backfillStartDate` op `2026-01-01`, roep de route aan met zijn `fabricId`, en controleer dat er precies `1 + 3 × aantal kwartalen` jobs staan met `source = 'backfill'`, `priority = 1` en het juiste `supplierFabricId`. Controleer dat een tweede aanroep een 409 geeft.

Verwijder de proefjobs weer; de ronde draaien gebeurt in taak 8.

- [x] **Step 4: Commit**

```bash
git add src/lib/sync/runner.ts src/app/api/sync/backfill/route.ts
git commit -m "feat: queue a per-supplier backfill in quarterly chunks"
```

**Zo is het gebouwd, waar het afwijkt van de code hierboven:**

- `enqueueBackfill` **gooit niet meer**. Hij geeft
  `{ ok: true; runId; jobs } | { ok: false; reason: "already_running" | "nothing_to_backfill"; message }`
  terug. De twee weigeringen zijn verwachte antwoorden; als ze `Error` zijn, moet elke aanroeper een
  `catch` schrijven die een uitgevallen database niet van "er loopt er al een" kan onderscheiden — dan
  wordt een Neon-storing een 409. De route heeft daardoor geen `try` meer en een echte fout wordt weer
  een 500.
- `openBackfills()` haalt eerst de runIds op die nog een job hebben die niet `done` is, en pas daarna de
  jobs van die runs. De filter zat in het plan ná het ophalen, waardoor elke ooit gedraaide backfill
  voor altijd over de lijn kwam.
- `current` toont het kwartaal in plaats van de begindatum van het venster: `"lots 2026 Q2"`. Dat label
  wordt afgeleid uit `windowFrom` met de nieuwe export `quarterLabel()` uit `backfill.ts` — geen kolom
  erbij, dezelfde functie die `quarterChunks` zijn labels geeft. Volgnummer 0 is de stamdatajob en
  overspant alle kwartalen; die toont alleen `"growers"`.
- Geen `!` op `supplierFabricId`: een backfill-run zonder Fabric-id valt uit het antwoord, want de kaart
  heeft de leverancier erbij nodig. Idem voor `Supplier.fabricId` in de route.
- Geen transactie om de `createMany`, en dat klopt: `enqueueRun` heeft er één omdat hij twee dingen
  schrijft (jobs én `lastRunAt`), hier is het één statement. De dubbelcontrole blijft advies en geen
  slot — twee gelijktijdige klikken kunnen er allebei langs, en het ergste gevolg is dubbel werk.
- De doc-comment boven `cancelRestOfRun()` is bijgewerkt: één runId over alle kwartalen, dus een
  gestrande brok annuleert de rest van de backfill, waarvoor `resumeBackfill` bestaat.

---

### Task 5: Hervatten na een gestrande brok

**Files:**
- Modify: `src/lib/sync/runner.ts`
- Create: `src/app/api/sync/backfill/[runId]/resume/route.ts`

**Interfaces:**
- Produces: `export async function resumeBackfill(runId: string): Promise<number>` — het aantal jobs dat weer op `pending` staat.

- [x] **Step 1: Schrijf de functie**

Voeg toe aan `src/lib/sync/runner.ts`:

```ts
/**
 * Zet een gestrande backfill weer aan vanaf de brok waar hij bleef steken.
 *
 * Een gefaalde job annuleert de rest van zijn run — streng, en terecht, want
 * een gat middenin een backfill ziet niemand terug. Maar zonder hervatten begin
 * je na een storing in kwartaal negen weer bij kwartaal één. De vensters staan
 * al gematerialiseerd op de geannuleerde jobs, dus hervatten is niet meer dan
 * ze terugzetten en de gefaalde job zijn pogingen teruggeven.
 */
export async function resumeBackfill(runId: string): Promise<number> {
  const result = await prisma.$transaction(async (tx) => {
    const hersteld = await tx.syncJob.updateMany({
      where: { runId, status: { in: ["failed", "cancelled"] } },
      data: { status: "pending", attempts: 0, lastError: null, completedAt: null },
    });
    return hersteld.count;
  });

  return result;
}
```

- [x] **Step 2: Schrijf de route**

Create `src/app/api/sync/backfill/[runId]/resume/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-helpers";
import { resumeBackfill } from "@/lib/sync/runner";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { error } = await requireAuth(["admin"]);
  if (error) return error;

  const { runId } = await params;
  const resumed = await resumeBackfill(runId);

  if (resumed === 0) {
    return NextResponse.json(
      { error: "Nothing to resume — this backfill has no failed or cancelled jobs." },
      { status: 409 }
    );
  }

  return NextResponse.json({ resumed });
}
```

- [x] **Step 3: Verifieer tegen echte rijen**

Zet met de HTTP-driver een backfill klaar, markeer job 4 als `failed` en de rest als `cancelled`, roep de route aan, en controleer dat alle vier weer op `pending` staan met `attempts = 0`. Controleer dat een tweede aanroep 409 geeft. Ruim de rijen op.

- [x] **Step 4: Commit**

```bash
git add src/lib/sync/runner.ts "src/app/api/sync/backfill/[runId]"
git commit -m "feat: resume a backfill from the quarter it stalled on"
```

---

### Task 6: De bevestiging bij aanzetten

**Files:**
- Modify: `src/app/api/admin/fabric-relations/route.ts` (het `activateSchema` en de `POST`)
- Modify: `src/app/(portal)/admin/imports/skipped-dialog.tsx`

**Interfaces:**
- Consumes: `POST /api/sync/backfill`, `GET /api/sync/settings`

- [x] **Step 1: Laat de activatie-route een backfill meenemen**

In `src/app/api/admin/fabric-relations/route.ts` wordt `activateSchema`:

```ts
const activateSchema = z.object({
  fabricId: z.number().int(),
  companyId: z.string().uuid(),
  /** Zet ook meteen een backfill klaar. Het scherm vraagt hier eerst om. */
  backfill: z.boolean().optional(),
});
```

En na `prisma.supplier.create(...)`, vóór de `NextResponse.json`:

```ts
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
```

en de respons wordt:

```ts
  return NextResponse.json(
    { supplierId: supplier.id, code: supplier.code, name: supplier.name, backfill, backfillError },
    { status: 201 }
  );
```

Voeg de imports toe: `readBackfillStart` uit `@/lib/sync/settings` en `enqueueBackfill` uit `@/lib/sync/runner`.

- [x] **Step 2: Zet de bevestiging in het paneel**

In `skipped-dialog.tsx` haalt de component `GET /api/sync/settings` op met `useFetch`. De Activate-knop opent nu eerst een bevestiging in plaats van meteen te posten.

De bevestiging toont, in het Engels: de code en naam van de leverancier, de basisdatum, het aantal kwartalen en het aantal jobs, en de zin dat het draait wanneer er geen geplande ronde wacht. Twee knoppen: **Activate and backfill** en **Activate only**. Is er geen basisdatum ingesteld, dan staat er in plaats van de aantallen dat er nog geen basisdatum is en blijft alleen **Activate only** over.

De bestaande `activate`-functie krijgt een tweede argument `metBackfill: boolean` dat als `backfill` in de body meegaat. Na succes toont de toast wat er is gebeurd — mét backfill: het aantal jobs erbij, en dat zijn partijen bij de volgende rondes binnenkomen. Komt er een `backfillError` terug, dan een aparte waarschuwing: de leverancier ís aangemaakt, de backfill niet.

- [x] **Step 3: Verifieer**

Run: `npx tsc --noEmit`, `npx next lint` op beide bestanden.
Expected: schoon.

Verifieer in de browser gebeurt in taak 8; controleer hier alleen dat de route met `backfill: true` jobs oplevert, met een tijdelijk script tegen de deployed testomgeving.

- [x] **Step 4: Commit**

```bash
git add src/app/api/admin/fabric-relations "src/app/(portal)/admin/imports/skipped-dialog.tsx"
git commit -m "feat: offer a backfill when activating a skipped supplier"
```

**Zo is het gebouwd, waar het afwijkt van de tekst hierboven:**

- De bevestiging staat als **`src/components/sync/backfill-confirm-dialog.tsx`** buiten `admin/imports`, want
  taak 7 gebruikt hem ook en twee kopieën lopen uit elkaar zodra er één getal bij komt. Hij haalt de
  basisdatum **zelf** op met `useFetch("/api/sync/settings")`; geen enkele aanroeper hoeft er iets van te
  weten. Zijn props:
  ```ts
  supplier: { code: string | null; name: string | null };
  confirmLabel: string;            // de knop die de backfill meeneemt
  onConfirm: () => void;
  secondary?: { label: string; onClick: () => void };  // de uitweg zonder backfill
  onCancel: () => void;
  busy?: boolean;
  ```
  Zonder basisdatum — of als de fetch faalt — verdwijnt de knop met `confirmLabel` en blijft er staan
  wat er ontbreekt. In het overgeslagen-paneel blijft `secondary` ("Activate only") dan vanzelf over;
  **taak 7 geeft geen `secondary` mee** en houdt dan alleen Cancel over, wat daar klopt.
- `GET/PUT /api/sync/settings` geven er een veld **`jobs`** bij, berekend met `planBackfill`. De
  bevestiging toont kwartalen én jobs, en `1 + 3 × quarters` in de client narekenen zou de vorm van de
  joblijst op een tweede plek vastleggen. Bestaande lezers van `quarters` merken er niets van.

---

### Task 7: De knop op een bestaande leverancier

**Files:**
- Modify: `src/app/(portal)/suppliers/[id]/supplier-detail.tsx`

- [ ] **Step 1: Voeg de knop toe**

Op de leverancierspagina een knop **Backfill history**, zichtbaar voor `admin`. Hij opent dezelfde bevestiging als in taak 6 — code, naam, basisdatum, kwartalen, jobs, en de zin over wanneer het draait — en post daarna naar `POST /api/sync/backfill` met de `fabricId` van deze leverancier.

Een leverancier zonder `fabricId` krijgt de knop niet: zonder Fabric-relatie valt er niets op te halen. Toon in dat geval niets in plaats van een knop die altijd faalt.

Een 409 ("er loopt al een backfill") komt als foutmelding terug en wordt getoond zoals hij is.

- [ ] **Step 2: Verifieer**

Run: `npx tsc --noEmit` en `npx next lint --file "src/app/(portal)/suppliers/[id]/supplier-detail.tsx"`
Expected: schoon.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(portal)/suppliers/[id]/supplier-detail.tsx"
git commit -m "feat: let an existing supplier be backfilled from its own page"
```

---

### Task 8: Het datumveld en de voortgangskaart

**Files:**
- Create: `src/app/(portal)/admin/imports/backfill-card.tsx`
- Modify: `src/app/(portal)/admin/imports/schedules-tab.tsx`

- [x] **Step 1: Schrijf de kaart**

`backfill-card.tsx` haalt `GET /api/sync/backfill` op met `useFetch` en toont per lopende backfill: de code en naam van de leverancier, `done / total` jobs, welk endpoint en welk kwartaal nu aan de beurt is, en of hij wacht. Is `failed > 0`, dan een knop **Resume** die naar `POST /api/sync/backfill/[runId]/resume` post en daarna `refetch()` aanroept.

Zijn er geen lopende backfills, dan rendert de kaart niets.

- [x] **Step 2: Zet het datumveld op het Schedules-tabblad**

Boven de twee schema-kaarten een blok **Backfill** met een `<input type="date">` gevuld uit `GET /api/sync/settings`, een opslaan-knop die naar `PUT` post, en onder het veld de zin hoeveel kwartalen dat per leverancier wordt — het getal komt uit `quarters` in de respons, zodat de definitie van een kwartaal op één plek staat.

Daaronder de `BackfillCard`.

- [ ] **Step 3: Verifieer end-to-end op test** — *nog te doen: de browserverificatie volgt in de hoofdsessie, ná deploy.*

Wacht tot je commit gedeployd is; Power Automate post terug naar de deployed omgeving.

Zet de basisdatum via het scherm op `2026-01-01`. Start via de leverancierspagina een backfill voor `COLXIMA`. Controleer:

- de kaart verschijnt met het juiste aantal jobs
- tik de wachtrij door met
  ```js
  await fetch("https://growerportal.test.apps.coloriginz.com/api/sync/tick", {
    method: "POST", headers: { Authorization: "Bearer " + process.env.CRON_SECRET },
    signal: AbortSignal.timeout(25000) });
  ```
  en volg met `SELECT sequence, endpoint, status, priority FROM "SyncJob" ORDER BY "runId", sequence`
- de jobs lopen in volgorde: kwekers eerst, dan per kwartaal lots, orders, costs
- **de voorrang klopt**: zet halverwege via het scherm een gewone ronde klaar met "Run now" op `intraday`, en controleer dat die er tussendoor komt vóór de resterende backfill-jobs
- na afloop: `COLXIMA` heeft partijen uit alle kwartalen, en `SELECT COUNT(*) FROM "Lot" WHERE "purchaseType" <> 'CONS'` blijft nul

Vergelijk het aantal binnengekomen partijen met wat Fabric zegt:
```bash
node scripts/fabric-query.js "SELECT COUNT(*) AS n FROM marts.fct_partijen p JOIN marts.dim_leverancier l ON l.rel_id_leverancier = p.rel_id_leverancier WHERE l.leverancier_code = 'COLXIMA' AND p.inkooptype_code = 'CONS' AND p.leverdatum >= '2026-01-01'"
```

- [x] **Step 4: Commit**

```bash
git add "src/app/(portal)/admin/imports"
git commit -m "feat: set the backfill start date and watch a backfill run"
```

**Zo is het gebouwd, waar het afwijkt van de tekst hierboven:**

- **"Of hij wacht" bestond nog niet en is erbij gekomen in `openBackfills()`**, als
  `waitingOnRound: boolean`. Af te leiden viel het niet: de voorrang zit in de `ORDER BY` van
  `claimNextJob`, niet in de rijen van de backfill zelf. Eén extra query — bestaat er een `SyncJob`
  met `priority = 0` en status `pending` of `dispatched` — beantwoordt het voor alle backfills
  tegelijk, en de vlag staat alleen aan als de eigen brok óók nog `pending` is. Staat die op
  `dispatched`, dan is de backfill zelf aan de beurt en wacht hij nergens op.
- **Geen polling.** De kaart houdt zijn eigen `useFetch`, maar geeft zijn `refetch` af aan het
  tabblad via `registerRefresh`, zodat de ene bestaande Refresh-knop schema's, basisdatum én kaart
  meeneemt. Een tweede verversknop in de kaart zou het scherm twee betekenissen van "ververs" geven.
- **Het kwartaalgetal hoort bij de opgeslagen datum, niet bij het veld.** Het komt uit `quarters` in
  de respons en wordt hier niet nagerekend; zolang het veld afwijkt van wat opgeslagen staat zegt de
  regel eronder dat, in plaats van een getal te tonen dat bij de vorige datum hoort. Na opslaan valt
  het veld terug op de servertoestand, die de PUT al meestuurt.

---

## Wat er na dit plan staat

- Eén basisdatum bepaalt hoe ver een backfill teruggaat, instelbaar in het scherm en werkend op productie
- Een leverancier aanzetten biedt meteen zijn historie aan, met de kosten vooraf zichtbaar
- Een bestaande leverancier kan alsnog een backfill krijgen — nodig voor `COLXROOD` en `COLXBAK`, die 317 afrekeningen misten
- Werk aan het verleden staat de dagelijkse sync nooit in de weg
- Een gestrande backfill hervat vanaf het kwartaal waar hij bleef steken

**Wat productie nog nodig heeft**, bovenop wat er al openstond: de `ALTER TABLE` uit taak 3, en een basisdatum die daar apart gezet moet worden — instellingen reizen niet mee met een deploy.

**Wat er niet in zit:** een basisdatum per leverancier, automatisch signaleren dát er een gat is, meerdere jobs tegelijk, en backfill voor fust of afrekening-pdf's.

**Eén verouderde comment om mee te nemen:** `cancelRestOfRun()` in `runner.ts` zegt dat een backfill "per brok een eigen runId" heeft en dat andere brokken doorlopen. Dat was een aanname uit het oorspronkelijke sync-ontwerp; dit plan kiest bewust anders, omdat er met een runId per kwartaal geen enkel mechanisme is dat de kwekers vóór alle kwartalen houdt. Werk die comment bij in de taak waarin je hem tegenkomt.
