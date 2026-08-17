# Sync-bediening Implementatieplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** De sync-motor is te bedienen en te volgen vanuit het admin-scherm, zonder SQL tegen de database.

**Architecture:** `/admin/imports` krijgt een derde tab voor de schema's, en de Data Sync-tab krijgt een blok voor de lopende ronde plus jobgegevens in de historie. Vijf nieuwe admin-routes onder `/api/sync/` lezen en muteren `SyncSchedule` en `SyncJob`; de bestaande batch-route wordt aangevuld met een left join op `SyncJob`. Riskante instellingen leveren een waarschuwing op uit een pure functie, geen blokkade.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript strict, Prisma 6 op Neon, Tailwind 4 + shadcn/ui (Base UI), Remix Icons.

**Spec:** [`docs/superpowers/specs/2026-08-17-sync-bediening-design.md`](../specs/2026-08-17-sync-bediening-design.md)

## Global Constraints

- Werk op `develop`, committeer direct, geen feature branch of worktree.
- **Niet naar `main` mergen.** Productie gaat pas later live en dat is een aparte, bewuste beslissing.
- **Raak de productiedatabase niet aan.** Alleen `.env` (test).
- **Zet geen enkel schema op productie aan.** Op test staan `intraday` en `nightly` aan; die mag je gebruiken.
- TypeScript strict. `npx tsc --noEmit` schoon en `npm run check` groen (nu 103 controles) bij elke commit.
- Dit project heeft geen testframework. Pure functies krijgen een controlescript onder `scripts/checks/`; de rest wordt op test geverifieerd.
- Draai geen `npm run build`. `npm run dev` werkt niet vanuit cmd.exe (`NODE_OPTIONS='...'` is POSIX-syntaxis) — start vanuit bash. Afsluiten met `npx kill-port 3000`.
- **Gebruik NOOIT `taskkill //F //IM node.exe`** — dat killt de sessie zelf.
- UI-teksten in het Engels, code en commentaar in het Engels, commit messages in het Engels.
- Volg de bestaande patronen in `imports-content.tsx`: `useFetch`, shadcn-componenten, `useLanguage()` voor teksten.

---

## Bestandsstructuur

| bestand | verantwoordelijkheid |
|---|---|
| `src/lib/sync/schedule.ts` | *wijzigen* — `windowAdvies()` erbij naast `isDue()` en `windowFor()` |
| `src/lib/sync/runner.ts` | *wijzigen* — `source` krijgt de schemanaam; `enqueueRunNow()` erbij |
| `scripts/checks/schedule.ts` | *wijzigen* — controles voor `windowAdvies()` |
| `src/app/(portal)/admin/imports/imports-content.tsx` | *wijzigen* — alleen nog omhulsel met drie tabs |
| `src/app/(portal)/admin/imports/shared.tsx` | types en hulpjes die de tabs delen |
| `src/app/(portal)/admin/imports/data-sync-tab.tsx` | de bestaande Data Sync-tab, plus lopende ronde en jobkolommen |
| `src/app/(portal)/admin/imports/salessheet-tab.tsx` | de bestaande Sales Sheets-tab, ongewijzigd verplaatst |
| `src/app/(portal)/admin/imports/schedules-tab.tsx` | de nieuwe Schema's-tab |
| `src/app/api/sync/schedules/route.ts` | GET: de schema's met afgeleide gezondheid |
| `src/app/api/sync/schedules/[name]/route.ts` | PUT: opslaan na type- en bereikcontrole |
| `src/app/api/sync/schedules/[name]/run/route.ts` | POST: nu een ronde klaarzetten |
| `src/app/api/sync/advance/route.ts` | POST: de wachtrij een stap |
| `src/app/api/sync/jobs/route.ts` | GET: de lopende ronde |
| `src/app/api/admin/import-batches/route.ts` | *wijzigen* — jobgegevens per batch erbij |

**Over de UI-taken.** Voor de bibliotheek en de routes staat de code hieronder volledig uitgeschreven, want daar telt precisie. Voor de schermen staat de datavorm en de opbouw beschreven, maar niet elke regel JSX: het bestaande scherm is de norm en die na-apen levert een beter resultaat dan een voorgeschreven opmaak. Wijk je van die norm af, meld dat dan.

