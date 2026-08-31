/*
 * Leest de bedragen (omzet, kosten, netto) uit de PDF terug op elke koppeling
 * die vóór dat de vier `pdf*`-kolommen bestonden al aan een document hing.
 *
 * De koppelroute (`/api/shipments/import-email`) vult `pdfTurnover`, `pdfCosts`,
 * `pdfNetResult` en `pdfParsedAt` vanzelf bij elke nieuwe koppeling. Bestaande
 * koppelingen — op test ~3.600, op productie 364 — hebben die stap nooit gehad
 * en staan dus op `pdfParsedAt: null`, ononderscheidbaar van "nog nooit
 * gekoppeld". Dit script is de inhaalslag: het pakt precies die achterstand,
 * niet de koppeling zelf (die staat vast, zie `audit-salessheet-links.ts` voor
 * de controle daarop).
 *
 * `pdfParsedAt` wordt bij `--apply` altijd gezet, ook als er geen enkel bedrag
 * uit de PDF kwam. Dat is het hele punt van dat veld: het onderscheidt "nog
 * nooit gelezen" van "gelezen en niets gevonden" (zie `resolveSalesSheetMatch`
 * in `src/lib/salessheet-match.ts`, die op die aanwezigheid draait).
 *
 * Draaien:
 *   npx tsx scripts/backfill-pdf-totals.ts                 # dry run
 *   npx tsx scripts/backfill-pdf-totals.ts --apply         # bedragen wegschrijven
 *   npx tsx scripts/backfill-pdf-totals.ts --limit=25      # proefje
 *
 * Opties:
 *   --apply        schrijf de gelezen bedragen en `pdfParsedAt` weg. Zonder deze
 *                  vlag wordt er niets gewijzigd.
 *   --blob         haal bestanden die niet in het lokale archief staan uit de
 *                  blobopslag. Traag, maar op productie staat élk bestand alleen
 *                  daar.
 *   --limit=N      lees hooguit N koppelingen.
 *   --archief=PAD  wortelmap met PDF's. Standaard private_input/salessheets.
 */
import * as fs from "fs";
import * as path from "path";
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { parseSalesSheetPdf } from "../src/lib/salessheet-pdf-parser";
import { derivePdfNetResult, resolveSalesSheetMatch, type SalesSheetMatch } from "../src/lib/salessheet-match";

function argWaarde(vlag: string): string | undefined {
  const arg = process.argv.slice(2).find((a) => a.startsWith(vlag + "="));
  return arg ? arg.slice(vlag.length + 1) : undefined;
}

const APPLY = process.argv.includes("--apply");
/**
 * Haal bestanden die niet in het archief staan op uit de blobopslag. Zonder dit
 * blijft elke e-mailkoppeling ongelezen — op productie is dat alles.
 */
const BLOB = process.argv.includes("--blob");
/*
 * Geen vlag meegegeven: onbeperkt. Wel meegegeven, ook `--limit=0`: exact dat
 * getal. `Number(...) || Infinity` maakte van `--limit=0` per ongeluk hetzelfde
 * als geen vlag — 0 is falsy, dus die viel terug op Infinity, het tegenovergestelde
 * van "nul koppelingen lezen".
 */
const limitArg = argWaarde("--limit");
const LIMIT = limitArg === undefined ? Infinity : Number(limitArg);
const ARCHIEF = argWaarde("--archief") ?? path.join("private_input", "salessheets");

/** Alle PDF's in het archief, op kleine-letter bestandsnaam. */
function indexeerArchief(wortel: string): Map<string, string[]> {
  const perNaam = new Map<string, string[]>();
  const loop = (map: string) => {
    for (const item of fs.readdirSync(map, { withFileTypes: true })) {
      const pad = path.join(map, item.name);
      if (item.isDirectory()) loop(pad);
      else if (/\.pdf$/i.test(item.name)) {
        const sleutel = item.name.toLowerCase();
        const lijst = perNaam.get(sleutel);
        if (lijst) lijst.push(pad);
        else perNaam.set(sleutel, [pad]);
      }
    }
  };
  loop(wortel);
  return perNaam;
}

