# Sync-motor Implementatieplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** De portal bepaalt wanneer er gesynchroniseerd wordt, bouwt de SQL zelf op en laat Power Automate die alleen uitvoeren — zodat de reguliere sync op test volledig portal-gestuurd draait.

**Architecture:** Een Vercel-cron tikt elke vijf minuten op `/api/sync/tick`. Die tick kijkt in `SyncSchedule` of er een ronde due is, zet per endpoint een `SyncJob` klaar in de vaste volgorde, en stuurt er hoogstens één tegelijk naar Power Automate met de opgebouwde query erbij. Power Automate draait de query en post het resultaat naar `/api/import/<endpoint>`, dat de meegegeven `batchId` afrondt. Vastgelopen jobs worden door dezelfde tick opgeruimd.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Prisma 6 op Neon, Vercel Cron, Power Automate met de SQL Server-connector op Fabric `wh_transform`.

**Spec:** [`docs/superpowers/specs/2026-08-15-portal-gestuurde-sync-design.md`](../specs/2026-08-15-portal-gestuurde-sync-design.md)

**Buiten dit plan** (komt in plan 2): de backfill per leverancier, de knop op de leverancierspagina, en het admin-bedieningsscherm. Dit plan levert de motor; plan 2 levert de bediening.

---

## Voorwaarden

Twee dingen moeten door een mens gedaan worden voordat taak 5 kan slagen. Ze staan als taak 4 in dit plan beschreven, maar plan ze desnoods eerder in.

- **Twee flows in Power Automate** — zie taak 4 voor de exacte inhoud
- **Drie omgevingsvariabelen** in Vercel (test én productie) en in de lokale `.env`:
  `PA_WEBHOOK_ASK_URL`, `PA_WEBHOOK_FETCH_URL`, `CRON_SECRET`

De bestaande variabele `NEXT_PUBLIC_APP_ENV` (`test` | `production` | `development`) bepaalt de `env`-vlag in de payload. Die wordt niet opnieuw aangemaakt.

---

## Bestandsstructuur

| bestand | verantwoordelijkheid |
|---|---|
| `prisma/schema.prisma` | *wijzigen* — `SyncJob` en `SyncSchedule` erbij |
| `src/lib/sync/types.ts` | gedeelde types: endpoint-union, venster, omgeving |
| `src/lib/sync/queries/costs.ts` | query-bouwer voor `costs` |
| `src/lib/sync/queries/suppliers.ts` | idem voor `suppliers` |
| `src/lib/sync/queries/growers.ts` | idem voor `growers` |
| `src/lib/sync/queries/lots.ts` | idem voor `lots` |
| `src/lib/sync/queries/orders.ts` | idem voor `orders` |
| `src/lib/sync/queries/index.ts` | register: endpoint → bouwer |
| `src/lib/sync/schedule.ts` | pure beslissing: is deze ronde due? |
| `src/lib/sync/dispatch.ts` | de twee Power Automate-flows aanroepen |
| `src/lib/sync/runner.ts` | ronde klaarzetten, volgende job versturen, vastlopers opruimen |
| `src/app/api/sync/tick/route.ts` | de cron-ingang |
| `src/lib/import-batch.ts` | gedeelde omhulling voor de vijf import-routes |
| `src/app/api/import/*/route.ts` | *wijzigen* — omhulling gebruiken, `batchId` accepteren |
| `vercel.json` | de cron-definitie |
| `scripts/checks/*.ts` | controlescripts voor de pure functies |
| `scripts/seed-sync-schedules.ts` | de twee schemaregels aanmaken |

**Over de controlescripts.** Dit project heeft geen testframework en dit plan voert er geen in. De pure functies — de query-bouwers en de due-beslissing — worden gecontroleerd met losse scripts onder `scripts/checks/`, uitvoerbaar met `npx tsx`, die bij een fout met exitcode 1 stoppen. Dat is dezelfde aanpak waarmee de `_x0020_`-fix is geverifieerd, en ze blijven in de repo staan zodat een volgende wijziging ze opnieuw kan draaien.

---

### Task 1: Datamodel

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `scripts/seed-sync-schedules.ts`

- [ ] **Step 1: Voeg de twee modellen toe aan het schema**

Plak onderaan `prisma/schema.prisma`:

```prisma
model SyncJob {
  id               String    @id @default(uuid())
  runId            String
  sequence         Int
  endpoint         String
  windowFrom       DateTime
  windowTo         DateTime
  supplierFabricId Int?
  source           String
  status           String    @default("pending")
  attempts         Int       @default(0)
  importBatchId    String?
  lastError        String?
  createdAt        DateTime  @default(now())
  dispatchedAt     DateTime?
  completedAt      DateTime?

  @@index([status, createdAt])
  @@index([runId, sequence])
  @@index([importBatchId])
}

model SyncSchedule {
  name        String    @id
  enabled     Boolean   @default(true)
  intervalMin Int?
  atTime      String?
  endpoints   String[]
  windowDays  Int
  lastRunAt   DateTime?
}
```

- [ ] **Step 2: Stop de dev-server en push het schema**

Op Windows geeft `prisma generate` een EPERM-fout als de dev-server draait.

Run: `npx prisma db push`
Expected: `Your database is now in sync with your Prisma schema.` gevolgd door `Generated Prisma Client`

- [ ] **Step 3: Schrijf het seed-script**

Create `scripts/seed-sync-schedules.ts`:

```typescript
/**
 * Zet de twee schemaregels klaar. Idempotent: opnieuw draaien verandert niets
 * aan een regel die je daarna handmatig hebt bijgesteld.
 */
import { prisma } from "../src/lib/db";

async function main() {
  await prisma.syncSchedule.upsert({
    where: { name: "short" },
    update: {},
    create: {
      name: "short",
      enabled: false,
      intervalMin: 60,
      endpoints: ["lots", "orders", "costs"],
      windowDays: 45,
    },
  });

  await prisma.syncSchedule.upsert({
    where: { name: "nightly" },
    update: {},
    create: {
      name: "nightly",
      enabled: false,
      atTime: "03:00",
      endpoints: ["suppliers", "growers", "lots", "orders", "costs"],
      windowDays: 45,
    },
  });

  const all = await prisma.syncSchedule.findMany();
  console.log(JSON.stringify(all, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

Beide staan bewust op `enabled: false`. De motor wordt pas aangezet in taak 10, als hij compleet is.

- [ ] **Step 4: Draai het seed-script**

Run: `npx tsx scripts/seed-sync-schedules.ts`
Expected: twee objecten in de uitvoer, `short` met `intervalMin: 60` en `nightly` met `atTime: "03:00"`, beide `enabled: false`

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma scripts/seed-sync-schedules.ts
git commit -m "feat: add SyncJob and SyncSchedule models"
```

---

### Task 2: Gedeelde types

**Files:**
- Create: `src/lib/sync/types.ts`

- [ ] **Step 1: Schrijf het typebestand**

Create `src/lib/sync/types.ts`:

```typescript
/**
 * De vijf endpoints, in de volgorde waarin ze moeten draaien. De volgorde is
 * een harde afhankelijkheid: de lots-import zoekt de leverancier op en gooit de
 * partij stilzwijgend weg als die nog niet bestaat.
 */
export const SYNC_ENDPOINTS = [
  "suppliers",
  "growers",
  "lots",
  "orders",
  "costs",
] as const;

export type SyncEndpoint = (typeof SYNC_ENDPOINTS)[number];

export function isSyncEndpoint(value: string): value is SyncEndpoint {
  return (SYNC_ENDPOINTS as readonly string[]).includes(value);
}

/** Sorteert een lijst endpoints in de verplichte volgorde. */
export function inChainOrder(endpoints: readonly string[]): SyncEndpoint[] {
  return SYNC_ENDPOINTS.filter((e) => endpoints.includes(e));
}

export type QueryWindow = {
  from: Date;
  /** Exclusief: de query gebruikt `< to`, zodat aangrenzende brokken niet overlappen. */
  to: Date;
  /** Fabric rel_id_leverancier. Alleen gevuld bij een backfill voor één leverancier. */
  supplierFabricId?: number | null;
};

/**
 * Bepaalt naar welke portal Power Automate het resultaat terugstuurt. Komt uit
 * de omgevingsvariabele van de deployment en nooit uit een request — anders kan
 * één verkeerde aanroep testdata naar productie duwen.
 */
export type SyncEnv = "test" | "production";

export function resolveSyncEnv(): SyncEnv | null {
  const env = process.env.NEXT_PUBLIC_APP_ENV;
  if (env === "production") return "production";
  if (env === "test") return "test";
  return null; // development: niets versturen, Power Automate kan localhost niet bereiken
}
```