---

### Task 1: Waarschuwen bij riskante instellingen

**Files:**
- Modify: `src/lib/sync/schedule.ts`
- Modify: `scripts/checks/schedule.ts`

**Interfaces:**
- Consumes: `ScheduleState` uit `schedule.ts`
- Produces: `type ScheduleAdvies = { veld: AdviesVeld; melding: string }` en `windowAdvies(schedule): ScheduleAdvies[]`, gebruikt door taak 3 (GET), taak 5 (PUT) en de Schema's-tab

- [ ] **Step 1: Schrijf de controles (dit faalt nog)**

Voeg onderaan `scripts/checks/schedule.ts` toe:

```typescript
import { windowAdvies } from "../../src/lib/sync/schedule";

const basis = {
  name: "nightly",
  enabled: true,
  intervalMin: null as number | null,
  atTime: "03:00" as string | null,
  endpoints: ["suppliers", "growers", "lots", "orders", "costs"],
  windowDays: 7,
  windowOverrides: { costs: 28 } as unknown,
  lastRunAt: null as Date | null,
};

const velden = (a: ReturnType<typeof windowAdvies>) => a.map((x) => x.veld);

check("gezonde nachtronde geeft geen waarschuwing", windowAdvies(basis).length === 0,
  JSON.stringify(windowAdvies(basis)));

check(
  "costs onder 21 dagen waarschuwt",
  velden(windowAdvies({ ...basis, windowOverrides: { costs: 7 } })).includes("windowOverrides")
);

check(
  "costs zonder uitzondering erft een te smal rondevenster",
  velden(windowAdvies({ ...basis, windowOverrides: null })).includes("windowOverrides")
);

check(
  "costs op 21 dagen waarschuwt niet",
  windowAdvies({ ...basis, windowOverrides: { costs: 21 } }).length === 0
);

check(
  "een venster van 1 dag bij een zesuurs-ronde waarschuwt niet",
  windowAdvies({
    ...basis, name: "intraday", atTime: null, intervalMin: 360,
    endpoints: ["lots", "orders"], windowDays: 1, windowOverrides: null,
  }).length === 0,
  "zes uur past vier keer in een dag, dus 1 dag is ruim twee rondes"
);

check(
  "een dagelijkse ronde met een venster van 1 dag waarschuwt",
  velden(windowAdvies({ ...basis, windowDays: 1, windowOverrides: { costs: 28 } })).includes("windowDays")
);

check(
  "een interval onder vijf minuten waarschuwt",
  velden(windowAdvies({
    ...basis, atTime: null, intervalMin: 2, endpoints: ["lots"], windowOverrides: null, windowDays: 7,
  })).includes("intervalMin")
);

check(
  "een schema zonder endpoints waarschuwt",
  velden(windowAdvies({ ...basis, endpoints: [] })).includes("endpoints")
);

check(
  "een schema zonder interval en zonder tijdstip waarschuwt",
  velden(windowAdvies({ ...basis, atTime: null, intervalMin: null })).includes("schema")
);

check(
  "een uitgezet schema waarschuwt nergens over",
  windowAdvies({ ...basis, enabled: false, endpoints: [], windowDays: 1 }).length === 0
);
```

- [ ] **Step 2: Draai het en zie het falen**

Run: `npx tsx scripts/checks/schedule.ts`
Expected: FAIL, `windowAdvies` bestaat nog niet

- [ ] **Step 3: Schrijf de functie**

Voeg toe aan `src/lib/sync/schedule.ts`:

