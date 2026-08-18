# Doorklikbare import Implementatieplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vanuit het importscherm doorklikken naar de records die een ronde heeft aangeraakt, en naar de leveranciers wier partijen zijn weggegooid — met de knop om die aan te maken.

**Architecture:** Vier modellen krijgen een `lastImportBatchId` die de import bij het wegschrijven zet; het scherm bevraagt daarop. Overgeslagen records bestaan niet, dus die kant werkt anders: `skippedSuppliers` in `ImportBatch.details` wordt uitgebreid met een productie-telling, gejoind met `FabricRelation`, en gesplitst in kwekers die je mogelijk wilt aanzetten en interne boekingen die er niet horen.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript strict, Prisma 6 op Neon, PostgreSQL met rauwe SQL in de upserts, Tailwind 4 + shadcn/ui.

**Spec:** [`docs/superpowers/specs/2026-08-18-doorklikbare-import-design.md`](../specs/2026-08-18-doorklikbare-import-design.md)

## Global Constraints

- Werk op `develop`, committeer direct, geen feature branch of worktree.
- **Niet naar `main` mergen.**
- **Raak de productiedatabase niet aan.** Alleen `.env` (test).
- **Zet geen schema aan of uit.** `intraday` en `nightly` staan aan op test; laat ze zo.
- TypeScript strict. `npx tsc --noEmit` schoon en `npm run check` groen (nu 124 controles) bij elke commit.
- Geen testframework. Pure functies krijgen een controlescript onder `scripts/checks/`; de rest wordt op test geverifieerd.
- Dev-server: `NODE_OPTIONS='--max-old-space-size=2048' npx next dev`. **`npm run dev` werkt niet op Windows**, ook niet vanuit bash — npm draait scripts via cmd.exe. Afsluiten met `npx kill-port 3000`. **Gebruik NOOIT `taskkill //F //IM node.exe`.**
- Draai geen `npm run build`. Eslint over het admin-scherm duurt lang; draai hem per bestand.
- UI-teksten in het Engels, code en commentaar in het Engels, commit messages in het Engels.

## Over de vorm van dit plan

Voor het schema, de upserts en de routes staat de wijziging precies aangewezen, want daar telt de letter. Voor de schermen staat de datavorm en de opbouw beschreven maar niet elke regel JSX: het bestaande importscherm is de norm en die volgen levert een beter resultaat dan een voorgeschreven opmaak. Wijk je ervan af, meld dat dan.

Bij taak 6 zijn de zeven controles de specificatie van de functie, niet de beschrijving eronder. Slaagt een controle niet, dan zit de fout in de implementatie; denk je dat een controle zelf verkeerd is, meld dat dan in plaats van hem te wijzigen.

## Het haakje waar alles aan hangt

`runImport()` in `src/lib/import-batch.ts` geeft het batch-id al door als tweede argument aan de handler:

```typescript
handler: (rows: Row[], batchId: string | null) => Promise<{...}>
```

Alle vier de routes negeren dat argument nu (`handler: async (costs) => ...`). Elke route-taak begint dus met het argument aannemen en doorgeven aan zijn upsert-functie.

`batchId` kan `null` zijn — het aanmaken van de batch mag een import niet blokkeren, dus dat pad bestaat. De kolom is daarom nullable en `null` schrijven is geldig.

## Hoe je dit verifieert, en hoe niet

**Niet met Run now.** Power Automate post naar de *gedeployde* testomgeving: de portal stuurt nooit een callback-URL mee, hij zegt alleen `env: "test"` en de flow kiest daar zelf zijn base-URL bij. Dat is een bewuste veiligheidskeuze uit het sync-ontwerp, maar het betekent dat een ronde die je vanaf je lokale dev-server start de code test die op Vercel staat — niet die van jou. In taak 2 leverde dat een nul op die eruitzag als een bug maar het niet was.

**Waarmee je vergelijkt verschilt per route.** `recordsCreated` telt niet overal hetzelfde. De
lots-route rekent correcties mee in dat getal, en die belanden in `LotCorrection` — een andere tabel,
zonder herkomstkolom. Vergelijk daar dus met `details.lots.created + details.lots.updated` en niet met
de som van de batch-velden, anders lijkt er 68 te ontbreken terwijl alles klopt. Bij orders is
`recordsUpdated` altijd nul omdat die verwijdert en opnieuw invoegt.