type Uitkomst = {
  invoiceNumber: string;
  supplier: string;
  bestand: string;
  turnover: number | null;
  costs: number | null;
  netResult: number | null;
  computedNetResult: number;
  status: SalesSheetMatch;
};

/**
 * Brokgrootte voor het wegschrijven. Bewust klein: een echte run op test viel
 * na ~250 documenten om met "Can't reach database server" (Neon-verbinding
 * onderweg weg), en dit script is juist herstelbaar omdat de werklijst
 * (`pdfParsedAt IS NULL`) zelf bijhoudt wat nog moet. Eén `update()` per
 * document maakte dat voordeel onbruikbaar traag; met een brok van 200 kost
 * een verbroken verbinding hooguit die ene brok, en de rest blijft staan voor
 * de volgende run.
 */
const CHUNK_SIZE = 200;

type PendingWrite = {
  id: string;
  turnover: number | null;
  costs: number | null;
  netResult: number | null;
  parsedAt: string;
};

/**
 * Schrijft één brok gelezen bedragen in een enkele UPDATE weg — zelfde
 * patroon als de orders-import (`jsonb_array_elements`, zie
 * `src/app/api/import/orders/route.ts`). `->>` levert SQL NULL op voor een
 * JSON-null waarde, dus een bedrag dat de PDF niet gaf landt als NULL en niet
 * als 0 — dat onderscheid is het hele punt van deze kolommen.
 */
async function schrijfBrokWeg(brok: PendingWrite[]): Promise<void> {
  if (brok.length === 0) return;
  await prisma.$executeRawUnsafe(
    `UPDATE "SalesSheet" AS t
     SET
       "pdfTurnover" = (v.val->>'turnover')::numeric,
       "pdfCosts" = (v.val->>'costs')::numeric,
       "pdfNetResult" = (v.val->>'netResult')::numeric,
       "pdfParsedAt" = (v.val->>'parsedAt')::timestamp,
       "updatedAt" = NOW()
     FROM jsonb_array_elements($1::jsonb) AS v(val)
     WHERE t.id = v.val->>'id'`,
    JSON.stringify(brok)
  );
}