```typescript
export type AdviesVeld = "windowDays" | "windowOverrides" | "intervalMin" | "endpoints" | "schema";
export type ScheduleAdvies = { veld: AdviesVeld; melding: string };

/** Kosten zijn pas na drie weken compleet; zie de meting in het ontwerp. */
const COSTS_MINIMUM_DAGEN = 21;

type AdviesInvoer = {
  enabled: boolean;
  intervalMin: number | null;
  atTime: string | null;
  endpoints: string[];
  windowDays: number;
  windowOverrides: unknown;
};

function vensterVoor(schedule: AdviesInvoer, endpoint: string): number {
  const map =
    schedule.windowOverrides && typeof schedule.windowOverrides === "object" &&
    !Array.isArray(schedule.windowOverrides)
      ? (schedule.windowOverrides as Record<string, unknown>)
      : {};
  const raw = Number(map[endpoint]);
  return Number.isSafeInteger(raw) && raw > 0 ? raw : schedule.windowDays;
}

/**
 * Waarschuwt bij instellingen die aantoonbaar data laten missen, zonder ze te
 * weigeren. Blokkeren zou betekenen dat wie iets bewust anders wil het alsnog
 * in de database gaat zetten, en dan is er helemaal geen zicht meer op.
 *
 * Een uitgezet schema levert geen waarschuwingen op: dat draait niet, dus het
 * mist ook niets.
 */
export function windowAdvies(schedule: AdviesInvoer): ScheduleAdvies[] {
  if (!schedule.enabled) return [];
  const advies: ScheduleAdvies[] = [];

  if (schedule.intervalMin == null && schedule.atTime == null) {
    advies.push({
      veld: "schema",
      melding: "Without an interval or a time of day this schedule never runs.",
    });
  }

  if (schedule.intervalMin != null && schedule.intervalMin < 5) {
    advies.push({
      veld: "intervalMin",
      melding: "The cron ticks every five minutes, so a shorter interval changes nothing.",
    });
  }

  if (schedule.endpoints.length === 0) {
    advies.push({ veld: "endpoints", melding: "This schedule has nothing to fetch." });
  }

  // Hoe vaak deze ronde draait, in dagen. Een ronde op tijdstip draait dagelijks.
  const frequentieDagen = schedule.intervalMin != null ? schedule.intervalMin / 1440 : 1;

  for (const endpoint of schedule.endpoints) {
    const venster = vensterVoor(schedule, endpoint);

    if (endpoint === "costs" && venster < COSTS_MINIMUM_DAGEN) {
      advies.push({
        veld: "windowOverrides",
        melding: `Costs settle weeks after delivery: one week in, 45% of the cost lines exist, two weeks in 88%. Below ${COSTS_MINIMUM_DAGEN} days this misses cost lines every run, without an error.`,
      });
      continue; // de frequentiecontrole hieronder voegt hier niets aan toe
    }

    if (venster < frequentieDagen * 2) {
      advies.push({
        veld: schedule.windowDays === venster ? "windowDays" : "windowOverrides",
        melding: `The window for ${endpoint} is narrower than two runs. Miss one run and the window slides past deliveries that were never fetched.`,
      });
    }
  }

  return advies;
}
```

- [ ] **Step 4: Draai het en zie het slagen**

Run: `npm run check`
Expected: alle bestaande controles plus de tien nieuwe op PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/sync/schedule.ts scripts/checks/schedule.ts
git commit -m "feat: warn about sync windows that silently miss data"
```

---

### Task 2: Het schermbestand opsplitsen

Een pure verplaatsing: aan het eind doet het scherm exact hetzelfde als ervoor. Dat is met opzet een eigen taak — een refactor die tegelijk gedrag verandert is niet te reviewen.

**Files:**
- Modify: `src/app/(portal)/admin/imports/imports-content.tsx`
- Create: `src/app/(portal)/admin/imports/shared.tsx`
- Create: `src/app/(portal)/admin/imports/data-sync-tab.tsx`
- Create: `src/app/(portal)/admin/imports/salessheet-tab.tsx`

**Interfaces:**
- Produces: `shared.tsx` exporteert `ENDPOINTS`, `timeAgo()`, `formatDuration()`, `StatusBadge`, en de bestaande `ImportBatch`- en ingestion-types. Taken 4, 6 en 7 importeren daaruit.

- [ ] **Step 1: Verplaats de gedeelde stukken naar `shared.tsx`**

Uit `imports-content.tsx`: de type-definities bovenaan, `ENDPOINTS`, `timeAgo()`, `formatDuration()`, `StatusBadge` en `IngestionStatusBadge`. Ongewijzigd overnemen, alleen `export` ervoor.

- [ ] **Step 2: Verplaats `DataSyncTab` naar `data-sync-tab.tsx` en `SalesSheetImportsTab` naar `salessheet-tab.tsx`**

Beide ongewijzigd, met `export function`. Importeer wat ze nodig hebben uit `./shared`.

- [ ] **Step 3: Laat `imports-content.tsx` alleen het omhulsel over**

Het bestand houdt `ImportsContent()` met de tabs en importeert de twee tabcomponenten. Verder niets.

- [ ] **Step 4: Controleer dat er niets veranderd is**

Run: `npx tsc --noEmit` en `npx eslint "src/app/(portal)/admin/imports"`
Expected: geen fouten. De bestaande waarschuwing over een ongebruikte `useRouter` mag je oplossen door die import weg te halen als hij nergens meer gebruikt wordt.

Start de dev-server en open `/admin/imports`. Expected: beide tabs werken precies zoals ervoor — KPI-kaarten, filters, tabel, paginering, foutdialoog.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(portal)/admin/imports"
git commit -m "refactor: split the imports screen into one file per tab"
```