**Wel met een directe POST naar de lokale route.** Bouw een payload met één bestaand record en één nieuw, post die naar `http://localhost:3000/api/import/<endpoint>` met `Authorization: Bearer $IMPORT_API_KEY`, en tel daarna hoeveel records het teruggegeven batch-id dragen. Zelfde route-code, zelfde database, echte data — en het raakt beide schrijfpaden.

Ruim je testrecords daarna op, en herstel wat je hebt overschreven. Kun je een originele waarde niet terugvinden, meld dat dan; de eerstvolgende reguliere ronde overschrijft het meestal vanzelf.

## De schrijfpaden

Bijgewerkt op 18 augustus met wat er werkelijk in de code staat. De eerste versie van deze tabel klopte
voor twee van de vier routes niet, en beide keren ontbrak juist een `UPDATE` — het pad waarlangs
bijgewerkte records anders de herkomst van een oudere ronde blijven dragen.

| model | route | pad | bevestigd |
|---|---|---|---|
| `Lot` | lots | rauwe `UPDATE` voor bestaande rijen (~380) | taak 2 |
| `Lot` | lots | rauwe `INSERT … ON CONFLICT DO UPDATE` (~443) | taak 2 |
| `Grower` | orders | rauwe `UPDATE "Grower"` (~154) | taak 3 |
| `Grower` | orders | `createMany`, plus een terugval op losse `create` die dezelfde objecten gebruikt (~167) | taak 3 |
| `Transaction` | orders | rauwe `INSERT`, geen `ON CONFLICT` (~287) | taak 3 |
| `Grower` | growers | `prisma.grower.update()` in een lus (~82) | taak 4 |
| `SalesSheetCost` | costs | rauwe `UPDATE` over een jsonb-array | taak 5 |
| `SalesSheetCost` | costs | `createMany` plus terugval op losse `create` | taak 5 |

**Buiten scope, en waarom.** De orders-route doet ook `UPDATE "Lot"` en `UPDATE "SalesSheet"` om
aggregaten te herberekenen. `Lot` krijgt zijn herkomst al van de lots-route, en `SalesSheet` heeft de
kolom niet — die staat niet bij de vier modellen uit taak 1. Een `DELETE FROM "Transaction"` schrijft
niets weg en valt er dus ook buiten.

**Tel ze zelf voordat je begint.** Grep in de route die je aanpakt op `INSERT INTO`, `UPDATE "`,
`executeRaw`, `createMany`, `.create(` en `.update(`, en meld wat je vindt — ook als het klopt met de
tabel hierboven.

---

## Bestandsstructuur

| bestand | verantwoordelijkheid |
|---|---|
| `prisma/schema.prisma` | *wijzigen* — `lastImportBatchId` op vier modellen |
| `src/app/api/import/lots/route.ts` | *wijzigen* — batch-id in de Lot-upsert; productie-telling in `skippedSuppliers` |
| `src/app/api/import/orders/route.ts` | *wijzigen* — batch-id in de Transaction-insert en de Grower-createMany |
| `src/app/api/import/growers/route.ts` | *wijzigen* — batch-id in de update-lus |
| `src/app/api/import/costs/route.ts` | *wijzigen* — batch-id in alle drie de schrijfpaden |
| `src/lib/sync/skipped.ts` | classificatie kweker versus interne boeking, pure functie |
| `scripts/checks/skipped.ts` | controles daarvoor |
| `src/app/api/admin/import-batches/[id]/skipped/route.ts` | overgeslagen relaties, gejoind en gegroepeerd |
| `src/app/api/admin/import-batches/[id]/records/route.ts` | de records van één ronde, gepagineerd |
| `src/app/(portal)/admin/imports/skipped-dialog.tsx` | de twee groepen met de aanmaakknop |
| `src/app/(portal)/admin/imports/batch-records-dialog.tsx` | het paneel met de records |
| `src/app/(portal)/admin/imports/data-sync-tab.tsx` | *wijzigen* — de aantallen aanklikbaar |

---

### Task 1: De kolom

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: `lastImportBatchId String?` op `Lot`, `Transaction`, `Grower`, `SalesSheetCost`, met index. Taken 2 tot en met 5 vullen hem.

- [ ] **Step 1: Voeg het veld toe aan de vier modellen**

Op elk van `Lot`, `Transaction`, `Grower` en `SalesSheetCost`:

```prisma
  /// Welke ImportBatch dit record voor het laatst heeft aangeraakt. Losse string
  /// zonder relatie, net als de staging-tabellen: batches worden nooit verwijderd
  /// en een onDelete-regel zou hier dus niets doen.
  lastImportBatchId String?

  @@index([lastImportBatchId])
```