- [ ] **Step 2: Controleer dat het compileert**

Run: `npx tsc --noEmit`
Expected: geen uitvoer

- [ ] **Step 3: Commit**

```bash
git add src/lib/sync/types.ts
git commit -m "feat: add shared sync types and chain order"
```

---

### Task 3: Query-bouwer voor costs

De costs-query is als eerste aan de beurt omdat hij als enige al bewezen is tegen de echte bron (T3 in `docs/power-automate-sql-fabric.md`).

**Files:**
- Create: `src/lib/sync/queries/costs.ts`
- Create: `scripts/checks/queries.ts`

- [ ] **Step 1: Schrijf het controlescript (dit faalt nog)**

Create `scripts/checks/queries.ts`:

```typescript
import { costsQuery } from "../../src/lib/sync/queries/costs";

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`PASS ${label}`);
  } else {
    failures++;
    console.log(`FAIL ${label}${detail ? " — " + detail : ""}`);
  }
}

const window = { from: new Date("2026-07-01T00:00:00Z"), to: new Date("2026-08-01T00:00:00Z") };

const plain = costsQuery(window);
check("bevat de brontabel", plain.includes("marts.fct_salesheets_costs"));
check("venster begint inclusief", plain.includes("levering_datum >= '2026-07-01'"));
check("venster eindigt exclusief", plain.includes("levering_datum <  '2026-08-01'"));
check("geen leveranciersfilter zonder id", !plain.includes("rel_id_leverancier"));

const filtered = costsQuery({ ...window, supplierFabricId: 12345 });
check("filtert op leverancier", filtered.includes("rel_id_leverancier = 12345"));

// Een id dat geen getal is mag nooit als tekst in de query belanden.
const injected = costsQuery({
  ...window,
  supplierFabricId: "1 OR 1=1" as unknown as number,
});
check("weert niet-numerieke id", !injected.includes("OR 1=1"), injected);

process.exit(failures ? 1 : 0);
```

- [ ] **Step 2: Draai het script om te zien dat het faalt**

Run: `npx tsx scripts/checks/queries.ts`
Expected: FAIL met `Cannot find module` — `costs.ts` bestaat nog niet

- [ ] **Step 3: Schrijf de gedeelde hulpfuncties**

Create `src/lib/sync/queries/helpers.ts`:

```typescript
/** Datum als YYYY-MM-DD in UTC, zodat de tijdzone van de server niet meetelt. */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Zet een leveranciers-id om naar een veilig SQL-fragment. Dit is het enige wat
 * tussen een id en willekeurige SQL staat, dus het gaat door Number() heen en
 * levert bij alles wat geen eindig getal is een lege clausule op.
 */
export function supplierClause(
  column: string,
  supplierFabricId: number | null | undefined
): string {
  if (supplierFabricId === null || supplierFabricId === undefined) return "";
  const id = Number(supplierFabricId);
  if (!Number.isFinite(id)) return "";
  return `AND ${column} = ${Math.trunc(id)}`;
}
```

- [ ] **Step 4: Schrijf de query-bouwer**

Create `src/lib/sync/queries/costs.ts`:

```typescript
import type { QueryWindow } from "../types";
import { isoDate, supplierClause } from "./helpers";

export function costsQuery({ from, to, supplierFabricId }: QueryWindow): string {
  return `
SELECT
  shkost_id        AS "Shkost ID",
  parthdr_id       AS "Parthdr ID",
  kost_id          AS "Kost ID",
  kost_naam        AS "Kost Naam",
  kost_type_code   AS "Kost Type Code",
  kost_type_naam   AS "Kost Type Naam",
  totaal_omzet     AS "Totaal Omzet",
  totaal_verkoop_aantal AS "Totaal Aantal",
  salesheet_amount AS "Salesheet Amount",
  laatste_ontvangstdatum AS "Laatste Ontvangstdatum",
  laatste_aanmelddatum   AS "Laatste Aanmelddatum"
FROM marts.fct_salesheets_costs
WHERE levering_datum >= '${isoDate(from)}'
  AND levering_datum <  '${isoDate(to)}'
  ${supplierClause("rel_id_leverancier", supplierFabricId)}
`.trim();
}
```

**Die laatste twee kolommen zijn niet optioneel.** De costs-route gebruikt ze om `SalesSheet.lastReceiptDate` en `lastRegistrationDate` bij te werken. Laat je ze weg, dan blijft de import slagen en stoppen die twee velden er stil mee — precies het soort regressie dat maanden onopgemerkt blijft.

**De kolomnamen aan de warehouse-kant zijn wel onzeker.** Dat de velden bestaan is bewezen: ze zaten in de SQL-payload van 15 augustus, als `Laatste_x0020_Ontvangstdatum` en `Laatste_x0020_Aanmelddatum`. Maar `scripts/sql/recon-fabric-kosten.sql` selecteert dertien kolommen uit dezelfde tabel en deze twee zitten er niet bij, dus onder welke naam ze in `marts.fct_salesheets_costs` staan is niet vastgelegd. Controleer dat in taak 10 vóór de eerste echte ronde; een verkeerde kolomnaam laat de query hard falen, en dat is precies wat je wilt — luid in plaats van stil.

- [ ] **Step 5: Draai het script om te zien dat het slaagt**

Run: `npx tsx scripts/checks/queries.ts`
Expected: zes regels `PASS`, exitcode 0

- [ ] **Step 6: Commit**

```bash
git add src/lib/sync/queries/helpers.ts src/lib/sync/queries/costs.ts scripts/checks/queries.ts
git commit -m "feat: add costs query builder with typed window and supplier filter"
```

---

### Task 4: De twee flows in Power Automate

Dit is handwerk in de browser, geen code. Zonder deze taak kan taak 5 niet getest worden.

**Files:** geen

- [ ] **Step 1: Maak de flow "sync — vraag"**

- Trigger: *When an HTTP request is received*, "Who can trigger the flow" op `Anyone`, Method en Relative path leeg
- Request Body JSON Schema:

```json
{
  "type": "object",
  "properties": {
    "env": { "type": "string" },
    "query": { "type": "string" }
  }
}
```

- Actie 1: SQL Server → *Execute a SQL query (V2)*, verbinding op Fabric `wh_transform`, query = `@triggerBody()?['query']`. Hernoem de actie naar `SQL`.
- Actie 2: *Response*, statuscode 200, body:

```
@coalesce(body('SQL')?['ResultSets']?['Table1'], json('[]'))
```

**De `coalesce` is niet optioneel.** Een query die nul rijen oplevert laat `Table1` op `null` staan, en de flow antwoordt dan met een lege body van nul bytes in plaats van `[]` — status 200, niets erin. Geverifieerd tegen de echte bron op 16 augustus. Zonder `coalesce` loopt elke aanroep die toevallig niets oplevert stuk op het uitlezen van het antwoord.

- Opslaan en de URL bewaren als `PA_WEBHOOK_ASK_URL`

- [ ] **Step 2: Maak de flow "sync — haal op"**

- Zelfde trigger en instellingen. Schema:

```json
{
  "type": "object",
  "properties": {
    "env": { "type": "string" },
    "endpoint": { "type": "string" },
    "batchId": { "type": "string" },
    "query": { "type": "string" }
  }
}
```

- Actie 1: *Condition* — `@triggerBody()?['endpoint']` moet voorkomen in de lijst toegestane waarden. Gebruik de expressie:

```
@contains(createArray('suppliers','growers','lots','orders','costs'), triggerBody()?['endpoint'])
```

In de If-no tak: *Terminate* met status `Failed`. Zonder deze controle kan iemand met de webhook-URL laten posten naar een willekeurig pad onder de base-URL, mét de import-sleutel eronder.

- Actie 2 (in de If-yes tak): SQL Server → *Execute a SQL query (V2)*, query = `@triggerBody()?['query']`. Hernoem naar `SQL`.
- Actie 3: *Compose* met naam `BaseUrl`, waarde:

```
@if(equals(triggerBody()?['env'], 'production'), 'https://growerportal.apps.coloriginz.com', 'https://growerportal.test.apps.coloriginz.com')
```

- Actie 4: *HTTP* POST naar `@{outputs('BaseUrl')}/api/import/@{triggerBody()?['endpoint']}`
  - Header `Authorization: Bearer <IMPORT_API_KEY>`
  - Header `Content-Type: application/json`
  - Body:

```
{
  "@{triggerBody()?['endpoint']}": @{coalesce(body('SQL')?['ResultSets']?['Table1'], json('[]'))},
  "batchId": "@{triggerBody()?['batchId']}"
}
```