---

### Task 3: De leesroutes

**Files:**
- Create: `src/app/api/sync/schedules/route.ts`
- Create: `src/app/api/sync/jobs/route.ts`
- Modify: `src/lib/sync/runner.ts`

**Interfaces:**
- Produces: `GET /api/sync/schedules` → `{ schedules: ScheduleRij[] }` en `GET /api/sync/jobs` → `{ runs: RonderRij[] }`, gebruikt door taken 4 en 6.

- [ ] **Step 1: Laat `source` de schemanaam dragen**

In `src/lib/sync/runner.ts` staat in `enqueueRun`:

```typescript
source: schedule.name === "nightly" ? "nightly" : "schedule",
```

Dat maakt niet meer uit te maken welk schema een ronde heeft klaargezet, en dat is precies wat de gezondheidsregel nodig heeft. Vervang door:

```typescript
source: schedule.name,
```

Bestaande rijen houden hun oude waarde; dat is onschadelijk, want de gezondheidsregel kijkt alleen naar rondes die bij een bestaande schemanaam horen.

- [ ] **Step 2: Schrijf de schema-route**

Create `src/app/api/sync/schedules/route.ts`:

```typescript
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
```

- [ ] **Step 3: Schrijf de jobroute**

Create `src/app/api/sync/jobs/route.ts`:

```typescript
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
```

- [ ] **Step 4: Controleer beide routes**

Start de dev-server. De routes eisen een admin-sessie, dus controleer ze in de browser: open `http://localhost:3000/api/sync/schedules` terwijl je als admin bent ingelogd.

Expected: twee schema's met `lastSuccessAt` gevuld (op test heeft de nachtronde op 17 augustus een volledige ronde gedraaid) en `warnings: []`.

Voor de jobroute: `http://localhost:3000/api/sync/jobs`. Expected: `{"runs":[]}` als de wachtrij leeg is. Zet met een script een `pending`-job klaar, ververs, en controleer dat hij verschijnt; ruim hem daarna op.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/sync/schedules/route.ts src/app/api/sync/jobs/route.ts src/lib/sync/runner.ts
git commit -m "feat: add read routes for sync schedules and the running round"
```

---

### Task 4: De Schema's-tab, lezend

**Files:**
- Create: `src/app/(portal)/admin/imports/schedules-tab.tsx`
- Modify: `src/app/(portal)/admin/imports/imports-content.tsx`

**Interfaces:**
- Consumes: `GET /api/sync/schedules` uit taak 3, `timeAgo()` uit `shared.tsx`
- Produces: `SchedulesTab`-component; taak 5 maakt hem bewerkbaar

- [ ] **Step 1: Schrijf de tab**

`SchedulesTab` haalt `/api/sync/schedules` op met `useFetch` en toont per schema een kaart met:

- de naam, en een badge of hij aan of uit staat
- wanneer hij voor het laatst helemaal goed liep (`lastSuccessAt` via `timeAgo`), of "never" als dat er niet is
- het ritme: `elke 6 uur` bij `intervalMin`, of `03:00` bij `atTime`
- de endpoints in ketenvolgorde
- het venster, met de uitzonderingen erachter: `7 days (costs: 28)`
- de waarschuwingen uit `warnings`, als die er zijn, met het icoon dat de rest van het scherm voor waarschuwingen gebruikt

Boven de kaarten één regel met `stuckJobs` als dat getal groter is dan nul: dat is het signaal dat er iets vastzit.

Volg de opmaak van de bestaande KPI-kaarten in `data-sync-tab.tsx`.

- [ ] **Step 2: Voeg de tab toe aan het omhulsel**

In `imports-content.tsx` een derde `TabsTrigger` en `TabsContent`, tussen Data Sync en Sales Sheets in, met waarde `schedules` en label `Schedules`.

- [ ] **Step 3: Controleer in de browser**

Open `/admin/imports`, tab Schedules.
Expected: twee kaarten, `intraday` en `nightly`, allebei aan, `nightly` met venster `7 days (costs: 28)` en een gevulde "last successful run". Geen waarschuwingen.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(portal)/admin/imports"
git commit -m "feat: show the sync schedules in the admin screen"
```