- [ ] **Step 2: Push het schema naar de testdatabase**

Controleer eerst wat er zou gebeuren, want deze tabellen bevatten echte data:

```bash
npx prisma migrate diff --from-url "$DIRECT_URL" --to-schema-datamodel prisma/schema.prisma --script
```

Expected: uitsluitend `ALTER TABLE ... ADD COLUMN` en `CREATE INDEX`. **Zie je een `DROP` of een `ALTER COLUMN`, stop dan en meld het** — dan wijkt het schema ergens anders af en zou `db push` dat meenemen.

Daarna: `npx prisma db push`
Expected: `Your database is now in sync with your Prisma schema.`

- [ ] **Step 3: Controleer dat de vier kolommen er staan**

```bash
node -e "
require('dotenv').config({quiet:true});
const {neon}=require('@neondatabase/serverless');
const sql=neon(process.env.DATABASE_URL);
(async()=>{
  const r=await sql\`SELECT table_name, column_name FROM information_schema.columns
    WHERE column_name='lastImportBatchId' ORDER BY table_name\`;
  console.log(r.map(x=>x.table_name).join(', '));
})()"
```

Expected: `Grower, Lot, SalesSheetCost, Transaction`

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat: add lastImportBatchId to the four imported models"
```

---

### Task 2: De lots-import schrijft zijn herkomst

**Files:**
- Modify: `src/app/api/import/lots/route.ts`

**Interfaces:**
- Consumes: `lastImportBatchId` uit taak 1, `batchId` uit de handler-signatuur van `runImport`

- [ ] **Step 1: Neem het batch-id aan**

De `POST` roept nu aan met `handler: async (partijen) => ...`. Maak daar `async (partijen, batchId) =>` van en geef het door aan `upsertLots(partijen, batchId)`.

- [ ] **Step 2: Zet het in de Lot-upsert**

De rauwe `INSERT INTO "Lot"` (rond regel 443) wordt aangeroepen met `$executeRawUnsafe(query, JSON.stringify(lotJsonData))`. Het batch-id is voor de hele aanroep hetzelfde, dus het hoeft niet in elke JSON-rij — geef het als tweede parameter mee.

Drie plekken in die query:

1. In de kolomlijst, achter `"correctionVolume"`: `"lastImportBatchId",`
2. In de `SELECT`, op dezelfde positie: `$2,`
3. In de `ON CONFLICT ... DO UPDATE SET`: `"lastImportBatchId" = EXCLUDED."lastImportBatchId",`

En de aanroep wordt `$executeRawUnsafe(query, JSON.stringify(lotJsonData), batchId)`.

Die derde plek is de belangrijkste en de makkelijkste om te vergeten: zonder die regel krijgt een bijgewerkte partij de herkomst van de ronde die hem ooit aanmaakte, niet die van de ronde die hem zojuist aanraakte.

- [ ] **Step 3: Verifieer tegen een echte ronde**

Start de dev-server, log in als admin, en druk op **Run now** bij `intraday` in de Schema's-tab. Duw de wachtrij door met **Advance queue** tot de lots-job klaar is.

Controleer daarna:

```bash
node -e "
require('dotenv').config({quiet:true});
const {neon}=require('@neondatabase/serverless');
const sql=neon(process.env.DATABASE_URL);
(async()=>{
  const b=await sql\`SELECT id,\"startedAt\",\"recordsCreated\",\"recordsUpdated\" FROM \"ImportBatch\"
    WHERE endpoint='lots' ORDER BY \"startedAt\" DESC LIMIT 1\`;
  console.log('batch', b[0].id, 'cr='+b[0].recordsCreated, 'up='+b[0].recordsUpdated);
  const n=await sql\`SELECT COUNT(*) AS n FROM \"Lot\" WHERE \"lastImportBatchId\"=\${b[0].id}\`;
  console.log('lots met deze herkomst:', n[0].n);
})()"
```

Expected: het aantal partijen met die herkomst is gelijk aan `recordsCreated + recordsUpdated` van die batch. Is het nul, dan is stap 2 niet aangekomen; is het alleen gelijk aan `recordsCreated`, dan ontbreekt de regel in `DO UPDATE SET`.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/import/lots/route.ts
git commit -m "feat: record which run last touched each lot"
```

---

### Task 3: De orders-import schrijft zijn herkomst

**Files:**
- Modify: `src/app/api/import/orders/route.ts`

- [ ] **Step 1: Neem het batch-id aan en geef het door aan `upsertOrders`**

Zelfde patroon als taak 2 stap 1.

- [ ] **Step 2: Zet het in de Transaction-insert**

De rauwe `INSERT INTO "Transaction"` staat rond regel 285. Deze route werkt met delete-en-opnieuw-invoegen, dus er is geen `ON CONFLICT DO UPDATE` — alleen een kolomlijst en een `SELECT`. Twee plekken dus, niet drie.

Geef het batch-id als extra parameter mee, net als bij lots.

- [ ] **Step 3: Zet het ook in de Grower-createMany**

Deze route maakt ook kwekers aan (`prisma.grower.createMany`, rond regel 167). Voeg `lastImportBatchId: batchId` toe aan de data die daar wordt opgebouwd.

Dat `Grower` door twee routes geschreven wordt is bestaand gedrag; het betekent alleen dat de herkomst van een kweker van beide kan komen. Dat is juist informatief.

- [ ] **Step 4: Verifieer tegen een echte ronde**

Zelfde aanpak als taak 2 stap 3, maar dan voor `Transaction` en de laatste `orders`-batch.

Expected: het aantal transacties met die herkomst is gelijk aan `recordsCreated` van die batch. Deze route telt `recordsUpdated` altijd als nul omdat hij verwijdert en opnieuw invoegt, dus vergelijk alleen met `recordsCreated`.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/import/orders/route.ts
git commit -m "feat: record which run last touched each transaction"
```

---

### Task 4: De growers-import schrijft zijn herkomst

**Files:**
- Modify: `src/app/api/import/growers/route.ts`

- [ ] **Step 1: Neem het batch-id aan en geef het door**

- [ ] **Step 2: Zet het in de update-lus**

Deze route gebruikt geen rauwe SQL maar `prisma.grower.update()` in een lus (rond regel 82). Voeg `lastImportBatchId: batchId` toe aan de `data` van die update.

Let op: deze route werkt vrijwel alleen bij — van 2.800 ontvangen rijen zijn er doorgaans twee gewijzigd en 2.638 onbekend in de portal. Het aantal kwekers dat na een ronde de nieuwe herkomst draagt is dus klein, en dat is correct.

- [ ] **Step 3: Verifieer tegen een echte ronde**

Zet met **Run now** een `nightly`-ronde klaar en duw hem door tot de growers-job klaar is. Controleer dat het aantal kwekers met die herkomst gelijk is aan `recordsUpdated` van die batch.

Expected: een klein getal, meestal onder de tien. Nul is verdacht — dan is er niets bijgewerkt óf het veld komt niet aan; controleer welke van de twee door naar `recordsUpdated` te kijken.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/import/growers/route.ts
git commit -m "feat: record which run last touched each grower"
```

---

### Task 5: De kosten-import schrijft zijn herkomst

De lastigste van de vier: drie schrijfpaden.

**Files:**
- Modify: `src/app/api/import/costs/route.ts`

- [ ] **Step 1: Neem het batch-id aan en geef het door aan `upsertCosts`**

- [ ] **Step 2: Pad 1 — de rauwe UPDATE**

`prisma.$executeRawUnsafe` met `UPDATE "SalesSheetCost" AS t SET ... FROM jsonb_array_elements($1::jsonb)`. Voeg toe aan de `SET`:

```sql
  "lastImportBatchId" = $2,
```

en geef het batch-id als tweede parameter mee.

- [ ] **Step 3: Pad 2 — de createMany**

`prisma.salesSheetCost.createMany({ data: costCreateData })`. Voeg `lastImportBatchId: batchId` toe aan elk object dat in `costCreateData` wordt gestopt.

- [ ] **Step 4: Pad 3 — de terugval op losse creates**

Als `createMany` faalt valt de route terug op `prisma.salesSheetCost.create()` per rij. Die gebruikt dezelfde objecten uit `costCreateData`, dus als stap 3 goed is gedaan is dit pad automatisch gedekt. **Controleer dat expliciet** en meld het — als die terugval eigen objecten opbouwt, moet het daar ook bij.

- [ ] **Step 5: Verifieer tegen een echte ronde**

Zelfde aanpak. Expected: het aantal kostenregels met die herkomst is gelijk aan `recordsCreated + recordsUpdated`.

Deze is het meest de moeite waard om goed te controleren: bij de laatste nachtronde was dat 833 bijgewerkt en nul aangemaakt, dus als alleen pad 2 werkt en pad 1 niet, ziet het eruit alsof er niets is geraakt.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/import/costs/route.ts
git commit -m "feat: record which run last touched each cost line"
```

---

### Task 6: Kwekers en interne boekingen uit elkaar

**Files:**
- Modify: `src/app/api/import/lots/route.ts`
- Create: `src/lib/sync/skipped.ts`
- Create: `scripts/checks/skipped.ts`
- Modify: `package.json` (het `check`-script)

**Interfaces:**
- Produces: `type SkippedRelation = { relId: number; partijen: number; productie: number }` en `classificeerOvergeslagen(skipped): { kwekers: SkippedRelation[]; interneBoekingen: SkippedRelation[] }`

- [ ] **Step 1: Laat de lots-import de productie-telling bijhouden**

In `upsertLots` staat `skippedByRelId`, een `Map<number, number>`. Die wordt op twee plekken gevuld: bij het overslaan van een hele leveringsgroep, en bij het overslaan van een losse correctie.

Maak er een `Map<number, { partijen: number; productie: number }>` van. Een rij telt als productie wanneer zijn `"Facttype Sub"` begint met `productie` — dat dekt zowel `productie` als `productiecorrectie`.

`details.skippedSuppliers` gaat daarmee van `{ "16699": 172 }` naar `{ "16699": { partijen: 172, productie: 0 } }`.

**Bestaande batches houden de oude vorm.** De classificatie in stap 2 moet daar tegen kunnen: een getal in plaats van een object betekent "aantal partijen, productie onbekend".

- [ ] **Step 2: Schrijf de controles (dit faalt nog)**

Create `scripts/checks/skipped.ts`:

```typescript
import { classificeerOvergeslagen } from "../../src/lib/sync/skipped";

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) console.log(`PASS ${label}`);
  else {
    failures++;
    console.log(`FAIL ${label}${detail ? " — " + detail : ""}`);
  }
}

const codes = (r: { relId: number }[]) => r.map((x) => x.relId).sort((a, b) => a - b);

const gemengd = classificeerOvergeslagen({
  "16699": { partijen: 172, productie: 0 },
  "8623": { partijen: 14, productie: 14 },
  "13397": { partijen: 53, productie: 2 },
});

check("een relatie zonder productie is een kweker", codes(gemengd.kwekers).includes(16699));
check("een relatie met alleen productie is een interne boeking",
  codes(gemengd.interneBoekingen).includes(8623));
check("een gemengde relatie telt als kweker", codes(gemengd.kwekers).includes(13397),
  "wie ook gewone partijen levert is een kweker, ongeacht de productieboekingen");
check("elke relatie komt in precies één groep",
  gemengd.kwekers.length + gemengd.interneBoekingen.length === 3);

const oud = classificeerOvergeslagen({ "16699": 172 });
check("de oude vorm telt als kweker", codes(oud.kwekers).includes(16699),
  "een getal betekent: productie onbekend, dus niet als intern wegzetten");

const leeg = classificeerOvergeslagen(null);
check("niets levert twee lege lijsten", leeg.kwekers.length === 0 && leeg.interneBoekingen.length === 0);

const rommel = classificeerOvergeslagen({ "abc": { partijen: 1, productie: 1 }, "16699": "veel" });
check("onzin wordt genegeerd zonder te gooien", codes(rommel.kwekers).length + codes(rommel.interneBoekingen).length <= 1);

const gesorteerd = classificeerOvergeslagen({
  "1": { partijen: 5, productie: 0 },
  "2": { partijen: 50, productie: 0 },
});
check("de drukste staat vooraan", gesorteerd.kwekers[0].relId === 2);

process.exit(failures ? 1 : 0);
```

- [ ] **Step 3: Draai het en zie het falen**

Run: `npx tsx scripts/checks/skipped.ts`
Expected: FAIL, `classificeerOvergeslagen` bestaat nog niet

- [x] **Step 4: Schrijf de classificatie**

Create `src/lib/sync/skipped.ts`. De regel: een relatie waarvan **alle** overgeslagen partijen productieboekingen zijn, is een interne boeking; al het andere is een kweker.

Dat de twijfel naar "kweker" valt is bewust. Iemand ten onrechte in de kwekerslijst zien staan kost een blik; een echte kweker die stilzwijgend onder "hoort hier niet" verdwijnt kost een seizoen aan data.

Wees ruimhartig in wat je accepteert: een getal betekent de oude vorm, een niet-numerieke sleutel of waarde wordt overgeslagen, `null` levert twee lege lijsten. Sorteer beide lijsten aflopend op `partijen`.

- [ ] **Step 5: Draai het en zie het slagen, en neem het op in `npm run check`**

Voeg `&& tsx scripts/checks/skipped.ts` toe aan het `check`-script in `package.json`.

Run: `npm run check`
Expected: de bestaande 124 controles plus de zeven nieuwe, alle op PASS

- [ ] **Step 6: Verifieer de nieuwe vorm tegen een echte ronde**

Draai een lots-ronde en kijk in `details.skippedSuppliers`. Expected: objecten in plaats van getallen, en bij `8623` (RC Productieorders) moet `productie` gelijk zijn aan `partijen`.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/import/lots/route.ts src/lib/sync/skipped.ts scripts/checks/skipped.ts package.json
git commit -m "feat: tell growers apart from internal production bookings"
```

---

### Task 7: Het overgeslagen-paneel met de aanmaakknop

**Files:**
- Create: `src/app/api/admin/import-batches/[id]/skipped/route.ts`
- Create: `src/app/(portal)/admin/imports/skipped-dialog.tsx`
- Modify: `src/app/(portal)/admin/imports/data-sync-tab.tsx`

**Interfaces:**
- Consumes: `classificeerOvergeslagen()` uit taak 6, `POST /api/admin/fabric-relations` (bestaat al)

- [x] **Step 1: Schrijf de route**

`GET /api/admin/import-batches/[id]/skipped`, met `requireAuth(["admin"])`. Haalt de batch op, classificeert `details.skippedSuppliers`, joint op `FabricRelation` voor code, naam en land, en geeft twee lijsten terug.

**`FabricRelation` heeft geen land.** De kolommen zijn `fabricId`, `code`, `name`, `accountManagerName`
en `accountManagerCode`, meer niet. Het land komt daarom uit de `Grower` met hetzelfde rel_id wanneer die
bestaat — dat vult drie van de vijftig regels; de rest toont een streepje.

Een `rel_id` die niet in `FabricRelation` staat hoort er nog steeds in, met naam `null` — dan zie je tenminste dát er iets is. Geef ook per relatie terug of er al een `Supplier` met dat `fabricId` bestaat, zodat het scherm de knop kan verbergen.

- [x] **Step 2: Schrijf het paneel**

Twee groepen onder elkaar: **Suppliers you may want to activate** en **Internal production bookings — these do not belong here**. Per regel de code, de naam, het land en het aantal weggegooide partijen. Bij de eerste groep een knop **Activate**, bij de tweede niet.

De knop roept `POST /api/admin/fabric-relations` aan met `fabricId` en `companyId`. Die vraagt om een company; haal de lijst op via `/api/companies` en laat kiezen als er meer dan één is.

Toon na afloop met `sonner` dat de leverancier is aangemaakt, en erbij dat zijn partijen bij de volgende ronde vanzelf binnenkomen — het venster is rollend, dus dat is de reparatie.

- [x] **Step 3: Hang het aan het aantal**

In `data-sync-tab.tsx` is de kolom **Skipped** al aanklikbaar wanneer er overgeslagen leveranciers zijn. Laat die nu dit paneel openen in plaats van de bestaande lijst.

**De kolom was niet meer aanklikbaar.** `skippedSuppliersOf` in `shared.tsx` filterde op
`typeof waarde === "number"` en gaf sinds taak 6 dus een lege lijst terug voor elke nieuwe batch — precies
de batches waar het om gaat. Vervangen door `skippedRelationCount`, dat `classificeerOvergeslagen`
gebruikt en daarmee beide vormen leest. De oude lijst in de detaildialoog is weg; die dialoog toont nu
alleen nog de fout.

- [x] **Step 4: Verifieer in de browser** — gedaan op 18 augustus.

De routelogica klopte tegen de testdatabase (45 kwekers, 5 interne boekingen, alle vijf
`*Productieorders`; een batch met de oude vorm zet alles bij de kwekers zonder te breken). In de
browser is `GCPDFAAL` (Piazza Dei Fiori) echt aangezet vanuit het paneel: hij had nul records, en na
één nachtronde 146 partijen, 8 afrekeningen en 324 orderregels, alle met de herkomst van die ronde.
Van de 149 overgeslagen partijen kwamen er 146 terug; het verschil is dedup en de rand van het
venster. **Aanzetten ís de reparatie** — dat is nu aangetoond en geen aanname meer.

Drie dingen kwamen pas in de browser boven water en zijn gerepareerd: een `sm:`-variant in de basis-
`DialogContent` die van `max-w-4xl` een smalle dialoog maakte (dezelfde fout stond al in de
foutdialoog ernaast, en staat nog in drie fust-dialogen), een 409 die als fout werd getoond terwijl
de gewenste eindtoestand juist bereikt is, en een `SelectValue` die het UUID van de company toonde
in plaats van zijn naam.

Open de skipped-dialoog van een `lots`-batch.
Expected: `FFSEPFC` en `GCPDFAAL` in de bovenste groep met een Activate-knop, en `RCPROD`, `RCFTPROD`, `SCPRO` in de onderste zonder. Bij een batch van vóór taak 6 staat alles in de bovenste groep — dat is de oude vorm en dat klopt.

**Activeer één leverancier echt**, bijvoorbeeld `GCPDFAAL`. Draai daarna een `intraday`-ronde en controleer dat zijn partijen nu wél binnenkomen: `recordsCreated` gaat omhoog en hij verdwijnt uit de overgeslagen-lijst. Dat is het bewijs dat de reparatie werkt.

- [x] **Step 5: Commit**

```bash
git add src/app/api/admin/import-batches "src/app/(portal)/admin/imports"
git commit -m "feat: show which suppliers a run dropped, and let them be activated"
```

---

### Task 8: Doorklikken naar de records

**Files:**
- Create: `src/app/api/admin/import-batches/[id]/records/route.ts`
- Create: `src/app/(portal)/admin/imports/batch-records-dialog.tsx`
- Modify: `src/app/(portal)/admin/imports/data-sync-tab.tsx`

- [x] **Step 1: Schrijf de route**

`GET /api/admin/import-batches/[id]/records`, met `requireAuth(["admin"])`, parameters `page` en `mode` (`created` of `updated`).

Kijk naar `batch.endpoint` om te weten welk model je moet bevragen: `lots` → `Lot`, `orders` → `Transaction`, `growers` → `Grower`, `costs` → `SalesSheetCost`. Voor `suppliers` is er niets — geef dan een lege lijst met een reden terug.

Filter op `lastImportBatchId = id`, en scheid aangemaakt van bijgewerkt door `createdAt` te vergelijken met `batch.startedAt`: op of erna betekent aangemaakt.

Geef per record genoeg om het te herkennen. Voor een partij: partijnummer, leverancierscode en -naam, artikel en leverdatum. Vijftig per pagina, met het totaal erbij.

- [x] **Step 2: Schrijf het paneel**

Een dialoog met twee tabs, **Created** en **Updated**, met het aantal erachter. Een tabel met de kolommen die bij dat endpoint horen, en paginering onderaan. Per regel een link naar de bestaande detailpagina waar die er is.

- [x] **Step 3: Maak de aantallen aanklikbaar**

In `data-sync-tab.tsx` worden de kolommen **Created** en **Updated** aanklikbaar zodra ze boven nul staan én de batch een job heeft — bij een handmatige import of een oude DAX-run is er geen herkomst vastgelegd en valt er niets te tonen.

**Ook `suppliers` is niet aanklikbaar**, om dezelfde reden: dat model draagt geen herkomst, dus de 673
bijgewerkte leveranciers zouden op een leeg paneel uitkomen. De reden staat wel in het antwoord van de
route, voor het geval iemand er alsnog op belandt.

- [x] **Step 4: Verifieer in de browser** — gedaan op 18 augustus, in het scherm zelf.

De 146 aangemaakte partijen van de laatste ronde bleken allemaal van Piazza Dei Fiori, de leverancier
die een half uur eerder via het skipped-paneel was aangezet — het bewijs van taak 7 en taak 8 in één
lijst. Paginering klopt (1-50 van 146, drie pagina's, geen overlap tussen pagina een en twee), het
tabblad Updated toont de 417 andere, en een partijnummer landt op de partij met zijn orderregels. Ook
de twee lastige gevallen zijn gezien: een volledig ingehaalde ronde (`costs` 22:20, 225 gemeld, 0
gevonden) en een half ingehaalde (`growers` 22:20, 3 gemeld, 1 gevonden) leggen allebei uit waar het
verschil zit.

Twee dingen kwamen pas bij het klikken boven water: de aantallen waren wel knoppen maar zagen er niet
uit als knoppen (alleen `hover:underline`, dus onzichtbaar tot je er toevallig overheen ging), en de
uitleg over de correcties bleef staan op het tabblad Updated waar hij over iets anders gaat. Allebei
gerepareerd.

Per endpoint van de laatste ronde, vergeleken met wat de batch rapporteert:

| endpoint | batch cre/upd | records cre/upd | klopt |
|---|---|---|---|
| growers | 0 / 2 | 0 / 2 | ja |
| lots | 217 / 417 | 146 / 417 | ja — het verschil is `corrections.created` 71 |
| orders | 1.208 / 0 | 1.208 / 0 | ja |
| costs | 0 / 1.058 | 0 / 1.058 | ja |

Het lots-verschil staat als regel in de dialoog, net zoals het skipped-paneel zijn eigen verschil
uitlegt. Een batch van vóór taak 1 levert nul records op en heeft geen job, dus is niet aanklikbaar —
van de 3.808 batches in de historie hebben er tien een job.

**Een ronde die is overschreven levert nul op.** `lastImportBatchId` is één plek: de ronde van 18:20
raakte 884 orderregels aan, maar de ronde van 18:48 raakte ze opnieuw aan en nam de herkomst over.
Klikken op de oudere ronde toont dan een lege lijst met de melding dat een latere ronde eroverheen is
gegaan. Dat volgt uit het ontwerp en is geen fout, maar het is wel het eerste dat vreemd oogt.

Klik het aantal bijgewerkte partijen van de laatste `lots`-ronde aan.
Expected: een lijst partijnummers met hun leverancier, het totaal klopt met het getal in de tabel, en paginering werkt. Controleer bij een paar regels dat die partij ook werkelijk die ronde als `lastImportBatchId` draagt.

Klik daarna hetzelfde aan bij een oude batch van vóór taak 1. Expected: de aantallen zijn daar niet aanklikbaar.

- [x] **Step 5: Commit**

```bash
git add src/app/api/admin/import-batches "src/app/(portal)/admin/imports"
git commit -m "feat: click through from a run to the records it touched"
```

**Wat de review opleverde (18 augustus).** Drie dingen gerepareerd:

1. *De paginering kon rijen laten vallen.* Alle vier de sorteringen eindigden op een niet-unieke
   sleutel; bij `costs` delen 470 van de 1.058 rijen er een (grootste groep 16), bij `orders` 65.
   Met `OFFSET` mag Postgres zo'n rij op twee pagina's of op geen enkele zetten — gemeten op de
   testdatabase leverde een volledige sweep zonder tiebreaker 1.058 rijen op met 1.057 unieke, dus
   één dubbel en één kwijt. `{ id: "asc" }` sluit nu elke `orderBy` af, ook bij `lots`.
2. *De uitleg bij een ingehaalde ronde was niet eerlijk.* De route stuurt nu `reported` mee en
   benoemt het verschil als feit zodra het gevonden aantal lager is dan het gemelde — ook bij een
   half gevulde lijst, en juist níét als de ronde zelf nul meldt.
3. *`divergenceNote` kon met stelligheid het verkeerde zeggen.* De correctie-uitleg verschijnt
   alleen nog als de correcties in het gat passen; de rest van het gat gaat naar de
   overschrijf-uitleg, en beide staan er samen als ze samen het verschil verklaren.

---

## Wat er na dit plan staat

- Elk record dat de sync aanraakt draagt de ronde die hem het laatst aanraakte
- Vanuit het importscherm klik je door naar wat er is aangemaakt en bijgewerkt
- Een overgeslagen aantal wijst naar de leveranciers die ontbreken, gescheiden van interne boekingen, met de knop om ze aan te maken — en het rollende venster haalt hun partijen daarna vanzelf op

**Wat er ook niet in zit: `LotCorrection`.** Een nachtronde maakt er zo'n 68 aan en die dragen geen
herkomst; ze staan niet bij de vier modellen uit taak 1. Wie doorklikt op de aangemaakte partijen van
een ronde ziet de correcties dus niet. Zelfde patroon, vijfde model — los toe te voegen.

**Wat er niet in zit:** de overgeslagen orderregels. Die ronde gooit er per nacht 6.269 weg waarvan er maar 99 verklaard zijn; de rest heeft geen partij in de portal en wordt nergens geteld. Hetzelfde patroon als bij lots, maar een eigen wijziging — los te trekken zodra dit staat.