**Ook hier is de `coalesce` niet optioneel**, en hier is hij ernstiger dan in flow 1. Levert de query nul rijen op, dan is `Table1` gelijk aan `null` en wordt de body letterlijk `{"costs": ,"batchId":"…"}` — ongeldige JSON. Een rustige nacht zonder nieuwe kostenregels zou de sync dan laten falen met een foutmelding die nergens naar wijst. Met `coalesce` komt er een lege lijst binnen en antwoorden de import-routes gewoon met `received: 0`.

- **Geen Response-actie.** De trigger antwoordt dan met `202 Accepted` en draait door. Een Response-actie zou de portal laten wachten tot de SQL klaar is, en dat haalt de functietimeout niet.
- Opslaan en de URL bewaren als `PA_WEBHOOK_FETCH_URL`

- [ ] **Step 3: Zet de omgevingsvariabelen klaar**

In Vercel, op **beide** projecten (test en productie), en in de lokale `.env`:

```
PA_WEBHOOK_ASK_URL=<url van flow 1>
PA_WEBHOOK_FETCH_URL=<url van flow 2>
CRON_SECRET=<willekeurige lange string>
```

Deze URL's horen nergens anders: niet in de repo, niet in een script, niet in een gesprekslog.

- [ ] **Step 4: Controleer flow 1 met de hand**

```bash
ASK="$PA_WEBHOOK_ASK_URL" node -e "
(async()=>{const r=await fetch(process.env.ASK,{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({env:'test',query:'SELECT 1 AS een, SYSDATETIME() AS nu'})});
console.log(r.status); console.log(await r.text());})()"
```

Expected: `200` met een array van één object met de velden `een` en `nu`

---

### Task 5: De verzendlaag

**Files:**
- Create: `src/lib/sync/dispatch.ts`

- [ ] **Step 1: Schrijf de verzendlaag**

Create `src/lib/sync/dispatch.ts`:

```typescript
import { resolveSyncEnv } from "@/lib/env";
import type { SyncEndpoint } from "./types";

export class DispatchError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "DispatchError";
  }
}

/**
 * Stelt een kleine vraag aan de bron en wacht op het antwoord. Alleen voor
 * tellingen en min/max — het antwoord komt in de HTTP-response terug, dus het
 * moet per definitie klein zijn.
 */
export async function ask<T = Record<string, unknown>>(query: string): Promise<T[]> {
  const url = process.env.PA_WEBHOOK_ASK_URL;
  if (!url) throw new DispatchError("PA_WEBHOOK_ASK_URL is niet gezet");

  const env = resolveSyncEnv();
  if (!env) throw new DispatchError("Vragen stellen kan niet vanuit development");

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ env, query }),
  });

  if (!response.ok) {
    throw new DispatchError(
      `Vraag-flow gaf ${response.status}: ${(await response.text()).slice(0, 300)}`,
      response.status
    );
  }

  // Tweede laag naast de coalesce in de flow zelf: een query zonder rijen kan een
  // lege body opleveren in plaats van [], en dat is een geldig "niets gevonden".
  // De flow kan later door iemand anders aangepast worden, dus vertrouw er niet op.
  const text = await response.text();
  if (text.trim() === "") return [];
  return JSON.parse(text) as T[];
}

/**
 * Stuurt een query weg om uitgevoerd te worden. Keert direct terug: het
 * resultaat komt later binnen op /api/import/<endpoint>, gekoppeld via batchId.
 */
export async function fetchInto(
  endpoint: SyncEndpoint,
  batchId: string,
  query: string
): Promise<void> {
  const url = process.env.PA_WEBHOOK_FETCH_URL;
  if (!url) throw new DispatchError("PA_WEBHOOK_FETCH_URL is niet gezet");

  const env = resolveSyncEnv();
  if (!env) throw new DispatchError("Versturen kan niet vanuit development");

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ env, endpoint, batchId, query }),
  });

  // 202 is het verwachte antwoord: de flow is gestart en draait door.
  if (!response.ok) {
    throw new DispatchError(
      `Haal-flow gaf ${response.status}: ${(await response.text()).slice(0, 300)}`,
      response.status
    );
  }
}
```

- [ ] **Step 2: Controleer dat het compileert**

Run: `npx tsc --noEmit`
Expected: geen uitvoer

- [ ] **Step 3: Commit**

```bash
git add src/lib/sync/dispatch.ts
git commit -m "feat: add Power Automate dispatch layer"
```

---

### Task 6: De due-beslissing

**Files:**
- Create: `src/lib/sync/schedule.ts`
- Create: `scripts/checks/schedule.ts`

- [ ] **Step 1: Schrijf het controlescript (dit faalt nog)**

Create `scripts/checks/schedule.ts`:

```typescript
import { isDue, windowFor } from "../../src/lib/sync/schedule";

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) console.log(`PASS ${label}`);
  else {
    failures++;
    console.log(`FAIL ${label}${detail ? " — " + detail : ""}`);
  }
}

const short = { name: "short", enabled: true, intervalMin: 60, atTime: null, windowDays: 45 };

check(
  "korte ronde: nooit gedraaid is due",
  isDue({ ...short, lastRunAt: null }, new Date("2026-08-15T10:00:00Z"))
);
check(
  "korte ronde: 59 minuten geleden is niet due",
  !isDue(
    { ...short, lastRunAt: new Date("2026-08-15T09:01:00Z") },
    new Date("2026-08-15T10:00:00Z")
  )
);
check(
  "korte ronde: 61 minuten geleden is due",
  isDue(
    { ...short, lastRunAt: new Date("2026-08-15T08:59:00Z") },
    new Date("2026-08-15T10:00:00Z")
  )
);
check("uitgezet is nooit due", !isDue({ ...short, enabled: false, lastRunAt: null }, new Date()));

const nightly = { name: "nightly", enabled: true, intervalMin: null, atTime: "03:00", windowDays: 45 };

// Zomertijd: 03:00 in Amsterdam is 01:00 UTC.
check(
  "nachtronde: net na 03:00 lokaal is due",
  isDue({ ...nightly, lastRunAt: new Date("2026-08-14T01:05:00Z") }, new Date("2026-08-15T01:05:00Z"))
);
check(
  "nachtronde: om 02:00 lokaal nog niet",
  !isDue({ ...nightly, lastRunAt: new Date("2026-08-14T01:05:00Z") }, new Date("2026-08-15T00:00:00Z"))
);
check(
  "nachtronde: vandaag al gedraaid is niet nogmaals due",
  !isDue({ ...nightly, lastRunAt: new Date("2026-08-15T01:05:00Z") }, new Date("2026-08-15T09:00:00Z"))
);

// Wintertijd: 03:00 in Amsterdam is 02:00 UTC.
check(
  "nachtronde: klopt ook in wintertijd",
  isDue({ ...nightly, lastRunAt: new Date("2026-01-14T02:05:00Z") }, new Date("2026-01-15T02:05:00Z"))
);

const w = windowFor(45, new Date("2026-08-15T10:00:00Z"));
check("venster eindigt in de toekomst", w.to > new Date("2026-08-15T10:00:00Z"));
check(
  "venster kijkt 45 dagen terug",
  w.from.toISOString().slice(0, 10) === "2026-07-01",
  w.from.toISOString()
);

process.exit(failures ? 1 : 0);
```

- [ ] **Step 2: Draai het script om te zien dat het faalt**

Run: `npx tsx scripts/checks/schedule.ts`
Expected: FAIL met `Cannot find module`

- [ ] **Step 3: Schrijf de beslissing**

Create `src/lib/sync/schedule.ts`:

