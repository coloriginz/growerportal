# Sales sheet-PDF-totalen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** De bedragen die op de sales sheet-PDF staan uitlezen en opslaan naast de bedragen die de portal berekent, zodat een afgeleid oordeel zichtbaar maakt waar die twee uiteenlopen.

**Architecture:** Vier nullable kolommen op `SalesSheet` dragen wat er in de PDF stond. De bestaande PDF-parser leest ze mee — hij opent het document toch al voor de leverdatum. De koppelroute schrijft ze weg, elk pad dat een koppeling verbreekt wist ze. Een pure functie leidt het oordeel af uit het opgeslagen paar, zodat het nooit veroudert wanneer de import de berekende totalen herrekent. Het oordeel verschijnt als derde type in de bestaande Data Quality-lijst.

**Tech Stack:** Next.js 15 App Router, Prisma 6 op Neon PostgreSQL, pdfjs-dist v4 (legacy build), TypeScript strict. Geen testframework: controles zijn losse scripts in `scripts/checks/` die op pure functies draaien en via `npm run check` lopen.

**Spec:** `docs/superpowers/specs/2026-08-30-salessheet-pdf-totalen-design.md`

## Global Constraints

- Commentaar in het Nederlands en het legt uit **waarom**, niet wat. Code, variabelen en UI-teksten in het Engels. Volg de toon van `src/lib/shipment-status.ts` en `src/lib/sync/withdrawal.ts`.
- Geen `any`. Het project draagt al 30+ `eslint-disable no-explicit-any`; daar komt er geen bij.
- Schemawijzigingen via `npx prisma db push`, nooit `prisma migrate dev`. Op Windows eerst de dev-server stoppen, of `--skip-generate` gebruiken.
- Elke nieuwe pure functie krijgt een check in `scripts/checks/` en wordt toegevoegd aan het `check`-script in `package.json`.
- Bedragen uit Fabric en uit PDF's staan in Nederlandse notatie: `1.763,10`. Negatieve bedragen staan tussen haakjes: `(EUR 193,78)`.
- `SalesSheet.netResult` is `Decimal`; vergelijken gaat altijd via `Number(...)`, nooit op de Decimal zelf.
- Na elke taak: `npx tsc --noEmit -p tsconfig.json`, `npx eslint <gewijzigde bestanden>` en `npm run check` moeten schoon zijn.
- Alleen de **test**-database aanraken. Productie krijgt schema en inhaalslag pas na expliciet akkoord van de eigenaar.

---

### Task 1: Vier kolommen op SalesSheet

**Files:**
- Modify: `prisma/schema.prisma` (model `SalesSheet`, rond regel 196)

**Interfaces:**
- Consumes: niets
- Produces: `SalesSheet.pdfTurnover`, `.pdfCosts`, `.pdfNetResult` (`Decimal?`), `.pdfParsedAt` (`DateTime?`)

- [ ] **Step 1: Voeg de kolommen toe**

In `prisma/schema.prisma`, direct onder `ourInvoiceNumber` in model `SalesSheet`:

```prisma
  /// Wat er op de sales sheet-PDF zelf stond, tegenover de berekende totalen
  /// hierboven. Twee onafhankelijke bronnen: de velden hierboven komen uit
  /// Fabric via orderregels en kostenregels, deze uit het document dat de
  /// kweker heeft gekregen. Lopen ze uiteen, dan is er iets mis — welke van de
  /// twee fout is, zegt dit niet.
  pdfTurnover     Decimal?  @db.Decimal(12, 2)
  pdfCosts        Decimal?  @db.Decimal(12, 2)
  pdfNetResult    Decimal?  @db.Decimal(12, 2)
  /// Wanneer de PDF is uitgelezen. Draagt geen bedrag en is toch onmisbaar:
  /// zonder dit veld zijn "nog nooit gelezen" en "gelezen, maar er stond niets"
  /// allebei null, en dan is een parserprobleem niet te onderscheiden van een
  /// leeg document.
  pdfParsedAt     DateTime?
```

- [ ] **Step 2: Controleer de drift vóór het pushen**

Run: `npx prisma migrate diff --from-url "<DIRECT_URL uit .env>" --to-schema-datamodel prisma/schema.prisma --script`
Expected: een `ALTER TABLE "SalesSheet" ADD COLUMN` met precies deze vier kolommen, en niets anders.

- [ ] **Step 3: Push naar test**

Run: `npx prisma db push --skip-generate`
Expected: "Your database is now in sync with your Prisma schema."

`--skip-generate` vermijdt de Windows-EPERM op de query engine-DLL als de dev-server draait.

