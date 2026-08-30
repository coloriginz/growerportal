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
import { resolveSalesSheetMatch, type SalesSheetMatch } from "../src/lib/salessheet-match";

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
const LIMIT = Number(argWaarde("--limit") ?? 0) || Infinity;
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
  let gelezen = 0;
  let metNetto = 0;
  let zonderNetto = 0;
  let nietGevonden = 0;

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
    if (turnover === null && costs === null && netResult === null) zonderNetto++;
    else metNetto++;

    const status = resolveSalesSheetMatch({
      hasPdf: true,
      pdfParsedAt: new Date(),
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
      await prisma.salesSheet.update({
        where: { id: sheet.id },
        data: {
          pdfTurnover: turnover,
          pdfCosts: costs,
          pdfNetResult: netResult,
          pdfParsedAt: new Date(),
        },
      });
    }

    if ((i + 1) % 250 === 0) console.log(`  ${i + 1}/${werklijst.length}`);
  }

  const tel = (s: SalesSheetMatch) => uitkomsten.filter((u) => u.status === s).length;
  // Zelfde afleiding als `resolveSalesSheetMatch`: netto rechtstreeks, of omzet
  // min kosten wanneer het netto-label ontbrak op de PDF.
  const pdfNetto = (u: Uitkomst): number | null =>
    u.netResult !== null ? u.netResult : u.turnover !== null ? u.turnover - (u.costs ?? 0) : null;
  const grootsteVerschillen = uitkomsten
    .map((u) => ({ u, netto: pdfNetto(u) }))
    .filter((r): r is { u: Uitkomst; netto: number } => r.netto !== null)
    .map((r) => ({ ...r, verschil: Math.abs(r.netto - r.u.computedNetResult) }))
    .sort((a, b) => b.verschil - a.verschil)
    .slice(0, 10);

  console.log("");
  console.log(`gelezen              : ${gelezen}`);
  console.log(`  met bedrag         : ${metNetto}`);
  console.log(`  zonder bedrag      : ${zonderNetto}`);
  console.log(`bestand niet gevonden: ${nietGevonden}`);
  if (APPLY) console.log(`weggeschreven        : ${uitkomsten.length}`);
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