```typescript
import type { QueryWindow } from "./types";

export type ScheduleState = {
  name: string;
  enabled: boolean;
  intervalMin: number | null;
  atTime: string | null;
  windowDays: number;
  lastRunAt: Date | null;
};

const ZONE = "Europe/Amsterdam";

/**
 * De klokstand in Amsterdam op een gegeven moment. Vercel Cron draait op UTC,
 * dus zonder deze omrekening verschuift de nachtronde een uur zodra de
 * wintertijd ingaat.
 */
function localParts(at: Date): { y: number; m: number; d: number; hh: number; mm: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return { y: get("year"), m: get("month"), d: get("day"), hh: get("hour"), mm: get("minute") };
}

/** Minuten sinds middernacht, lokale tijd. */
function minutesOfDay(at: Date): number {
  const { hh, mm } = localParts(at);
  return hh * 60 + mm;
}

/** De lokale kalenderdag als YYYY-MM-DD, om "al gedraaid vandaag" te bepalen. */
function localDay(at: Date): string {
  const { y, m, d } = localParts(at);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parseAtTime(atTime: string): number {
  const [hh, mm] = atTime.split(":").map(Number);
  return hh * 60 + mm;
}

export function isDue(schedule: ScheduleState, now: Date): boolean {
  if (!schedule.enabled) return false;

  // Ronde op interval.
  if (schedule.intervalMin != null) {
    if (!schedule.lastRunAt) return true;
    const elapsed = (now.getTime() - schedule.lastRunAt.getTime()) / 60000;
    return elapsed >= schedule.intervalMin;
  }

  // Ronde op tijdstip: due zodra het lokale tijdstip voorbij is en er vandaag
  // nog niet gedraaid is.
  if (schedule.atTime != null) {
    if (minutesOfDay(now) < parseAtTime(schedule.atTime)) return false;
    if (!schedule.lastRunAt) return true;
    return localDay(schedule.lastRunAt) !== localDay(now);
  }

  return false;
}

/**
 * Het rollende venster. De bovengrens ligt bewust een dag in de toekomst zodat
 * leveringen van vandaag er zeker in vallen, ongeacht tijdzone.
 */
export function windowFor(windowDays: number, now: Date): QueryWindow {
  const to = new Date(now);
  to.setUTCHours(0, 0, 0, 0);
  to.setUTCDate(to.getUTCDate() + 1);

  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - windowDays - 1);

  return { from, to };
}
```

- [ ] **Step 4: Draai het script om te zien dat het slaagt**

Run: `npx tsx scripts/checks/schedule.ts`
Expected: tien regels `PASS`, exitcode 0

- [ ] **Step 5: Commit**

```bash
git add src/lib/sync/schedule.ts scripts/checks/schedule.ts
git commit -m "feat: add schedule due-check with Amsterdam timezone handling"
```

---

### Task 7: De runner

**Files:**
- Create: `src/lib/sync/runner.ts`

- [ ] **Step 1: Schrijf het klaarzetten van een ronde**

Create `src/lib/sync/runner.ts`:

```typescript
import { randomUUID } from "crypto";
import { prisma } from "@/lib/db";
import { isDue, windowFor, type ScheduleState } from "./schedule";
import { inChainOrder, isSyncEndpoint, type SyncEndpoint } from "./types";
import { buildQuery } from "./queries";
import { fetchInto, DispatchError } from "./dispatch";

/** Een job die langer dan dit onderweg is, is dood. */
const STALE_MINUTES = 15;

/**
 * Zet één ronde klaar: per endpoint een job, in de verplichte volgorde.
 * Retourneert het aantal aangemaakte jobs.
 */
export async function enqueueRun(
  schedule: ScheduleState & { endpoints: string[] },
  now: Date
): Promise<number> {
  const endpoints = inChainOrder(schedule.endpoints);
  if (endpoints.length === 0) return 0;

  const window = windowFor(schedule.windowDays, now);
  const runId = randomUUID();

  await prisma.syncJob.createMany({
    data: endpoints.map((endpoint, index) => ({
      runId,
      sequence: index,
      endpoint,
      windowFrom: window.from,
      windowTo: window.to,
      source: schedule.name === "nightly" ? "nightly" : "schedule",
    })),
  });

  await prisma.syncSchedule.update({
    where: { name: schedule.name },
    data: { lastRunAt: now },
  });

  return endpoints.length;
}
```

- [ ] **Step 2: Voeg het claimen en versturen van de volgende job toe**

Plak onder `enqueueRun` in hetzelfde bestand:

```typescript
type ClaimedJob = {
  id: string;
  endpoint: string;
  windowFrom: Date;
  windowTo: Date;
  supplierFabricId: number | null;
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
    RETURNING id, endpoint, "windowFrom", "windowTo", "supplierFabricId"`;

  return rows[0] ?? null;
}

/** Verstuurt de volgende job, als er een klaarstaat. */
export async function dispatchNext(): Promise<string | null> {
  const job = await claimNextJob();
  if (!job) return null;

  if (!isSyncEndpoint(job.endpoint)) {
    await failJob(job.id, `Onbekend endpoint: ${job.endpoint}`);
    return null;
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
    return job.id;
  } catch (error) {
    const message =
      error instanceof DispatchError ? error.message : String(error);
    await failJob(job.id, message, batch.id);
    return null;
  }
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
```

- [ ] **Step 3: Voeg het afbreken van de ronde en het opruimen toe**

Plak onderaan hetzelfde bestand:

```typescript
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
    const retry = job.attempts < 3;

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

  const schedules = await prisma.syncSchedule.findMany();
  let enqueued = 0;
  for (const schedule of schedules) {
    if (isDue(schedule, now)) enqueued += await enqueueRun(schedule, now);
  }

  const dispatched = await dispatchNext();
  return { reaped, enqueued, dispatched };
}
```

- [ ] **Step 4: Schrijf het register van query-bouwers**

Create `src/lib/sync/queries/index.ts`:

```typescript
import type { QueryWindow, SyncEndpoint } from "../types";
import { costsQuery } from "./costs";

type Builder = (window: QueryWindow) => string;

/**
 * Endpoints zonder bouwer geven een duidelijke fout in plaats van een lege
 * query. Ze worden aangevuld in taak 11.
 */
const builders: Partial<Record<SyncEndpoint, Builder>> = {
  costs: costsQuery,
};

export function buildQuery(endpoint: SyncEndpoint, window: QueryWindow): string {
  const builder = builders[endpoint];
  if (!builder) throw new Error(`Nog geen query-bouwer voor endpoint '${endpoint}'`);
  return builder(window);
}
```

- [ ] **Step 5: Controleer dat het compileert**

Run: `npx tsc --noEmit`
Expected: geen uitvoer

- [ ] **Step 6: Commit**

```bash
git add src/lib/sync/runner.ts src/lib/sync/queries/index.ts
git commit -m "feat: add sync runner with ordered queue and stale reaping"
```

---

### Task 8: De cron-ingang

**Files:**
- Create: `src/app/api/sync/tick/route.ts`
- Create: `vercel.json`

- [ ] **Step 1: Schrijf de route**

Create `src/app/api/sync/tick/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { tick } from "@/lib/sync/runner";
import { resolveSyncEnv } from "@/lib/env";

export const maxDuration = 60;

/**
 * De cron-ingang. Vercel stuurt CRON_SECRET mee als Bearer-token; dezelfde
 * header werkt voor een handmatige aanroep tijdens het testen.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is niet gezet" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Lokaal niets versturen: Power Automate kan localhost niet bereiken.
  if (!resolveSyncEnv()) {
    return NextResponse.json({ dryRun: true, reason: "development" });
  }

  // tick() geeft { reaped, enqueued, dispatched, failed } terug. Die laatste is
  // er zodat een cron-run zichtbaar maakt dat er zojuist iets hard misging, in
  // plaats van dat "niets verstuurd" en "verzending mislukt" er hetzelfde uitzien.
  const result = await tick();
  return NextResponse.json(result);
}

// Vercel Cron roept met GET aan.
export const GET = POST;
```

- [ ] **Step 2: Schrijf de cron-definitie**

Create `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/sync/tick",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

Alleen `crons`. Geen `buildCommand`: `package.json` draait al `prisma generate && next build`, en die hier overschrijven breekt de build.

- [ ] **Step 3: Controleer de route lokaal**

Start de dev-server (`npm run dev`) en in een tweede terminal:

```bash
curl_equivalent() {
  node -e "
  (async()=>{const r=await fetch('http://localhost:3000/api/sync/tick',{method:'POST',
  headers:{Authorization:'Bearer '+process.env.CRON_SECRET}});
  console.log(r.status, await r.text());})()"
}
curl_equivalent
```

Expected: `200 {"dryRun":true,"reason":"development"}` als `NEXT_PUBLIC_APP_ENV` lokaal op `development` staat. Staat hij op `test` — en dat is nu het geval in `.env` — dan krijg je een echte tick in de vorm `{"reaped":0,"enqueued":0,"dispatched":null,"failed":null}`. Beide uitkomsten zijn goed; wat je hier controleert is dat de route antwoordt en het token afdwingt. Met de schema's op `enabled: false` doet een echte tick niets.

- [ ] **Step 4: Controleer dat een verkeerd token wordt geweigerd**

```bash
node -e "
(async()=>{const r=await fetch('http://localhost:3000/api/sync/tick',{method:'POST',
headers:{Authorization:'Bearer fout'}});
console.log(r.status, await r.text());})()"
```

Expected: `401 {"error":"Unauthorized"}`

- [ ] **Step 5: Commit**

```bash
git add src/app/api/sync/tick/route.ts vercel.json
git commit -m "feat: add cron entrypoint for sync tick"
```

---

### Task 9: De gedeelde omhulling voor de import-routes

De vijf routes herhalen hetzelfde patroon: auth, batch openen, normaliseren, valideren, batch afsluiten, foutafhandeling. Ze moeten nu allemaal een optionele `batchId` accepteren. Dat vijf keer apart inbouwen is hoe duplicatie ontstaat.

**Files:**
- Create: `src/lib/import-batch.ts`
- Modify: `src/app/api/import/costs/route.ts`

- [ ] **Step 1: Schrijf de omhulling**

Create `src/lib/import-batch.ts`:

```typescript
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
  /** De sleutel waaronder de rijen in de body staan, bv. "costs". */
  bodyKey: string;
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

  const rawRows = Array.isArray(body[options.bodyKey]) ? body[options.bodyKey] : [];
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
```

- [ ] **Step 2: Zet de costs-route om**

Vervang in `src/app/api/import/costs/route.ts` de hele `POST`-functie (regel 35 tot het einde) door:

```typescript
export async function POST(request: NextRequest) {
  return runImport(request, {
    endpoint: "costs",
    bodyKey: "costs",
    rowSchema: costSchema,
    schemaKeys: costKeys,
    aliases: costAliases,
    handler: async (costs) => {
      if (costs.length === 0) return { created: 0, updated: 0, skipped: 0 };
      return upsertCosts(costs);
    },
  });
}
```

Verplaats de bestaande verwerkingslogica **ongewijzigd** naar een functie `upsertCosts(costs)` in hetzelfde bestand. Dat is het blok van regel 93 (`// Round IDs`) tot en met regel 299 (het einde van het `if (affectedSSIds.size > 0)`-blok). Alles daarvoor en daarna — de auth, het aanmaken en bijwerken van de batch, de validatie, de foutafhandeling — vervalt, want dat doet de omhulling nu.