- [ ] **Step 4: Genereer de client**

Run: `npx prisma generate`
Expected: slaagt. Draait de dev-server nog, stop hem eerst.

- [ ] **Step 5: Verifieer dat de drift weg is**

Run: `npx prisma migrate diff --from-url "<DIRECT_URL uit .env>" --to-schema-datamodel prisma/schema.prisma --script`
Expected: "This is an empty migration."

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma
git commit -m "Carry what the sales sheet itself says next to what we computed"
```

---

### Task 2: De parser leest de drie bedragen

**Files:**
- Modify: `src/lib/salessheet-pdf-parser.ts`
- Create: `scripts/checks/salessheet-pdf-amounts.ts`
- Modify: `package.json` (script `check`)

**Interfaces:**
- Consumes: niets uit eerdere taken
- Produces:
  - `export function parseSalesSheetAmounts(text: string): { turnover: number | null; costs: number | null; netResult: number | null }`
  - `ParsedSalesSheetPdf` krijgt de velden `turnover`, `costs`, `netResult` (alle `number | null`)

- [ ] **Step 1: Schrijf de falende check met echte tekstfragmenten**

Maak `scripts/checks/salessheet-pdf-amounts.ts`. De fragmenten hieronder zijn letterlijk uit echte PDF's geknipt (29-08-2026) en zijn de reden dat deze check bestaat: als een lay-out verandert, breekt hier iets in plaats van stil verkeerde bedragen op te leveren.

```ts
import { parseSalesSheetAmounts } from "../../src/lib/salessheet-pdf-parser";

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) console.log(`PASS ${label}`);
  else {
    failures++;
    console.log(`FAIL ${label}${detail ? " — " + detail : ""}`);
  }
}

/*
 * Echte tekst, zoals pdfjs hem uitrolt. Let op de volgorde: bij de totalen staat
 * het bedrag vóór het label, bij de kosten erna. Dat is geen toeval maar hoe de
 * tabelcellen uit het document komen, en een parser die het andersom aanneemt
 * leest stelselmatig het verkeerde getal.
 */
const ENGELS =
  "Cost Calculation of net result supplier Direct sales € 1.763,10 Turnover Auction " +
  "€ 607,20 € 2.370,30 Total nett turnover Clearing & Logistics 55,00 Container rental " +
  "38,91 Distribution Costs 51,15 Total costs € 873,57 € 1.496,73 To be received by " +
  "supplier 02-01-2025 15-1-25 22:03 AWB number";

const NEDERLANDS =
  "Berekening netto resultaat leverancier Directe verkopen € 600,00 € 600,00 Totale " +
  "netto omzet € 600,00 Te ontvangen door leverancier 54,00 € 654,00 BTW: NETTO " +
  "RESULTAAT INCL. BTW 16-10-2025 17-11-25 22:04 AWB nummer";

/* All-in: alleen het netto wordt afgedrukt, er zijn geen kostenregels. */
const ALL_IN =
  "Calculation of net result supplier Direct sales € 583,46 € 583,46 Total nett " +
  "turnover € 583,46 To be received by supplier 29-11-2025 18-12-25 22:02 AWB number";

/* Negatieve bedragen staan tussen haakjes. */
const NEGATIEF =
  "Direct sales € 592,99 € 592,99 Total nett turnover Distribution Costs 11,79 " +
  "(€ 193,78) Total costs € 193,78 € 399,21 Subtotal:";

const en = parseSalesSheetAmounts(ENGELS);
check("engels: omzet", en.turnover === 2370.3, `kreeg ${en.turnover}`);
check("engels: kosten", en.costs === 873.57, `kreeg ${en.costs}`);
check("engels: netto", en.netResult === 1496.73, `kreeg ${en.netResult}`);

const nl = parseSalesSheetAmounts(NEDERLANDS);
check("nederlands: omzet", nl.turnover === 600, `kreeg ${nl.turnover}`);
check("nederlands: netto", nl.netResult === 600, `kreeg ${nl.netResult}`);
check(
  "nederlands: de btw-regel wordt genegeerd",
  nl.netResult !== 654,
  "654,00 is het bedrag inclusief btw; alleen het bedrag ervóór is vergelijkbaar " +
    "met wat de portal berekent, want die kent geen btw"
);

const incl = parseSalesSheetAmounts(ALL_IN);
check("all-in: omzet is het afgedrukte netto", incl.turnover === 583.46, `kreeg ${incl.turnover}`);
check("all-in: geen kostenregel betekent geen kosten", incl.costs === null, `kreeg ${incl.costs}`);
check("all-in: netto", incl.netResult === 583.46, `kreeg ${incl.netResult}`);