async function main() {
  if (!fs.existsSync(ARCHIEF)) {
    console.error(`Archief niet gevonden: ${ARCHIEF}`);
    process.exit(1);
  }
  const archief = indexeerArchief(ARCHIEF);
  console.log(`archief: ${[...archief.values()].reduce((a, l) => a + l.length, 0)} PDF's`);

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
  const werklijst = LIMIT === Infinity ? teDoen : teDoen.slice(0, LIMIT);
  console.log(
    `nog te lezen: ${teDoen.length}${werklijst.length < teDoen.length ? ` — beperkt tot ${werklijst.length}` : ""}`
  );
  console.log(APPLY ? "Gelezen bedragen worden weggeschreven" : "DRY RUN — er wordt niets gewijzigd");
  console.log("");

  const uitkomsten: Uitkomst[] = [];
  const brok: PendingWrite[] = [];
  let gelezen = 0;
  let metBedrag = 0;
  let zonderBedrag = 0;
  let nietGevonden = 0;
  let weggeschreven = 0;

  for (const [i, sheet] of werklijst.entries()) {
    const naam = sheet.pdfDocument?.fileName ?? "";
    const paden = archief.get(naam.toLowerCase()) ?? [];
    const computedNetResult = Number(sheet.netResult);

    let bron: Buffer | null = null;
    if (paden.length > 0) {
      bron = fs.readFileSync(paden[0]);
    } else if (BLOB && sheet.pdfDocument?.fileUrl) {
      // Alleen op verzoek: dit haalt elk bestand op dat niet lokaal staat.
      try {
        const res = await fetch(sheet.pdfDocument.fileUrl);
        if (res.ok) bron = Buffer.from(await res.arrayBuffer());
      } catch {
        // onbereikbaar; hieronder afgehandeld als "niet gevonden"
      }
    }

    if (!bron) {
      nietGevonden++;
      continue;
    }

    let turnover: number | null = null;
    let costs: number | null = null;
    let netResult: number | null = null;
    try {
      const gelezenPdf = await parseSalesSheetPdf(bron);
      turnover = gelezenPdf.turnover;
      costs = gelezenPdf.costs;
      netResult = gelezenPdf.netResult;
    } catch {
      // Onleesbare PDF: alle drie blijven null, `pdfParsedAt` wordt bij --apply
      // toch gezet — dat is precies het onderscheid dat dit veld moet dragen.
    }

    gelezen++;
    if (turnover === null && costs === null && netResult === null) zonderBedrag++;
    else metBedrag++;

    const parsedAt = new Date();
    const status = resolveSalesSheetMatch({
      hasPdf: true,
      pdfParsedAt: parsedAt,
      pdfNetResult: netResult,
      pdfTurnover: turnover,
      pdfCosts: costs,
      computedNetResult,
    });

    uitkomsten.push({
      invoiceNumber: sheet.invoiceNumber,
      supplier: sheet.supplier.code,
      bestand: naam,
      turnover,
      costs,
      netResult,
      computedNetResult,
      status,
    });

    if (APPLY) {
      brok.push({ id: sheet.id, turnover, costs, netResult, parsedAt: parsedAt.toISOString() });
      if (brok.length >= CHUNK_SIZE) {
        await schrijfBrokWeg(brok);
        weggeschreven += brok.length;
        brok.length = 0;
        console.log(`  weggeschreven: ${weggeschreven}/${werklijst.length}`);
      }
    }

    if ((i + 1) % CHUNK_SIZE === 0) console.log(`  gelezen: ${i + 1}/${werklijst.length}`);
  }

  // Laatste, onvolle brok alsnog wegschrijven.
  if (APPLY && brok.length > 0) {
    await schrijfBrokWeg(brok);
    weggeschreven += brok.length;
    console.log(`  weggeschreven: ${weggeschreven}/${werklijst.length}`);
  }

  const tel = (s: SalesSheetMatch) => uitkomsten.filter((u) => u.status === s).length;
  const grootsteVerschillen = uitkomsten
    .map((u) => ({
      u,
      // Dezelfde afleiding als `resolveSalesSheetMatch`, uit `salessheet-match.ts`
      // zelf — dit stond hier vroeger nog een derde keer uitgeschreven, met het
      // risico dat de regel op twee plekken uiteen zou lopen.
      netto: derivePdfNetResult({ pdfNetResult: u.netResult, pdfTurnover: u.turnover, pdfCosts: u.costs }),
    }))
    .filter((r): r is { u: Uitkomst; netto: number } => r.netto !== null)
    .map((r) => ({ ...r, verschil: Math.abs(r.netto - r.u.computedNetResult) }))
    .sort((a, b) => b.verschil - a.verschil)
    .slice(0, 10);

  console.log("");
  console.log(`gelezen              : ${gelezen}`);
  console.log(`  met bedrag         : ${metBedrag}`);
  console.log(`  zonder bedrag      : ${zonderBedrag}`);
  console.log(`bestand niet gevonden: ${nietGevonden}`);
  if (APPLY) console.log(`weggeschreven        : ${weggeschreven}`);
  console.log("");
  console.log(`match                : ${tel("match")}`);
  console.log(`mismatch             : ${tel("mismatch")}`);
  console.log(`unread               : ${tel("unread")}`);
  console.log("");

  if (grootsteVerschillen.length > 0) {
    console.log("grootste verschillen (netto portal vs. netto PDF):");
    console.log("leverancier | shipment | netto portal | netto PDF | verschil");
    for (const { u, netto, verschil } of grootsteVerschillen) {
      console.log(
        `  ${u.supplier} | ${u.invoiceNumber} | ${u.computedNetResult.toFixed(2)} | ${netto.toFixed(2)} | ${verschil.toFixed(2)}`
      );
    }
  }
}

main()
  .catch((e) => {
    console.error("FOUT:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