Wijzig aan het verplaatste blok niets anders dan de afsluiting. Waar nu de batch bijgewerkt en de response teruggegeven wordt, komt:

```typescript
return {
  created,
  updated,
  skipped,
  details: { salesSheetsRecalculated: ssRecalculated },
  extra: { salesSheetsRecalculated: ssRecalculated },
};
```

Pas de imports bovenaan aan: `runImport` uit `@/lib/import-batch` erbij, `requireImportAuth` en `summariseImportError` eruit (die zitten nu in de omhulling). `normalizeImportKeys` is daar ook niet meer nodig.

- [ ] **Step 3: Controleer dat het compileert**

Run: `npx tsc --noEmit`
Expected: geen uitvoer

- [ ] **Step 4: Controleer de route met een echte payload**

Met draaiende dev-server, en `IMPORT_API_KEY` uit `.env`:

```bash
node -e "
(async()=>{
const body={costs:[{'Shkost ID':1,'Parthdr ID':2,'Salesheet Amount':5,'Kost Naam':'Test'}]};
const r=await fetch('http://localhost:3000/api/import/costs',{method:'POST',
headers:{'Content-Type':'application/json',Authorization:'Bearer '+process.env.IMPORT_API_KEY},
body:JSON.stringify(body)});
console.log(r.status, await r.text());})()"
```

Expected: `200` met `{"received":1,...,"skipped":1,...}` — de salessheet met `Parthdr ID: 2` bestaat niet, dus de rij wordt overgeslagen. Dat bewijst dat de keten loopt.

- [ ] **Step 5: Controleer dat een kapotte payload nog steeds nette fouten geeft**

```bash
node -e "
(async()=>{
const body={costs:[{'Shkost_x0020_ID':1}]};
const r=await fetch('http://localhost:3000/api/import/costs',{method:'POST',
headers:{'Content-Type':'application/json',Authorization:'Bearer '+process.env.IMPORT_API_KEY},
body:JSON.stringify(body)});
console.log(r.status, await r.text());})()"
```

Expected: `400` met een `problems`-lijst die `Parthdr ID` en `Salesheet Amount` bij naam noemt, en `keysReceived` met de gedecodeerde sleutel

- [ ] **Step 6: Commit**

```bash
git add src/lib/import-batch.ts src/app/api/import/costs/route.ts
git commit -m "refactor: extract shared import wrapper, accept external batchId"
```

---

### Task 10: Eerste echte ronde op test

**Files:** geen wijzigingen; dit is een controle op de omgeving.

- [ ] **Step 0: Controleer de drie onbewezen kolomnamen**

Van de kolommen in de costs-query zijn er drie nooit tegen de echte tabel gedraaid: `laatste_ontvangstdatum`, `laatste_aanmelddatum` en `rel_id_leverancier`. `scripts/sql/recon-fabric-kosten.sql` selecteert dertien kolommen uit `marts.fct_salesheets_costs` en deze drie zitten er geen van alle bij.

`rel_id_leverancier` is de gevaarlijkste: die zit alleen op het backfill-pad, dus een verkeerde naam faalt pas in plan 2, in het pad dat het minst gedraaid wordt. Controleer alle drie nu:

```bash
ASK="$PA_WEBHOOK_ASK_URL" node -e "
(async()=>{const r=await fetch(process.env.ASK,{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({env:'test',query:\"SELECT TOP 1 * FROM marts.fct_salesheets_costs\"})});
console.log(Object.keys((await r.json())[0]).join('\n'));})()"
```

Expected: de lijst bevat `laatste_ontvangstdatum`, `laatste_aanmelddatum` en `rel_id_leverancier`. Heten ze anders, pas dan `src/lib/sync/queries/costs.ts` aan vóór je verder gaat.

- [ ] **Step 1: Push naar test**

```bash
git push origin develop
```

Wacht tot Vercel de deploy heeft afgerond.

- [ ] **Step 2: Zet één job klaar met de hand**

Draai tegen de testdatabase:

```bash
node -e "
const { neon } = require('@neondatabase/serverless');
require('dotenv').config();
const sql = neon(process.env.DATABASE_URL);
const { randomUUID } = require('crypto');
(async()=>{
  const runId = randomUUID();
  const to = new Date(); to.setUTCHours(0,0,0,0); to.setUTCDate(to.getUTCDate()+1);
  const from = new Date(to); from.setUTCDate(from.getUTCDate()-8);
  await sql\`INSERT INTO \"SyncJob\" (id, \"runId\", sequence, endpoint, \"windowFrom\", \"windowTo\", source, status)
    VALUES (\${randomUUID()}, \${runId}, 0, 'costs', \${from.toISOString()}, \${to.toISOString()}, 'manual', 'pending')\`;
  console.log('job klaargezet, venster', from.toISOString().slice(0,10), 'tot', to.toISOString().slice(0,10));
})()"
```

- [ ] **Step 3: Vuur de tick af tegen test**

```bash
node -e "
(async()=>{const r=await fetch('https://growerportal.test.apps.coloriginz.com/api/sync/tick',
{method:'POST',headers:{Authorization:'Bearer '+process.env.CRON_SECRET}});
console.log(r.status, await r.text());})()"
```

Expected: `200` met `{"reaped":0,"enqueued":0,"dispatched":"<job-id>"}`

- [ ] **Step 4: Controleer de uitkomst na een minuut**

```bash
node -e "
const { neon } = require('@neondatabase/serverless');
require('dotenv').config();
const sql = neon(process.env.DATABASE_URL);
(async()=>{
  const jobs = await sql\`SELECT endpoint, status, attempts, \"lastError\", \"importBatchId\"
    FROM \"SyncJob\" ORDER BY \"createdAt\" DESC LIMIT 5\`;
  console.log(JSON.stringify(jobs, null, 2));
  const batches = await sql\`SELECT endpoint, status, \"recordsReceived\", \"recordsCreated\",
    \"recordsUpdated\", \"recordsSkipped\", \"durationMs\" FROM \"ImportBatch\"
    ORDER BY \"startedAt\" DESC LIMIT 3\`;
  console.log(JSON.stringify(batches, null, 2));
})()"
```

Expected: de job op `done` met een `importBatchId`, en die batch op `success` met een `recordsReceived` in dezelfde orde van grootte als de handmatige DAX-runs (enkele duizenden over acht dagen)

Gaat het mis, kijk dan in deze volgorde: staat de job op `failed` met een `lastError` (dan faalde het versturen), staat hij op `dispatched` (dan kwam er niets terug — check de run-historie van de flow), of staat de batch op `error` (dan faalde de validatie en noemt `errorMessage` het veld).

- [ ] **Step 5: Zet de korte ronde aan**