const neg = parseSalesSheetAmounts(NEGATIEF);
check("kosten tussen haakjes worden gelezen", neg.costs === 193.78, `kreeg ${neg.costs}`);

check(
  "lege tekst levert drie keer null",
  (() => {
    const leeg = parseSalesSheetAmounts("");
    return leeg.turnover === null && leeg.costs === null && leeg.netResult === null;
  })()
);

console.log(failures === 0 ? "\nalle checks geslaagd" : `\n${failures} check(s) gefaald`);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 2: Draai de check en zie hem falen**

Run: `npx tsx scripts/checks/salessheet-pdf-amounts.ts`
Expected: faalt op een import-fout, want `parseSalesSheetAmounts` bestaat nog niet.

- [ ] **Step 3: Implementeer de extractie**

Voeg toe aan `src/lib/salessheet-pdf-parser.ts`, boven `parseSalesSheetPdf`:

```ts
/*
 * De bedragen op de sales sheet, in beide talen.
 *
 * pdfjs rolt de tabelcellen uit in een volgorde waarin het bedrag bij de totalen
 * vóór zijn label staat ("€ 2.370,30 Total nett turnover") en bij de kosten erna
 * ("Total costs € 873,57"). Wie dat omdraait leest stelselmatig het verkeerde
 * getal, en het valt niet op omdat er altijd wél een bedrag uitkomt.
 *
 * De btw-regel op Nederlandse sales sheets ("54,00 € 654,00 BTW: NETTO RESULTAAT
 * INCL. BTW") staat er met opzet niet bij: binnenlandse leveranciers krijgen btw
 * bovenop het netto, en de portal kent geen btw. Alleen het bedrag vóór de btw is
 * vergelijkbaar.
 */
const BEDRAG = String.raw`\(?€?\s*-?[\d.]+,\d{2}\)?`;

const OMZET_LABELS = ["Total nett turnover", "Totale netto omzet"];
const KOSTEN_LABELS = ["Total costs", "Totale kosten"];
const NETTO_LABELS = [
  "To be received by supplier",
  "To be paid by supplier",
  "Te ontvangen door leverancier",
  "Te betalen door leverancier",
  "Nett payable / receivable to/from OZ import",
];

/** "1.763,10" en "(€ 193,78)" naar een getal. Haakjes betekenen negatief. */
function leesBedrag(ruw: string): number | null {
  const negatief = ruw.includes("(");
  const schoon = ruw.replace(/[()€\s]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(schoon);
  if (!Number.isFinite(n)) return null;
  return negatief ? -Math.abs(n) : n;
}

/** Het eerste bedrag dat vlak vóór een van de labels staat. */
function bedragVoorLabel(tekst: string, labels: readonly string[]): number | null {
  for (const label of labels) {
    const m = tekst.match(new RegExp(`(${BEDRAG})\\s*${escapeRegex(label)}`, "i"));
    if (m) {
      const n = leesBedrag(m[1]);
      if (n !== null) return n;
    }
  }
  return null;
}

/** Het eerste bedrag dat vlak ná een van de labels staat. */
function bedragNaLabel(tekst: string, labels: readonly string[]): number | null {
  for (const label of labels) {
    const m = tekst.match(new RegExp(`${escapeRegex(label)}\\s*(${BEDRAG})`, "i"));
    if (m) {
      const n = leesBedrag(m[1]);
      if (n !== null) return n;
    }
  }
  return null;
}

function escapeRegex(waarde: string): string {
  return waarde.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseSalesSheetAmounts(text: string): {
  turnover: number | null;
  costs: number | null;
  netResult: number | null;
} {
  return {
    turnover: bedragVoorLabel(text, OMZET_LABELS),
    // Een levering zonder kosten heeft de regel niet; dat is nul en geen misser,
    // maar het onderscheid tussen "nul" en "niet gevonden" hoort hier bewaard te
    // blijven. De vergelijking verderop beslist wat een ontbrekende waarde betekent.
    costs: bedragNaLabel(text, KOSTEN_LABELS) ?? bedragVoorLabel(text, KOSTEN_LABELS),
    netResult: bedragVoorLabel(text, NETTO_LABELS),
  };
}
```

- [ ] **Step 4: Draai de check en zie hem slagen**

Run: `npx tsx scripts/checks/salessheet-pdf-amounts.ts`
Expected: alle checks geslaagd.

- [ ] **Step 5: Laat `parseSalesSheetPdf` de bedragen meegeven**

Zoek in `src/lib/salessheet-pdf-parser.ts` het type `ParsedSalesSheetPdf` en voeg toe:

```ts
  /** Wat er op de PDF zelf stond. Null betekent: dit label kwam niet voor. */
  turnover: number | null;
  costs: number | null;
  netResult: number | null;
```

Roep in `parseSalesSheetPdf`, waar de volledige tekst al is opgebouwd, `parseSalesSheetAmounts(tekst)` aan en neem de drie velden op in het retourobject. Gebruik dezelfde tekstvariabele die de leverdatumherkenning gebruikt — het document wordt niet nog een keer geopend.

- [ ] **Step 6: Voeg de check toe aan npm run check**

In `package.json`, achter `tsx scripts/checks/reattribution.ts`:

```
 && tsx scripts/checks/salessheet-pdf-amounts.ts
```

- [ ] **Step 7: Verifieer**

Run: `npx tsc --noEmit -p tsconfig.json && npx eslint src/lib/salessheet-pdf-parser.ts scripts/checks/salessheet-pdf-amounts.ts && npm run check`
Expected: alles schoon, alle checks geslaagd.

- [ ] **Step 8: Commit**

```bash
git add src/lib/salessheet-pdf-parser.ts scripts/checks/salessheet-pdf-amounts.ts package.json
git commit -m "Read the three totals off the sales sheet in both languages"
```

---

### Task 3: Het oordeel als pure functie

**Files:**
- Create: `src/lib/salessheet-match.ts`
- Create: `scripts/checks/salessheet-match.ts`
- Modify: `package.json` (script `check`)

**Interfaces:**
- Consumes: niets uit eerdere taken (werkt op losse getallen)
- Produces:
  - `export const SALESSHEET_MATCH_TOLERANCE = 1`
  - `export type SalesSheetMatch = "match" | "mismatch" | "unread" | "unlinked"`
  - `export function resolveSalesSheetMatch(input: { hasPdf: boolean; pdfParsedAt: Date | null; pdfNetResult: number | null; computedNetResult: number }): SalesSheetMatch`
  - `export const SALESSHEET_MATCHES: readonly SalesSheetMatch[]`

- [ ] **Step 1: Schrijf de falende check**

Maak `scripts/checks/salessheet-match.ts`:

```ts
import {
  SALESSHEET_MATCHES,
  SALESSHEET_MATCH_TOLERANCE,
  resolveSalesSheetMatch,
} from "../../src/lib/salessheet-match";

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) console.log(`PASS ${label}`);
  else {
    failures++;
    console.log(`FAIL ${label}${detail ? " — " + detail : ""}`);
  }
}

const GELEZEN = new Date("2026-08-30T00:00:00Z");

check(
  "zonder PDF valt er niets te zeggen",
  resolveSalesSheetMatch({
    hasPdf: false,
    pdfParsedAt: null,
    pdfNetResult: null,
    computedNetResult: 1234.56,
  }) === "unlinked"
);

check(
  "een PDF die nog niet is gelezen is niet hetzelfde als een die niets opleverde",
  resolveSalesSheetMatch({
    hasPdf: true,
    pdfParsedAt: null,
    pdfNetResult: null,
    computedNetResult: 1234.56,
  }) === "unlinked",
  "nog niet gelezen zegt niets over de levering, alleen over onze achterstand"
);

check(
  "gelezen zonder bedrag is onze storing",
  resolveSalesSheetMatch({
    hasPdf: true,
    pdfParsedAt: GELEZEN,
    pdfNetResult: null,
    computedNetResult: 1234.56,
  }) === "unread",
  "het document is bekeken en gaf geen netto; dat is een parserprobleem en hoort " +
    "zichtbaar te zijn in plaats van weg te vallen tussen de leveringen zonder PDF"
);

check(
  "gelijke bedragen zijn een match",
  resolveSalesSheetMatch({
    hasPdf: true,
    pdfParsedAt: GELEZEN,
    pdfNetResult: 1234.56,
    computedNetResult: 1234.56,
  }) === "match"
);

check(
  "een cent verschil is afronding, geen fout",
  resolveSalesSheetMatch({
    hasPdf: true,
    pdfParsedAt: GELEZEN,
    pdfNetResult: 583.46,
    computedNetResult: 583.47,
  }) === "match",
  "SalesSheetCost.amount draagt vijf decimalen en de sales sheet telt op vóór hij " +
    "afrondt; 13,4% van de leveringen wijkt daardoor onder een euro af"
);

check(
  "precies op de drempel telt nog als match",
  resolveSalesSheetMatch({
    hasPdf: true,
    pdfParsedAt: GELEZEN,
    pdfNetResult: 100,
    computedNetResult: 100 - SALESSHEET_MATCH_TOLERANCE,
  }) === "match"
);

check(
  "net over de drempel is een mismatch",
  resolveSalesSheetMatch({
    hasPdf: true,
    pdfParsedAt: GELEZEN,
    pdfNetResult: 100,
    computedNetResult: 100 - SALESSHEET_MATCH_TOLERANCE - 0.01,
  }) === "mismatch"
);

check(
  "het gespiegelde geval is een mismatch",
  resolveSalesSheetMatch({
    hasPdf: true,
    pdfParsedAt: GELEZEN,
    pdfNetResult: 1350.16,
    computedNetResult: -1350.17,
  }) === "mismatch",
  "gemeten geval: de portal had wel kosten maar geen omzet, dus een negatief netto, " +
    "terwijl de kweker het bedrag positief uitbetaald heeft gekregen"
);

check(
  "een negatief resultaat aan beide kanten is gewoon een match",
  resolveSalesSheetMatch({
    hasPdf: true,
    pdfParsedAt: GELEZEN,
    pdfNetResult: -240.5,
    computedNetResult: -240.5,
  }) === "match"
);

check(
  "elke uitkomst staat in SALESSHEET_MATCHES",
  (
    [
      { hasPdf: false, pdfParsedAt: null, pdfNetResult: null, computedNetResult: 0 },
      { hasPdf: true, pdfParsedAt: GELEZEN, pdfNetResult: null, computedNetResult: 0 },
      { hasPdf: true, pdfParsedAt: GELEZEN, pdfNetResult: 5, computedNetResult: 5 },
      { hasPdf: true, pdfParsedAt: GELEZEN, pdfNetResult: 5, computedNetResult: 500 },
    ] as const
  ).every((invoer) => SALESSHEET_MATCHES.includes(resolveSalesSheetMatch(invoer)))
);

console.log(failures === 0 ? "\nalle checks geslaagd" : `\n${failures} check(s) gefaald`);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 2: Draai de check en zie hem falen**

Run: `npx tsx scripts/checks/salessheet-match.ts`
Expected: faalt op de import — `src/lib/salessheet-match.ts` bestaat niet.

- [ ] **Step 3: Implementeer de functie**

Maak `src/lib/salessheet-match.ts`:

```ts
/*
 * Klopt wat de kweker op zijn afrekening zag met wat de portal berekent?
 *
 * De portal leidt zijn totalen af uit orderregels en kostenregels; de sales sheet
 * komt uit het factuursysteem. Twee onafhankelijke bronnen die hetzelfde horen te
 * zeggen. Lopen ze uiteen, dan is er iets mis — en welke van de twee fout is, zegt
 * deze functie niet. Dat is geen tekortkoming: de signalering hoeft alleen te
 * wijzen, iemand kijkt daarna.
 *
 * Er wordt uitsluitend op het nettoresultaat vergeleken, en dat is een keuze met
 * een reden. Bij een all-in-levering (`isInclusief`, 241 van 7.878 op 29-08-2026)
 * drukt de sales sheet alleen het netto af en heeft hij geen kostenregels, terwijl
 * de portal bruto omzet én kosten apart uit Fabric heeft. Omzet met omzet
 * vergelijken levert daar duizenden euro's schijnverschil op. Het netto betekent
 * aan beide kanten hetzelfde, ongeacht de afspraak — dus die vergelijking heeft de
 * all-in-vlag niet nodig.
 */

/**
 * Waarboven een verschil een bevinding is, in euro's.
 *
 * Gemeten over 800 afrekeningen: 81% komt exact uit, 13,4% wijkt onder een euro af
 * en 5,5% erboven. Die 13,4% is afronding — `SalesSheetCost.amount` draagt vijf
 * decimalen en de sales sheet telt op vóór hij afrondt. Op nul verdrinkt het signaal
 * in centen; op tien mis je echte kleine fouten.
 */
export const SALESSHEET_MATCH_TOLERANCE = 1;

export type SalesSheetMatch = "match" | "mismatch" | "unread" | "unlinked";

export const SALESSHEET_MATCHES: readonly SalesSheetMatch[] = [
  "match",
  "mismatch",
  "unread",
  "unlinked",
];

export type SalesSheetMatchInput = {
  /** Hangt er een document aan deze afrekening? */
  hasPdf: boolean;
  /** Wanneer dat document is uitgelezen, of null als dat nog niet is gebeurd. */
  pdfParsedAt: Date | null;
  /** Het nettoresultaat zoals het op de PDF stond. */
  pdfNetResult: number | null;
  /** Het nettoresultaat zoals de portal het berekent. */
  computedNetResult: number;
};