---

### Task 5: De Schema's-tab, bewerkbaar

**Files:**
- Create: `src/app/api/sync/schedules/[name]/route.ts`
- Modify: `src/app/(portal)/admin/imports/schedules-tab.tsx`

**Interfaces:**
- Consumes: `windowAdvies()` uit taak 1
- Produces: `PUT /api/sync/schedules/[name]`

- [ ] **Step 1: Schrijf de opslagroute**

Create `src/app/api/sync/schedules/[name]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/api-helpers";
import { windowAdvies } from "@/lib/sync/schedule";
import { SYNC_ENDPOINTS } from "@/lib/sync/types";

/**
 * Controleert types en bereiken, niet of een keuze verstandig is. Een riskante
 * maar geldige waarde wordt opgeslagen met een waarschuwing erbij: een blokkade
 * die je niet kunt omzeilen wordt een reden om weer met SQL te werken.
 */
const bodySchema = z.object({
  enabled: z.boolean(),
  intervalMin: z.number().int().positive().nullable(),
  atTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM").nullable(),
  endpoints: z.array(z.enum(SYNC_ENDPOINTS)),
  windowDays: z.number().int().positive().max(3650),
  windowOverrides: z.record(z.enum(SYNC_ENDPOINTS), z.number().int().positive().max(3650)).nullable(),
});

export async function PUT(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { error } = await requireAuth(["admin"]);
  if (error) return error;

  const { name } = await params;
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const bestaat = await prisma.syncSchedule.findUnique({ where: { name } });
  if (!bestaat) return NextResponse.json({ error: "Unknown schedule" }, { status: 404 });

  const bijgewerkt = await prisma.syncSchedule.update({
    where: { name },
    data: parsed.data,
  });

  return NextResponse.json({ schedule: bijgewerkt, warnings: windowAdvies(bijgewerkt) });
}
```

- [ ] **Step 2: Maak de kaarten bewerkbaar**

Per kaart een bewerkmodus met: een schakelaar voor `enabled`, een getalveld voor `intervalMin` of een tijdveld voor `atTime` (welke van de twee hangt af van wat er gevuld is), keuzevakjes voor de endpoints, een getalveld voor `windowDays`, en per endpoint een optioneel getalveld voor de uitzondering.

Roep `windowAdvies()` aan op de bewerkte waarden terwijl je typt en toon de waarschuwingen direct bij het betreffende veld — dat is waar het `veld` in `ScheduleAdvies` voor is. Opslaan blijft mogelijk mét waarschuwingen; toon dan een bevestiging waarin de waarschuwing herhaald wordt.

Gebruik `sonner` voor de bevestiging na opslaan, zoals de rest van het project.

- [ ] **Step 3: Controleer in de browser**

Zet `nightly` zijn `costs`-uitzondering op 7. Expected: een waarschuwing verschijnt onder dat veld die uitlegt dat je kostenregels misloopt, en opslaan is nog steeds mogelijk. Zet hem terug op 28 en controleer dat de waarschuwing verdwijnt.