```bash
node -e "
const { neon } = require('@neondatabase/serverless');
require('dotenv').config();
const sql = neon(process.env.DATABASE_URL);
(async()=>{
  await sql\`UPDATE \"SyncSchedule\" SET enabled = true, endpoints = ARRAY['costs']
    WHERE name = 'short'\`;
  console.log(await sql\`SELECT * FROM \"SyncSchedule\"\`);
})()"
```

Voorlopig alleen `costs`, want de andere vier query-bouwers bestaan nog niet. Die komen in taak 11.

**Voor het runbook: `NEXT_PUBLIC_APP_ENV` is niet live te wijzigen.** Next.js vervangt `NEXT_PUBLIC_*` bij het bouwen, ook in servercode. Die variabele in Vercel omzetten heeft dus geen enkel effect tot er opnieuw gedeployd is — juist voor de variabele die bepaalt of data naar test of naar productie terugkomt. Wie hem ooit als noodrem wil gebruiken, denkt dat hij hem heeft omgezet terwijl er niets verandert. De echte noodrem is `SyncSchedule.enabled` op `false` zetten; die staat in de database en werkt onmiddellijk.

- [ ] **Step 6: Controleer dat de ronde bij een tweede tick opnieuw klaargezet wordt**

**Op test vuurt de cron niet.** `develop` is een preview-deployment van het hoofdproject, en Vercel draait cronjobs uitsluitend op production-deployments. Dat blijft zo — er komt geen apart Vercel-project naast. Op test roep je de tick dus met de hand aan; het automatische pad wordt pas op productie voor het eerst echt gedraaid.

Wacht daarom niet op een ronde die vanzelf komt. Vuur de tick een uur na de eerste opnieuw af en controleer dat er een nieuwe ronde klaargezet is:

```bash
node -e "
(async()=>{const r=await fetch('https://growerportal.test.apps.coloriginz.com/api/sync/tick',
{method:'POST',headers:{Authorization:'Bearer '+process.env.CRON_SECRET}});
console.log(r.status, await r.text());})()"
```

Expected: `{"reaped":0,"enqueued":1,...}` — het interval van zestig minuten is verstreken, dus `isDue` geeft waar en er komt een nieuwe job in de wachtrij.

Wil je het automatische pad tóch op test beproeven zonder een tweede Vercel-project, dan is een GitHub Actions-workflow met een `schedule`-trigger die deze URL aanroept de goedkoopste weg. Eén bestand, de sleutel als repository secret. Niet nodig om verder te kunnen, wel de enige manier om de klok zelf te testen vóór productie.

---

### Task 11: De overige vier query-bouwers

**Files:**
- Create: `src/lib/sync/queries/suppliers.ts`, `growers.ts`, `lots.ts`, `orders.ts`
- Modify: `src/lib/sync/queries/index.ts`
- Modify: `scripts/checks/queries.ts`

- [ ] **Step 1: Zoek de kolomnamen op in het warehouse**

De veldnamen die elke query moet opleveren staan vast — dat zijn de Zod-schema's van de vier routes, hieronder overgenomen. Wat je nog niet weet is hoe de kolommen in het warehouse heten. Zoek dat per tabel op met de vraag-flow uit taak 4:

```bash
ASK="$PA_WEBHOOK_ASK_URL" node -e "
(async()=>{const r=await fetch(process.env.ASK,{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({env:'test',query:\"SELECT TOP 1 * FROM marts.fct_partijen\"})});
console.log(Object.keys((await r.json())[0]).join('\n'));})()"
```

Herhaal voor `marts.fct_orders`, en zoek de tabelnamen voor stamdata op — de routes noemen `dim_leverancier` en `dim_kweker`, maar die zijn nog nooit over SQL bevraagd:

```bash
ASK="$PA_WEBHOOK_ASK_URL" node -e "
(async()=>{const r=await fetch(process.env.ASK,{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({env:'test',query:\"SELECT TABLE_SCHEMA, TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME LIKE 'dim%'\"})});
console.log(JSON.stringify(await r.json(), null, 2));})()"
```

`normalizeImportKeys()` vangt verschillen in hoofdletters, spaties en underscores op, dus `shkost_id` en `"Shkost ID"` zijn allebei goed. Wat het niet vangt is een kolom die er helemaal niet is — vandaar dat je eerst kijkt.

- [ ] **Step 2: Dit zijn de velden die elke query moet opleveren**

Overgenomen uit de Zod-schema's van de routes. Optioneel betekent: mag ontbreken, maar als de bron hem heeft wil je hem hebben.

**`lots` — uit `marts.fct_partijen`, venster op leverdatum**

```
part_id, parthdr_id, rel_id_leverancier, Partijnummer          (verplicht)
"Inkoop Factuur Nummer", "Lever Datum/Tijd", "Artikel Naam", "Artikel Code",
"Inkooptype Code", S01, S02, S03, art_id, reden_id_correctie,
"Inkoopfactuur colli", "Inkoopfactuur volume", "Inslag aantal correctie",
"Facttype Sub"
```

Bekend verschil: `"Inkoopfactuur volume"` heet in het warehouse `inkoopfust_volume`. Dat staat al als alias in de route, dus je mag beide kanten op — aliassen in de query is duidelijker.

**`orders` — uit `marts.fct_orders`, venster op leverdatum**

```
part_id, parthdr_id, rel_id_kweker, rel_id_leverancier, _datum_key_vertrek   (verplicht)
ordreg_id, Verkooptype, Verkoopvolume, Verkoop_colli, Afrekenomzet,
"Gem afrekenprijs", bron_feit_extra, reden_id
```

Bekende verschillen, al als alias in de route aanwezig: `Verkoopvolume` = `vor_aantal`, `Verkoop_colli` = `vor_colli`, `"Gem afrekenprijs"` = `afrekenprijs_per_steel`. En let op: **`Afrekenomzet` heeft geen eigen kolom** — het is aantal maal afrekenprijs, dus dat moet de query zelf uitrekenen en aliassen.

**`suppliers` — stamdata, geen venster**

```
Code, Naam, ID                          (verplicht; ID is rel_id_leverancier)
"AM Naam", "AM Code"
```

**`growers` — stamdata, geen venster**

```
Naam, Code, ID                          (verplicht; ID is rel_id_kweker)
"Land Code", "Land Naam", Plaats
```

- [ ] **Step 3: Schrijf de vier bouwers**

Elk bestand volgt hetzelfde patroon als `costs.ts`. De datumgebonden twee:

```typescript
// src/lib/sync/queries/lots.ts
import type { QueryWindow } from "../types";
import { isoDate, supplierClause } from "./helpers";

export function lotsQuery({ from, to, supplierFabricId }: QueryWindow): string {
  return `
SELECT
  part_id,
  parthdr_id,
  rel_id_leverancier,
  partijnummer          AS "Partijnummer",
  inkoopfust_volume     AS "Inkoopfactuur volume",
  …
FROM marts.fct_partijen
WHERE levering_datum >= '${isoDate(from)}'
  AND levering_datum <  '${isoDate(to)}'
  ${supplierClause("rel_id_leverancier", supplierFabricId)}
`.trim();
}
```

Vul de kolomlijst aan met wat je in stap 1 hebt gevonden, in de volgorde van stap 2.

**Bouw de vensters met `Date.UTC`, niet met date-fns.** `isoDate()` snijdt af op UTC, maar `startOfMonth`/`startOfDay` uit date-fns — dat dit project al gebruikt — rekenen in lokale tijd. In Amsterdamse zomertijd wordt `new Date(2026, 7, 1)` het tijdstip `2026-07-31T22:00:00Z`, en `isoDate` maakt daar `2026-07-31` van: een dag te vroeg. Vercel draait op UTC en je werkstation op CET, dus dit gedraagt zich lokaal anders dan op productie en je ziet het pas na een deploy.

**`suppliers` en `growers` kennen geen datumvenster.** Hun bouwers negeren `from` en `to` en gebruiken alleen het leveranciersfilter. Dat is geen slordigheid maar de kern van waarom een backfill stamdata niet in maandbrokken hakt:

```typescript
// src/lib/sync/queries/suppliers.ts
import type { QueryWindow } from "../types";
import { supplierClause } from "./helpers";

export function suppliersQuery({ supplierFabricId }: QueryWindow): string {
  return `
SELECT
  rel_id     AS "ID",
  code       AS "Code",
  naam       AS "Naam",
  am_naam    AS "AM Naam",
  am_code    AS "AM Code"
FROM marts.dim_leverancier
WHERE 1 = 1
  ${supplierClause("rel_id", supplierFabricId)}
`.trim();
}
```

- [ ] **Step 4: Breid het register uit**