export function resolveSalesSheetMatch(input: SalesSheetMatchInput): SalesSheetMatch {
  // Geen document, of een document dat nog niet is bekeken: allebei zeggen ze niets
  // over de levering. Dat de inhaalslag er nog niet langs is, is een achterstand van
  // ons en geen bevinding over deze afrekening.
  if (!input.hasPdf || input.pdfParsedAt === null) return "unlinked";

  // Wel bekeken, geen bedrag gevonden. Dat is onze storing — een lay-out die we niet
  // kennen of een document dat niet te lezen was — en het hoort apart zichtbaar te
  // zijn in plaats van weg te vallen tussen de afrekeningen zonder PDF.
  if (input.pdfNetResult === null) return "unread";

  const verschil = Math.abs(input.pdfNetResult - input.computedNetResult);
  return verschil > SALESSHEET_MATCH_TOLERANCE ? "mismatch" : "match";
}
```

- [ ] **Step 4: Draai de check en zie hem slagen**

Run: `npx tsx scripts/checks/salessheet-match.ts`
Expected: alle checks geslaagd.

- [ ] **Step 5: Voeg de check toe aan npm run check**

In `package.json`, achter `tsx scripts/checks/salessheet-pdf-amounts.ts`:

```
 && tsx scripts/checks/salessheet-match.ts
```

- [ ] **Step 6: Verifieer**

Run: `npx tsc --noEmit -p tsconfig.json && npx eslint src/lib/salessheet-match.ts scripts/checks/salessheet-match.ts && npm run check`
Expected: schoon.

- [ ] **Step 7: Commit**

```bash
git add src/lib/salessheet-match.ts scripts/checks/salessheet-match.ts package.json
git commit -m "Judge the sales sheet against the computation, on net result alone"
```

---

### Task 4: Schrijven bij koppelen, wissen bij loskoppelen

**Files:**
- Modify: `src/app/api/shipments/import-email/route.ts` (het `prisma.salesSheet.update`-blok, rond regel 381)
- Modify: `scripts/audit-salessheet-links.ts` (het `updateMany`-blok in de `APPLY`-tak)
- Modify: `src/app/api/import/lots/route.ts` (functie `verwijderLeveringen`)

**Interfaces:**
- Consumes: `parseSalesSheetPdf` uit Task 2 levert nu `turnover`, `costs`, `netResult`
- Produces: gevulde `pdfTurnover`/`pdfCosts`/`pdfNetResult`/`pdfParsedAt` op elke nieuw gekoppelde afrekening

- [ ] **Step 1: Schrijf de velden bij het koppelen**

In `src/app/api/shipments/import-email/route.ts` draagt de parse-uitkomst de drie bedragen. Vervang het update-blok:

```ts
  await prisma.salesSheet.update({
    where: { id: salesSheet.id },
    data: {
      pdfDocumentId: document.id,
      ourInvoiceNumber: ourInvoiceNumber || undefined,
      /*
       * Wat er op dit document stond. `pdfParsedAt` wordt altijd gezet, ook als er
       * geen bedrag uit kwam: dan is zichtbaar dat we gekeken hebben en niets vonden,
       * en dat is een parserprobleem in plaats van een eigenschap van de levering.
       */
      pdfTurnover: parsed.turnover,
      pdfCosts: parsed.costs,
      pdfNetResult: parsed.netResult,
      pdfParsedAt: new Date(),
    },
  });
```

Let op de naam van de variabele die het parse-resultaat draagt in die functie; gebruik die, niet letterlijk `parsed`, als hij anders heet.

- [ ] **Step 2: Wis de velden bij het loskoppelen in de audit**

In `scripts/audit-salessheet-links.ts`, in het blok dat `pdfDocumentId` op null zet:

```ts
      data: {
        pdfDocumentId: null,
        ourInvoiceNumber: null,
        // Ook de gelezen bedragen. Blijven die van een verkeerde PDF staan, dan
        // levert dat een blijvende mismatch op die naar zichzelf wijst: de
        // vergelijking zou een document beoordelen dat er niet meer hangt.
        pdfTurnover: null,
        pdfCosts: null,
        pdfNetResult: null,
        pdfParsedAt: null,
      },
```

- [ ] **Step 3: Verifieer dat de lots-route niets hoeft**

Lees `verwijderLeveringen()` in `src/app/api/import/lots/route.ts`. Die verwijdert de hele `SalesSheet`-rij, dus de vier kolommen verdwijnen mee. Er is hier niets te doen; noteer dat en ga door. Voeg géén code toe.

- [ ] **Step 4: Verifieer**

Run: `npx tsc --noEmit -p tsconfig.json && npx eslint src/app/api/shipments/import-email/route.ts scripts/audit-salessheet-links.ts && npm run check`
Expected: schoon.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/shipments/import-email/route.ts scripts/audit-salessheet-links.ts
git commit -m "Store the sales sheet totals on link, clear them on unlink"
```