Zet de uitzondering daarna daadwerkelijk op 7, sla op, laad de pagina opnieuw en controleer dat de waarde bewaard is. **Zet hem daarna terug op 28** — de motor draait hier echt op.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(portal)/admin/imports" src/app/api/sync/schedules
git commit -m "feat: edit sync schedules, warning without blocking"
```

---

### Task 6: Draaien en een stap zetten

**Files:**
- Create: `src/app/api/sync/schedules/[name]/run/route.ts`
- Create: `src/app/api/sync/advance/route.ts`
- Modify: `src/lib/sync/runner.ts`
- Modify: `src/app/(portal)/admin/imports/schedules-tab.tsx`

**Interfaces:**
- Consumes: `enqueueRun()` en `tick()` uit `runner.ts`
- Produces: `POST /api/sync/schedules/[name]/run`, `POST /api/sync/advance`

- [ ] **Step 1: Voeg `enqueueRunNow()` toe aan de runner**

`enqueueRun` stempelt `lastRunAt` en dat is precies goed: een handmatige ronde telt mee, anders zou de volgende tick er nog een klaarzetten. Er is dus alleen een variant nodig die de due-vraag overslaat:

```typescript
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
```

- [ ] **Step 2: Schrijf de twee routes**

Create `src/app/api/sync/schedules/[name]/run/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-helpers";
import { enqueueRunNow } from "@/lib/sync/runner";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { error } = await requireAuth(["admin"]);
  if (error) return error;

  const { name } = await params;
  try {
    const enqueued = await enqueueRunNow(name);
    return NextResponse.json({ enqueued });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 400 }
    );
  }
}
```

Create `src/app/api/sync/advance/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-helpers";
import { tick } from "@/lib/sync/runner";
import { resolveSyncEnv } from "@/lib/env";

/**
 * Doet precies wat de cron doet: vastlopers opruimen, kijken of er een ronde due
 * is, en de volgende job versturen. Achter een sessie in plaats van CRON_SECRET,
 * want die sleutel hoort niet in een browser.
 *
 * Nodig omdat de cron alleen op productie-deployments vuurt: op test is develop
 * een preview en staat de wachtrij zonder deze knop stil.
 */
export async function POST() {
  const { error } = await requireAuth(["admin"]);
  if (error) return error;

  if (!resolveSyncEnv()) {
    return NextResponse.json({
      dryRun: true,
      reason: `NEXT_PUBLIC_APP_ENV is ${process.env.NEXT_PUBLIC_APP_ENV ? `"${process.env.NEXT_PUBLIC_APP_ENV}"` : "not set"}; only "test" and "production" dispatch`,
    });
  }

  return NextResponse.json(await tick());
}
```

- [ ] **Step 3: Voeg de knoppen toe**

Per schemakaart een knop **Run now**, die `POST /api/sync/schedules/<naam>/run` aanroept en daarna de gegevens ververst. Toon met `sonner` hoeveel jobs er klaargezet zijn.

De knop **Advance queue** hoort niet bij een schema maar bij de wachtrij: die komt in taak 7 bij het "nu bezig"-blok. Bouw hier alleen de route.

- [ ] **Step 4: Controleer op test**

Druk op **Run now** bij `intraday`. Expected: melding dat er 2 jobs zijn klaargezet (`lots` en `orders`).

Roep daarna de advance-route aan vanuit de browserconsole of met een script en controleer dat de eerste job wordt verstuurd. Laat de ronde aflopen of ruim de jobs op.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/sync "src/app/(portal)/admin/imports" src/lib/sync/runner.ts
git commit -m "feat: run a round now and advance the queue from the screen"
```

---

### Task 7: De lopende ronde op de Data Sync-tab

**Files:**
- Modify: `src/app/(portal)/admin/imports/data-sync-tab.tsx`

**Interfaces:**
- Consumes: `GET /api/sync/jobs` uit taak 3, `POST /api/sync/advance` uit taak 6

- [ ] **Step 1: Voeg de gezondheidsregel toe**

Bovenaan de Data Sync-tab, boven de bestaande KPI-kaarten, één regel per schema uit `GET /api/sync/schedules`: de naam, of hij aan staat, en wanneer hij voor het laatst helemaal goed liep (`lastSuccessAt` via `timeAgo`, of "never"). Staat `stuckJobs` boven nul, dan daarachter een waarschuwing met dat aantal.

Dit is de blik van drie seconden waar de spec om vraagt: gaat het goed, dan klik je weg. De Schema's-tab toont dezelfde gegevens uitgebreider; hier gaat het alleen om of er iets aan de hand is.

- [ ] **Step 2: Voeg het blok voor de lopende ronde toe**

