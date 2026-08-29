/*
 * Controleert elke bestaande salessheet-koppeling tegen de PDF zelf.
 *
 * De koppelroute legt alleen een verband als de leverdatum op de PDF exact
 * gelijk is aan die van de afrekening — sales sheet-nummers recyclen per jaar,
 * dus het nummer alleen is niet genoeg. Koppelingen van vóór die controle staan
 * er nog, en die zijn niet aan de portal te zien: er hangt een PDF, hij opent,
 * en hij gaat over een andere levering.
 *
 * Gemeten op 29 augustus 2026: zes PCFUP-leveringen uit februari en maart 2025
 * droegen de afrekening van februari en maart 2026, waarvan drie van een heel
 * andere leverancier (Israël, Zuid-Afrika). De kweker kan dus de afrekening van
 * een concurrent downloaden. Zie `tasks/todo-salessheet-verkeerde-leverancier.md`.
 *
 * Dit script leest de PDF uit het lokale archief, vergelijkt de leverdatum met
 * die van de afrekening, en maakt met `--apply` de koppelingen los die niet
 * kloppen. Losmaken is genoeg: `scripts/link-salessheet-pdfs.ts` zoekt
 * afrekeningen zónder PDF en biedt ze opnieuw aan, en die route legt ze dan met
 * de datumcontrole erbij goed.
 *
 * Draaien:
 *   npx tsx scripts/audit-salessheet-links.ts                 # dry run
 *   npx tsx scripts/audit-salessheet-links.ts --apply         # koppelingen losmaken
 *   npx tsx scripts/audit-salessheet-links.ts --limit=200     # proefje
 *
 * Opties:
 *   --apply        maak foute koppelingen los. Zonder deze vlag wordt er niets gewijzigd.
 *   --check-urls   controleer ook of het bestand in de blobopslag nog bestaat. Kost een
 *                  netwerkaanroep per koppeling, dus staat standaard uit.
 *   --limit=N      controleer hooguit N koppelingen.
 *   --archief=PAD  wortelmap met PDF's. Standaard private_input/salessheets.
 *   --report=PAD   schrijf het rapport hierheen.
 */
import * as fs from "fs";
import * as path from "path";
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { parseSalesSheetPdf } from "../src/lib/salessheet-pdf-parser";

function argWaarde(vlag: string): string | undefined {
  const arg = process.argv.slice(2).find((a) => a.startsWith(vlag + "="));
  return arg ? arg.slice(vlag.length + 1) : undefined;
}

const APPLY = process.argv.includes("--apply");
const CHECK_URLS = process.argv.includes("--check-urls");
const LIMIT = Number(argWaarde("--limit") ?? 0) || Infinity;
const ARCHIEF = argWaarde("--archief") ?? path.join("private_input", "salessheets");
const REPORT = argWaarde("--report") ?? path.join("tasks", "audit-salessheet-links.md");

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
  leverdatumPortal: string;
  bestand: string;
  leverdatumPdf: string | null;
  status:
    | "klopt"
    | "datum wijkt af"
    | "datum onleesbaar"
    | "bestand niet gevonden"
    | "blob onbereikbaar";
};