---

### Task 5: De inhaalslag

**Files:**
- Create: `scripts/backfill-pdf-totals.ts`

**Interfaces:**
- Consumes: `parseSalesSheetPdf` uit Task 2, de kolommen uit Task 1
- Produces: gevulde kolommen op bestaande koppelingen

- [ ] **Step 1: Schrijf het script**

Maak `scripts/backfill-pdf-totals.ts`. Neem de vorm van `scripts/audit-salessheet-links.ts` over: kopcommentaar met de reden, `--apply` als vlag zodat dry run de standaard is, `--blob` om bestanden op te halen die niet lokaal staan, `--limit=N`, en een samenvatting aan het eind.

Kern van de werklijst:

```ts
  const teDoen = await prisma.salesSheet.findMany({
    where: { pdfDocumentId: { not: null }, pdfParsedAt: null },
    select: {
      id: true,
      invoiceNumber: true,
      netResult: true,
      supplier: { select: { code: true } },
      pdfDocument: { select: { fileName: true, fileUrl: true } },
    },
    orderBy: { id: "asc" },
  });
```

`orderBy: { id: "asc" }` is geen smaak: pagineren of afkappen op een niet-unieke sortering laat Postgres een rij op twee pagina's of op geen enkele teruggeven.

Per afrekening: bestand uit het archief (`private_input/salessheets`, op kleine-letter bestandsnaam) of met `--blob` uit `fileUrl`; `parseSalesSheetPdf` erop; bij `--apply` de vier velden wegschrijven met `pdfParsedAt: new Date()` ook als er geen bedrag uit kwam.

Tel mee en toon aan het eind: hoeveel gelezen, hoeveel met een netto, hoeveel zonder, en — met de functie uit Task 3 — hoeveel `match` en hoeveel `mismatch`, plus de tien grootste verschillen met leverancier, nummer, beide bedragen en het verschil. Dat laatste is de opbrengst van de hele exercitie; zonder die lijst weet je na afloop niet of het gewerkt heeft.

- [ ] **Step 2: Draai droog op een klein aantal**

Run: `npx tsx scripts/backfill-pdf-totals.ts --limit=25`
Expected: leest 25 documenten, wijzigt niets, toont de samenvatting.

- [ ] **Step 3: Verifieer**

Run: `npx tsc --noEmit -p tsconfig.json && npx eslint scripts/backfill-pdf-totals.ts`
Expected: schoon.

- [ ] **Step 4: Commit**

```bash
git add scripts/backfill-pdf-totals.ts
git commit -m "Catch up the sales sheets that were linked before we read totals"
```

---

### Task 6: Draai de inhaalslag op test en meet

**Files:**
- geen wijzigingen; dit is een uitvoering met een uitkomst

**Interfaces:**
- Consumes: alles uit Task 1 t/m 5
- Produces: gevulde kolommen op test, en de cijfers die Task 7 nodig heeft

- [ ] **Step 1: Droog draaien over alles**

Run: `npx tsx scripts/backfill-pdf-totals.ts --blob`
Expected: ~3.600 documenten gelezen. Noteer hoeveel er een netto opleverden.

- [ ] **Step 2: Toepassen**

Run: `npx tsx scripts/backfill-pdf-totals.ts --blob --apply`
Expected: dezelfde aantallen, nu weggeschreven.

- [ ] **Step 3: Controleer de uitkomst tegen de verwachting**

De proef van 29-08-2026 voorspelde over 800 documenten: 81% exact gelijk, 13,4% onder een euro, 5,5% erboven. Wijkt de uitkomst over het volledige archief daar sterk van af, stop dan en zoek uit waarom vóór je verdergaat — dat is dan een aanwijzing dat de extractie op een lay-out struikelt die niet in de steekproef zat.

- [ ] **Step 4: Geen commit**

Er is niets gewijzigd in de code. Noteer de cijfers voor Task 7.

---

### Task 7: Tonen in Data Quality

**Files:**
- Modify: `src/app/api/admin/shipment-issues/route.ts`
- Modify: het bijbehorende scherm onder `src/app/(portal)/admin/` dat dit endpoint uitleest

**Interfaces:**
- Consumes: `resolveSalesSheetMatch` uit Task 3, de kolommen uit Task 1
- Produces: een derde waarde voor de `type`-parameter: `pdf-mismatch`