Vervang de inhoud van `builders` in `src/lib/sync/queries/index.ts`:

```typescript
const builders: Record<SyncEndpoint, Builder> = {
  suppliers: suppliersQuery,
  growers: growersQuery,
  lots: lotsQuery,
  orders: ordersQuery,
  costs: costsQuery,
};
```

Met alle vijf gevuld mag het type van `Partial<Record<…>>` naar `Record<…>`, waarna de compiler afdwingt dat er geen endpoint vergeten wordt.

- [ ] **Step 5: Breid het controlescript uit**

Voeg aan `scripts/checks/queries.ts` voor elke nieuwe bouwer dezelfde vier controles toe als voor `costs`: bevat de brontabel, venster inclusief, venster exclusief, filter alleen bij een id. Voor `suppliers` en `growers` vervalt de venstercontrole; controleer daar dat het venster juist **niet** in de query staat:

```typescript
import { suppliersQuery } from "../../src/lib/sync/queries/suppliers";

const stam = suppliersQuery(window);
check("stamdata heeft geen datumvenster", !stam.includes("levering_datum"));
check("stamdata filtert wel op leverancier",
  suppliersQuery({ ...window, supplierFabricId: 999 }).includes("rel_id = 999"));
```

- [ ] **Step 6: Draai het controlescript**

Run: `npx tsx scripts/checks/queries.ts`
Expected: alle regels `PASS`, exitcode 0

- [ ] **Step 7: Zet de volledige ketting aan op test**

```bash
node -e "
const { neon } = require('@neondatabase/serverless');
require('dotenv').config();
const sql = neon(process.env.DATABASE_URL);
(async()=>{
  await sql\`UPDATE \"SyncSchedule\" SET endpoints = ARRAY['lots','orders','costs'] WHERE name = 'short'\`;
  await sql\`UPDATE \"SyncSchedule\" SET enabled = true WHERE name = 'nightly'\`;
  console.log(await sql\`SELECT * FROM \"SyncSchedule\"\`);
})()"
```

- [ ] **Step 8: Controleer dat een hele ronde in volgorde loopt**

Vuur de tick af en herhaal dat vijf keer met een halve minuut ertussen. Kijk daarna:

```bash
node -e "
const { neon } = require('@neondatabase/serverless');
require('dotenv').config();
const sql = neon(process.env.DATABASE_URL);
(async()=>{
  const rows = await sql\`SELECT \"runId\", sequence, endpoint, status, \"completedAt\"
    FROM \"SyncJob\" ORDER BY \"createdAt\" DESC, sequence LIMIT 10\`;
  console.log(JSON.stringify(rows, null, 2));
})()"
```

Expected: één `runId` met sequence 0, 1, 2 in de volgorde `lots`, `orders`, `costs`, allemaal `done`, met oplopende `completedAt`. Sequence 1 mag nooit eerder klaar zijn dan sequence 0.

- [ ] **Step 9: Commit**

```bash
git add src/lib/sync/queries/ scripts/checks/queries.ts
git commit -m "feat: add query builders for remaining four endpoints"
```

---

### Task 12: De blinde vlekken dichten

Twee dingen die nu onzichtbaar zijn en die vóór de backfill uit plan 2 opgelost moeten zijn.

**Files:**
- Modify: `src/app/api/import/lots/route.ts`
- Modify: `src/app/(portal)/admin/imports/imports-content.tsx:72`

- [ ] **Step 1: Tel en log het stille overslaan in de lots-import**

In `src/app/api/import/lots/route.ts` staat de plek waar een partij wordt overgeslagen omdat de leverancier niet bestaat (`if (!supplierId)`). Houd daar bij welke `rel_id`'s het betreft:

```typescript
const skippedByRelId = new Map<number, number>();
// op de plek waar wordt overgeslagen:
skippedByRelId.set(relId, (skippedByRelId.get(relId) ?? 0) + 1);
```

En geef dat mee in het resultaat van de handler:

```typescript
details: {
  ...bestaandeDetails,
  skippedSuppliers: Object.fromEntries(
    [...skippedByRelId.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50)
  ),
},
```

Zonder dit herhaalt een backfill precies de fout waardoor COLXROOD en COLXBAK 317 salessheets kwijtraakten, en zie je het opnieuw niet.

- [ ] **Step 2: Controleer dat het zichtbaar wordt**

Draai een lots-ronde op test en kijk in `ImportBatch.details`:

```bash
node -e "
const { neon } = require('@neondatabase/serverless');
require('dotenv').config();
const sql = neon(process.env.DATABASE_URL);
(async()=>{
  const rows = await sql\`SELECT details FROM \"ImportBatch\"
    WHERE endpoint = 'lots' ORDER BY \"startedAt\" DESC LIMIT 1\`;
  console.log(JSON.stringify(rows[0], null, 2));
})()"
```

Expected: een `skippedSuppliers`-object met `rel_id` als sleutel en het aantal overgeslagen partijen als waarde

- [ ] **Step 3: Voeg growers toe aan het admin-scherm**

In `src/app/(portal)/admin/imports/imports-content.tsx` staat op regel 72:

```typescript
const ENDPOINTS = ["suppliers", "lots", "orders", "costs"];
```

Vervang door:

```typescript
const ENDPOINTS = ["suppliers", "growers", "lots", "orders", "costs"];
```

De growers-route schrijft wel batches weg met `endpoint: "growers"`, maar die zijn nu onzichtbaar in de KPI-kaarten en het filter.

- [ ] **Step 4: Controleer het scherm**

Open `/admin/imports` op test.
Expected: vijf KPI-kaarten in plaats van vier, met `growers` erbij en een gevulde "last sync"

- [ ] **Step 5: Commit**

```bash
git add src/app/api/import/lots/route.ts "src/app/(portal)/admin/imports/imports-content.tsx"
git commit -m "feat: log silently skipped lots per supplier, show growers in admin"
```

---

### Task 13: De overige vier routes op de omhulling zetten

Deze taak is losgekoppeld van de rest: de motor werkt al zonder. Doe hem zodra de keten stabiel draait, zodat een fout hier niet met een fout in de motor verward kan worden.

**Files:**
- Modify: `src/app/api/import/suppliers/route.ts`, `growers/route.ts`, `lots/route.ts`, `orders/route.ts`

- [ ] **Step 1: Zet suppliers om**

Zelfde patroon als taak 9 stap 2: de verwerkingslogica naar een functie, de `POST` vervangen door een `runImport`-aanroep met `endpoint: "suppliers"`, `bodyKey: "suppliers"`, het bestaande schema en de bestaande aliassen.

- [ ] **Step 2: Controleer suppliers**

```bash
node -e "
(async()=>{const r=await fetch('http://localhost:3000/api/import/suppliers',{method:'POST',
headers:{'Content-Type':'application/json',Authorization:'Bearer '+process.env.IMPORT_API_KEY},
body:JSON.stringify({suppliers:[]})});
console.log(r.status, await r.text());})()"
```

Expected: `200` met `{"received":0,"created":0,"updated":0,"skipped":0}`

- [ ] **Step 3: Commit suppliers**

```bash
git add src/app/api/import/suppliers/route.ts
git commit -m "refactor: move suppliers import onto shared wrapper"
```

- [ ] **Step 4: Herhaal voor growers, lots en orders**

Per route: omzetten, controleren met een lege payload zoals in stap 2, apart committen. Eén route per commit, zodat een fout terug te draaien is zonder de andere mee te nemen.

- [ ] **Step 5: Draai een volledige ronde op test**

Vuur de tick vijf keer af en controleer met het script uit taak 11 stap 7 dat alle vijf de endpoints in volgorde op `done` komen.

Expected: één `runId`, sequences 0 tot en met 4 in de volgorde `suppliers`, `growers`, `lots`, `orders`, `costs`, allemaal `done`

- [ ] **Step 6: Zet de DAX-kostenstap uit**

In Power Automate: zet de oude flow die `costs` via DAX ophaalt op uit. Vanaf nu is de portal-gestuurde keten de enige die schrijft.

Controleer daarna in de log dat er nog maar één `costs`-batch per cyclus is:

```bash
node -e "
const { neon } = require('@neondatabase/serverless');
require('dotenv').config();
const sql = neon(process.env.DATABASE_URL);
(async()=>{
  const rows = await sql\`SELECT endpoint, status, \"recordsReceived\", \"startedAt\"
    FROM \"ImportBatch\" WHERE endpoint = 'costs' ORDER BY \"startedAt\" DESC LIMIT 6\`;
  console.log(JSON.stringify(rows, null, 2));
})()"
```