Daaronder, alleen zichtbaar als `runs` uit `GET /api/sync/jobs` niet leeg is: per lopende ronde een rij met het schema waar hij bij hoort, en daaronder de jobs in volgorde met hun status, het aantal pogingen, en bij een gefaalde job de foutmelding.

Rechts in de kop van dat blok de knop **Advance queue**, die `POST /api/sync/advance` aanroept en daarna ververst.

- [ ] **Step 3: Ververs sneller als er iets loopt**

De tab ververst nu elke 30 seconden. Maak dat afhankelijk van de toestand: staat er een job op `dispatched`, dan elke 5 seconden, anders 30. Het bestaande interval staat in `data-sync-tab.tsx` in een `useEffect` met `setInterval`; laat de interval-duur afhangen van de opgehaalde jobs.

- [ ] **Step 4: Controleer op test**

Zet met **Run now** een ronde klaar bij `intraday`, ga naar Data Sync.
Expected: het blok verschijnt met twee jobs op `pending`. Druk op **Advance queue** en zie de eerste op `dispatched` gaan, daarna op `done`, en de tweede beginnen. Als de ronde klaar is verdwijnt het blok.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(portal)/admin/imports"
git commit -m "feat: show the running round and let the queue be advanced"
```

---

### Task 8: Jobgegevens in de historie

**Files:**
- Modify: `src/app/api/admin/import-batches/route.ts`
- Modify: `src/app/(portal)/admin/imports/data-sync-tab.tsx`

- [ ] **Step 1: Voeg de jobgegevens toe aan de batch-route**

Na het ophalen van de batches, in dezelfde route:

```typescript
  // De jobkant erbij: welk venster is opgehaald, bij welke ronde hoorde het, en
  // de hoeveelste poging was het. Eén extra query in plaats van een tweede
  // verzoek vanuit het scherm, zodat de twee helften van een regel niet uit de
  // pas kunnen lopen.
  const jobs = batches.length
    ? await prisma.syncJob.findMany({
        where: { importBatchId: { in: batches.map((b) => b.id) } },
        select: {
          importBatchId: true, runId: true, source: true, sequence: true,
          attempts: true, windowFrom: true, windowTo: true, status: true,
        },
      })
    : [];
  const jobMap = new Map(jobs.map((j) => [j.importBatchId!, j]));
```

En geef in het antwoord per batch `job: jobMap.get(b.id) ?? null` mee.

- [ ] **Step 2: Toon het in de tabel**

Twee kolommen erbij: **Window** (`10 Aug – 18 Aug`, uit `windowFrom`/`windowTo`) en **Run** (het schema uit `source`, plus de hoeveelste poging als `attempts` groter is dan 1). Beide leeg als er geen job bij hoort — dat is het geval bij handmatige imports en bij de oude DAX-flows.

Voeg in de bestaande foutdialoog `skippedSuppliers` toe als dat in `details` staat: een lijst van `rel_id` met het aantal weggegooide partijen, aflopend gesorteerd. Dat is de vraag "waarom mist er data" en het antwoord staat er al, alleen wordt het nu niet getoond.

- [ ] **Step 3: Controleer op test**

Open Data Sync.
Expected: de rondes van 17 augustus tonen hun venster — `nightly` met `costs` op 29 dagen en de rest op 8 — en het schema in de Run-kolom. Open de foutdialoog van een `lots`-batch en controleer dat de overgeslagen leveranciers zichtbaar zijn.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/admin/import-batches/route.ts "src/app/(portal)/admin/imports"
git commit -m "feat: show the window, round and skipped suppliers in the import history"
```

---

## Wat er na dit plan staat

- De schema's zijn in te stellen zonder SQL, met een waarschuwing bij waarden die stilzwijgend data laten missen
- De lopende ronde is zichtbaar, job voor job, en met de hand vooruit te duwen — nodig op test, waar de cron niet vuurt
- De historie vertelt niet alleen wat er binnenkwam maar ook over welk venster, bij welke ronde, en welke leveranciers zijn overgeslagen
- "Wanneer liep dit schema voor het laatst helemaal goed" is beantwoord, en dat vult het gat dat `lastRunAt` per constructie niet kon vullen

**Wat er niet in zit:** de backfill per leverancier. Die krijgt een eigen ontwerp, nu tegen een wachtrij die bediend kan worden.