- [ ] **Step 1: Lees hoe de bestaande twee typen werken**

Open `src/app/api/admin/shipment-issues/route.ts`. Het endpoint kent `missing-pdf` en `stem-gap` en bouwt zijn query als `Prisma.Sql`-object dat als argument aan `prisma.$queryRaw(...)` wordt meegegeven — níét als tagged template. Dat is noodzaak: met een genest fragment breekt de SWC-compilatie van Next hem en antwoordt Postgres met `42601 syntax error at or near "$1"`, ook bij een query zonder parameters. Houd die vorm aan.

- [ ] **Step 2: Voeg het derde type toe**

Breid de typeparameter uit met `pdf-mismatch` en voeg een SQL-tak toe die de afrekeningen selecteert waar een netto is gelezen en het verschil boven de drempel ligt:

```sql
ss."pdfParsedAt" IS NOT NULL
  AND ss."pdfNetResult" IS NOT NULL
  AND ABS(ss."pdfNetResult" - ss."netResult") > 1
```

De drempel komt uit `SALESSHEET_MATCH_TOLERANCE`; interpoleer hem als parameter in plaats van hem hier hard te schrijven, zodat één plek hem bepaalt.

Neem in de geselecteerde velden `pdfNetResult` en `netResult` mee, plus het verschil, zodat het scherm beide bedragen kan tonen zonder een tweede aanroep.

- [ ] **Step 3: Toon het in het scherm**

Voeg het derde type toe aan de filterkeuze en toon per rij: leverancier, leveringsnummer, leverdatum, het bedrag op de PDF, het berekende bedrag en het verschil. Volg de opmaak van de bestaande twee typen; UI-teksten in het Engels.

- [ ] **Step 4: Verifieer in de draaiende app**

Start de dev-server (`NODE_OPTIONS='--max-old-space-size=2048' npx next dev`), ga naar Admin -> Import Status -> Data Quality en kies het nieuwe type. Expected: de lijst toont de afrekeningen die Task 6 als mismatch telde, en de aantallen komen overeen.

- [ ] **Step 5: Verifieer**

Run: `npx tsc --noEmit -p tsconfig.json && npx eslint <gewijzigde bestanden> && npm run check`
Expected: schoon.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/admin/shipment-issues/route.ts <het scherm>
git commit -m "Surface sales sheets that disagree with the computation"
```

---

### Task 8: Vastleggen in CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: de cijfers uit Task 6
- Produces: niets in code

- [ ] **Step 1: Beschrijf de nieuwe velden bij het `SalesSheet`-model**

In de sectie "Database Schema (Key Models)", bij `SalesSheet`: noem de vier kolommen, dat ze uit de PDF komen en niet uit Fabric, en dat het oordeel wordt afgeleid en niet opgeslagen.

- [ ] **Step 2: Beschrijf het derde type onder Shipment Status**

Bij het bestaande stuk over `/api/admin/shipment-issues`: `pdf-mismatch` erbij, met de reden dat het netto de enige grootheid is die aan beide kanten hetzelfde betekent, en met de gemeten cijfers uit Task 6.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "Record what the sales sheet check does and what it measured"
```

---

## Self-Review

**Spec coverage:**

| Spec-onderdeel | Taak |
|---|---|
| Vier kolommen op `SalesSheet` | 1 |
| Extractie in de bestaande parser, beide talen, btw-nuance | 2 |
| Fixtures met echte tekstfragmenten | 2 |
| Pure functie met vier uitkomsten en drempel | 3 |
| Schrijven bij koppelen | 4 |
| Wissen bij loskoppelen | 4 |
| Tonen in `shipment-issues` + scherm | 7 |
| Inhaalslag | 5, uitgevoerd in 6 |
| Testen | 2 en 3 |
| Buiten scope: regelniveau, blokkeren | nergens — bewust |

Geen gaten.

**Placeholders:** geen "TBD" of "handle edge cases"; elke codestap draagt de code. Task 7 stap 3 noemt het scherm niet bij naam omdat het pad afhangt van hoe het endpoint nu wordt uitgelezen — de eerste stap van die taak is dat opzoeken, en dat is een opdracht en geen placeholder.

**Typeconsistentie:** `parseSalesSheetAmounts` levert `{ turnover, costs, netResult }`; `ParsedSalesSheetPdf` draagt dezelfde drie namen; `resolveSalesSheetMatch` neemt `pdfNetResult` en `computedNetResult` en die namen komen terug in Task 4, 5 en 7. `SALESSHEET_MATCH_TOLERANCE` wordt in Task 3 gedefinieerd en in Task 7 gebruikt in plaats van een hard getal.