Expected: geen twee `costs`-batches meer binnen dezelfde minuut

- [ ] **Step 7: Vóór de merge naar `main` — eerst het schema, dan pas de deploy**

Dit is de enige plek in dit plan waar de volgorde onherstelbaar fout kan gaan.

`vercel.json` staat in de repo-root en gaat dus mee naar `main`. Zodra dat gemerged is begint de cron op productie te tikken, en die roept `tick()` aan, en die bevraagt `SyncJob` en `SyncSchedule`. Die tabellen staan nu **alleen op test**: `prisma db push` is nooit tegen de productiedatabase gedraaid. Zonder die tabellen faalt elke tick met een 500, elke vijf minuten, tot iemand het merkt.

Doe het daarom in deze volgorde:

1. Schema naar productie: `DATABASE_URL` en `DIRECT_URL` uit `.env.production` gebruiken en `npx prisma db push` draaien. Controleer daarna dat `SyncJob` en `SyncSchedule` er echt staan.
2. De twee schemaregels aanmaken op productie met `scripts/seed-sync-schedules.ts`, tegen dezelfde omgeving. Ze staan op `enabled: false`, dus de cron tikt en doet niets — precies wat je wilt tot je bewust aanzet.
3. `CRON_SECRET` moet op productie staan. (Staat er al.)
4. Pas dan mergen.

Controleer na de merge in de Vercel-logs dat `/api/sync/tick` elke vijf minuten een `200` geeft met `{"reaped":0,"enqueued":0,"dispatched":null,"failed":null}`. Dat is het bewijs dat de klok loopt en dat er niets gebeurt — de gezonde toestand vóór het aanzetten.

---

### Task 14: De import-sleutel roteren

De sleutel staat hardgecodeerd in `scripts/backfill.ts:23` en daarmee in de git-historie. Deze taak komt bewust als laatste: nu is er nog maar één flow die hem gebruikt, dus er is maar één plek om bij te werken.

**Files:**
- Modify: `scripts/backfill.ts:22-23`

- [ ] **Step 1: Genereer een nieuwe sleutel**

```bash
node -e "console.log('grp_import_' + require('crypto').randomBytes(24).toString('hex'))"
```

- [ ] **Step 2: Zet hem overal tegelijk om**

In deze volgorde, zodat er geen moment is waarop de flow een sleutel stuurt die de portal niet kent:

1. Vercel test → `IMPORT_API_KEY` → redeploy afwachten
2. de HTTP-actie in de flow "sync — haal op" → header `Authorization: Bearer <nieuw>`
3. lokale `.env`
4. Vercel productie en de oude DAX-flows, zolang die nog draaien

- [ ] **Step 3: Haal de sleutel uit het backfill-script**

Vervang in `scripts/backfill.ts` regel 22-23:

```typescript
const API_BASE = process.env.API_BASE ?? "https://growerportal.test.apps.coloriginz.com";
const API_KEY = process.env.IMPORT_API_KEY;
if (!API_KEY) throw new Error("IMPORT_API_KEY ontbreekt — zet hem in .env");
```

Zowel de sleutel als de doel-URL komen nu uit de omgeving. Dat laatste voorkomt bovendien dat het script per ongeluk naar test schrijft terwijl je productie bedoelde.

- [ ] **Step 4: Controleer dat de keten nog loopt**

Vuur de tick af tegen test en kijk of de volgende batch op `success` komt.

Expected: `200` op de tick, en een nieuwe batch zonder `errorMessage`. Krijg je `401 Invalid API key`, dan staat er ergens uit stap 2 nog een oude waarde.

- [ ] **Step 5: Commit**

```bash
git add scripts/backfill.ts
git commit -m "fix: read import key and base url from environment"
```

---

## Wat er na dit plan staat

- De portal bepaalt wanneer er gesynchroniseerd wordt, via twee instelbare schema's
- De query's staan in de repo en zijn te wijzigen met een commit
- De volgorde van de endpoints is een eigenschap van de wachtrij, geen afspraak
- Een vastgelopen run wordt binnen vijftien minuten opgemerkt en drie keer opnieuw geprobeerd
- Het stille overslaan in de lots-import is zichtbaar per leverancier
- De vijf import-routes delen één omhulling in plaats van vijf kopieën
- De import-sleutel staat niet meer in de broncode

**Wat er nog niet staat, en in plan 2 komt:** de backfill per leverancier met de opzoekvraag en de maandbrokken, de knop op de leverancierspagina, en het admin-scherm om de schema's en de wachtrij te bedienen. Tot dan worden de schema's aangepast met een script tegen de database.

### Aantekeningen voor plan 2

Uit de kwaliteitsreview van taak 1. Geen van deze punten blokkeert dit plan; ze worden pas relevant zodra het bedieningsscherm er komt.

**Validatie hoort op het scherm, niet in het schema.** Niets garandeert dat precies één van `intervalMin` en `atTime` gezet is — Prisma kan daar geen CHECK op leggen. `isDue` test eerst `intervalMin`, dus bij allebei gevuld wordt `atTime` stil genegeerd, en bij allebei leeg draait de ronde nooit. Zodra het admin-scherm die velden bewerkbaar maakt, hoort de controle daar te zitten.

**Het wachtrijscherm wil per job de cijfers van zijn batch tonen**, en `importBatchId` is een losse string zonder Prisma-relatie. Dat volgt bewust het patroon van de drie staging-tabellen, maar het betekent wel een tweede query met handmatige koppeling. Als dat scherm er komt is het moment om te wegen of er alsnog een relatie op moet.

**`SyncJob` groeit onbeperkt** — ongeveer 26.000 rijen per jaar uit de uurronde, plus zo'n 110 per leverancier-backfill. Voor Postgres is dat niets en de indexen raken alleen het kleine `pending`/`dispatched`-deel. Het telt pas voor de paginering van het wachtrijscherm.

**Een lopende backfill vertraagt de reguliere ronde.** De eerste `NOT EXISTS` in de claim-query is globaal, niet per `runId`: staat er één job onderweg, dan mag er niets bij. Dat is precies wat §10 wil ("er staat er hoogstens één tegelijk uit"), maar het betekent wel dat een backfill van veertig maandbrokken de nachtronde kan opschuiven. Zolang een brok binnen enkele seconden klaar is valt dat weg in de ruis; wordt een brok traag, dan is dit de plek om een uitzondering te maken voor het reguliere schema.

**Een backfill zonder `fabricId` haalt het hele warehouse op.** `supplierFabricId` is nullable in `SyncJob` maar niet in `QueryWindow`; de runner zet `null` om naar `undefined`, en dat betekent "geen filter". Voor een reguliere ronde klopt dat, voor een backfill is het rampzalig. Het klaarzetten van backfill-jobs moet afdwingen dat het id gevuld is — in de code die de brokken maakt, niet in de query-bouwer.

**`durationMs` meet na taak 9 iets anders dan voorheen.** De omhulling begint te tellen zodra de terugpost binnenkomt, terwijl de batch al geopend werd bij het versturen. Bij een portal-gestuurde ronde dekt `durationMs` dus alleen het verwerken van de rijen, niet de wachttijd op Power Automate. Het importscherm toont dat veld, dus de getallen zakken daar optisch in zodra taak 13 de rest van de routes omzet. De echte doorlooptijd staat wel in `completedAt` min `startedAt`; bereken het daar.

**Een verzonnen `batchId` verdwijnt geruisloos.** De omhulling valideert niet of de meegestuurde batch bestaat; een `update` op een onbekend id gooit en wordt binnen de foutafhandeling stilgeslikt, want batch-logging mag een import niet blokkeren. Terecht defensief, maar een aanroeper met een typefout in het id merkt niets. Zodra er meer aanroepers dan de runner komen, is dit het moment om er een waarschuwing van te maken.

**Batch en job kunnen uiteenlopen na een reap.** `markJobDone` filtert op `status: "dispatched"`. Komt de terugpost ná het kwartier waarop de reaper de job terugzette, dan wordt de batch wel `success` maar blijft de job op `pending` of `failed`. Dat is de veilige kant — een laat antwoord kan geen job dood verklaren die inmiddels opnieuw uitstaat — maar het wachtrijscherm moet ermee overweg kunnen.

**Een mislukte poging laat zijn batch achter.** Zet `reapStaleJobs` een job terug op `pending`, dan blijft `importBatchId` naar de gefaalde batch wijzen tot de volgende verzending hem overschrijft. Die `error`-batch blijft dus in de importmonitor staan zonder job die er nog naar verwijst. Waarschijnlijk gewenst — het wás een echte mislukte poging — maar het wachtrijscherm moet er niet over struikelen.