async function main() {
  if (!fs.existsSync(ARCHIEF)) {
    console.error(`Archief niet gevonden: ${ARCHIEF}`);
    process.exit(1);
  }
  const archief = indexeerArchief(ARCHIEF);
  console.log(`archief: ${[...archief.values()].reduce((a, l) => a + l.length, 0)} PDF's`);

  const gekoppeld = await prisma.salesSheet.findMany({
    where: { pdfDocumentId: { not: null } },
    select: {
      id: true,
      invoiceNumber: true,
      deliveryDate: true,
      pdfDocumentId: true,
      supplier: { select: { code: true } },
      pdfDocument: { select: { fileName: true, fileUrl: true } },
    },
    orderBy: { deliveryDate: "asc" },
  });
  const teDoen = LIMIT === Infinity ? gekoppeld : gekoppeld.slice(0, LIMIT);
  console.log(`gekoppelde afrekeningen: ${gekoppeld.length}${teDoen.length < gekoppeld.length ? ` — beperkt tot ${teDoen.length}` : ""}`);
  console.log(APPLY ? "Foute koppelingen worden losgemaakt" : "DRY RUN — er wordt niets gewijzigd");
  console.log("");

  const uitkomsten: Uitkomst[] = [];
  const losTeMaken: string[] = [];

  for (const [i, sheet] of teDoen.entries()) {
    const naam = sheet.pdfDocument?.fileName ?? "";
    const paden = archief.get(naam.toLowerCase()) ?? [];
    const leverdatumPortal = sheet.deliveryDate.toISOString().slice(0, 10);
    const basis = {
      invoiceNumber: sheet.invoiceNumber,
      supplier: sheet.supplier.code,
      leverdatumPortal,
      bestand: naam,
    };

    /*
     * Eerst of het bestand er nog is. Een afrekening kan een documentverwijzing
     * dragen waarvan de blob verdwenen is: in het scherm staat dan een
     * downloadknop die nergens heen gaat. Dat is een andere fout dan een
     * verkeerd gekoppelde PDF en hij is niet aan de data te zien, alleen aan de
     * opslag. Ook hier is losmaken de reparatie — een knop die niets doet is
     * erger dan geen knop.
     */
    if (CHECK_URLS && sheet.pdfDocument?.fileUrl) {
      let bereikbaar = false;
      try {
        bereikbaar = (await fetch(sheet.pdfDocument.fileUrl, { method: "HEAD" })).ok;
      } catch {
        bereikbaar = false;
      }
      if (!bereikbaar) {
        uitkomsten.push({ ...basis, leverdatumPdf: null, status: "blob onbereikbaar" });
        losTeMaken.push(sheet.id);
        continue;
      }
    }

    if (paden.length === 0) {
      uitkomsten.push({ ...basis, leverdatumPdf: null, status: "bestand niet gevonden" });
      continue;
    }

    let leverdatumPdf: string | null = null;
    try {
      leverdatumPdf = (await parseSalesSheetPdf(fs.readFileSync(paden[0]))).deliveryDate;
    } catch {
      // Een onleesbare PDF is geen bewijs van een foute koppeling; alleen melden.
    }

    if (!leverdatumPdf) {
      uitkomsten.push({ ...basis, leverdatumPdf: null, status: "datum onleesbaar" });
    } else if (leverdatumPdf === leverdatumPortal) {
      uitkomsten.push({ ...basis, leverdatumPdf, status: "klopt" });
    } else {
      uitkomsten.push({ ...basis, leverdatumPdf, status: "datum wijkt af" });
      losTeMaken.push(sheet.id);
    }

    if ((i + 1) % 250 === 0) console.log(`  ${i + 1}/${teDoen.length}`);
  }

  /*
   * Alleen de koppeling weghalen, niet het Document. Het bestand blijft in de
   * blobopslag en in de documentenlijst staan; wat vervalt is de bewering dat
   * het bij déze afrekening hoort. Zou het document ook verdwijnen, dan is een
   * verkeerde koppeling niet meer terug te vinden en kan niemand nakijken wat
   * er stond.
   */
  if (APPLY && losTeMaken.length > 0) {
    const losgemaakt = await prisma.salesSheet.updateMany({
      where: { id: { in: losTeMaken } },
      data: { pdfDocumentId: null },
    });
    console.log(`\nlosgemaakt: ${losgemaakt.count} koppelingen`);
  }

  schrijfRapport(uitkomsten);

  const tel = (s: Uitkomst["status"]) => uitkomsten.filter((u) => u.status === s).length;
  console.log("");
  console.log(`klopt                : ${tel("klopt")}`);
  if (CHECK_URLS) console.log(`blob onbereikbaar    : ${tel("blob onbereikbaar")}${APPLY ? " (losgemaakt)" : ""}`);
  console.log(`datum wijkt af       : ${tel("datum wijkt af")}${APPLY ? " (losgemaakt)" : ""}`);
  console.log(`datum onleesbaar     : ${tel("datum onleesbaar")}`);
  console.log(`bestand niet gevonden: ${tel("bestand niet gevonden")}`);
  console.log(`Rapport: ${REPORT}`);
}

function schrijfRapport(uitkomsten: Uitkomst[]) {
  const fout = uitkomsten.filter((u) => u.status === "datum wijkt af");
  const regels = [
    "# Audit salessheet-koppelingen",
    "",
    "Uitgevoerd: " + new Date().toISOString().slice(0, 16).replace("T", " "),
    "Modus: " + (APPLY ? "foute koppelingen losgemaakt" : "dry run"),
    "",
    "| uitkomst | aantal |",
    "|---|---|",
    ...([
      "klopt",
      "datum wijkt af",
      "datum onleesbaar",
      "bestand niet gevonden",
      "blob onbereikbaar",
    ] as const).map(
      (s) => `| ${s} | ${uitkomsten.filter((u) => u.status === s).length} |`
    ),
    "",
    "## Koppelingen waarvan de leverdatum afwijkt",
    "",
    "| leverancier | shipment | leverdatum portal | leverdatum op PDF | bestand |",
    "|---|---|---|---|---|",
    ...fout.map(
      (u) =>
        `| ${u.supplier} | ${u.invoiceNumber} | ${u.leverdatumPortal} | ${u.leverdatumPdf} | ${u.bestand} |`
    ),
    "",
  ];
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, regels.join("\n"), "utf8");
}

main()
  .catch((e) => {
    console.error("FOUT:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
