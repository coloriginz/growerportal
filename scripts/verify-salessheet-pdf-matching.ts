/*
 * Vergelijkt de oude en de nieuwe koppelmethode voor salessheet-PDF's tegen de
 * echte corpus in private_input/salessheets.
 *
 * Oud: SalesSheet zoeken op invoiceNumber = reference uit de bestandsnaam.
 * Nieuw: kandidaten verzamelen (exacte referentie, "-<parthdrId>"-variant en
 *        ourInvoiceNumber) en alleen koppelen bij een exacte match op de
 *        leverdatum die op de PDF staat.
 *
 * Draaien:  npx tsx scripts/verify-salessheet-pdf-matching.ts [maxAantal]
 *
 * Leest de database via de Neon HTTP-driver; Prisma over TCP 5432 komt niet
 * door het werknetwerk heen.
 */
import fs from "fs";
import path from "path";
import { neon } from "@neondatabase/serverless";
import { parseSalesSheetFilename, parseSalesSheetFilenameSimple } from "../src/lib/salessheet-filename-parser";
import { parseSalesSheetPdf } from "../src/lib/salessheet-pdf-parser";

const PDF_ROOT = "private_input/salessheets";
const max = Number(process.argv[2]) || Infinity;

const url = fs.readFileSync(".env", "utf8").match(/^DATABASE_URL="?([^"\n\r]+)"?/m)![1];
const sql = neon(url);

interface Sheet {
  id: string;
  invoiceNumber: string;
  ourInvoiceNumber: string | null;
  deliveryDate: string;
  supplierCode: string;
}

function collectPdfs(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) collectPdfs(p, out);
    else if (/\.pdf$/i.test(entry.name)) out.push(p);
  }
  return out;
}

/** Dezelfde kandidaatregel als in de importroute. */
function findCandidates(
  sheets: Sheet[],
  byInvoiceNumber: Map<string, Sheet[]>,
  byOurInvoiceNumber: Map<string, Sheet[]>,
  references: (string | null)[],
  ourInvoiceNumber: string | null
): Sheet[] {
  const byId = new Map<string, Sheet>();
  for (const ref of [...new Set(references.filter((r): r is string => !!r))]) {
    for (const s of byInvoiceNumber.get(ref) ?? []) byId.set(s.id, s);
    const suffixed = new RegExp(`^${ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-\\d{5,}$`);
    for (const s of sheets) if (suffixed.test(s.invoiceNumber)) byId.set(s.id, s);
  }
  if (ourInvoiceNumber) {
    for (const s of byOurInvoiceNumber.get(ourInvoiceNumber) ?? []) byId.set(s.id, s);
  }
  return [...byId.values()];
}

(async () => {
  const rows = (await sql`
    SELECT ss.id, ss."invoiceNumber", ss."ourInvoiceNumber",
           to_char(ss."deliveryDate", 'YYYY-MM-DD') AS "deliveryDate",
           s.code AS "supplierCode"
    FROM "SalesSheet" ss JOIN "Supplier" s ON s.id = ss."supplierId"`) as unknown as Sheet[];
  console.log(`${rows.length} salessheets uit de database`);

  const byInvoiceNumber = new Map<string, Sheet[]>();
  const byOurInvoiceNumber = new Map<string, Sheet[]>();
  for (const s of rows) {
    (byInvoiceNumber.get(s.invoiceNumber) ?? byInvoiceNumber.set(s.invoiceNumber, []).get(s.invoiceNumber)!).push(s);
    if (s.ourInvoiceNumber) {
      (byOurInvoiceNumber.get(s.ourInvoiceNumber) ?? byOurInvoiceNumber.set(s.ourInvoiceNumber, []).get(s.ourInvoiceNumber)!).push(s);
    }
  }

  const pdfs = collectPdfs(PDF_ROOT).slice(0, max);
  console.log(`${pdfs.length} PDF's te controleren\n`);

  const telling = {
    gelijk_goed: 0, gelijk_geenmatch: 0,
    hersteld: 0, nieuw_geweigerd: 0, nieuw_gekoppeld: 0,
    datum_onleesbaar: 0, oud_fout_nieuw_ook: 0,
  };
  const hersteld: string[] = [];
  const geweigerd: string[] = [];
  let verwerkt = 0;

  for (const file of pdfs) {
    const name = path.basename(file);
    let reference: string | null = null;
    let ourInvoiceNumber: string | null = null;
    const named = parseSalesSheetFilename(name);
    const fromName = named ?? parseSalesSheetFilenameSimple(name);
    if (fromName) {
      reference = fromName.reference;
      ourInvoiceNumber = fromName.ourInvoiceNumber;
    }

    let pdfReference: string | null = null;
    let deliveryDate: string | null = null;
    try {
      const parsed = await parseSalesSheetPdf(fs.readFileSync(file));
      pdfReference = parsed.reference;
      deliveryDate = parsed.deliveryDate;
      ourInvoiceNumber = ourInvoiceNumber || parsed.ourInvoiceNumber;
    } catch {
      /* onleesbaar */
    }
    if (!deliveryDate) telling.datum_onleesbaar++;

    // OUD: exacte findUnique op invoiceNumber, eerst bestandsnaam, dan PDF-inhoud
    const oudLijst = byInvoiceNumber.get(reference ?? "") ?? byInvoiceNumber.get(pdfReference ?? "") ?? [];
    const oud = oudLijst.length === 1 ? oudLijst[0] : null;

    // NIEUW
    let kandidaten = findCandidates(rows, byInvoiceNumber, byOurInvoiceNumber, [reference, pdfReference], ourInvoiceNumber);
    if (named?.supplierCode) {
      const vanLeverancier = kandidaten.filter((c) => c.supplierCode === named.supplierCode);
      if (vanLeverancier.length > 0) kandidaten = vanLeverancier;
    }
    let nieuw: Sheet | null = null;
    if (kandidaten.length > 0) {
      if (deliveryDate) {
        let opDatum = kandidaten.filter((c) => c.deliveryDate === deliveryDate);
        if (opDatum.length > 1 && ourInvoiceNumber) {
          const exact = opDatum.filter((c) => c.ourInvoiceNumber === ourInvoiceNumber);
          const vrij = opDatum.filter((c) => !c.ourInvoiceNumber || c.ourInvoiceNumber === ourInvoiceNumber);
          if (exact.length === 1) opDatum = exact;
          else if (vrij.length === 1) opDatum = vrij;
        }
        nieuw = opDatum.length === 1 ? opDatum[0] : null;
      } else {
        nieuw = kandidaten.length === 1 ? kandidaten[0] : null;
      }
    }

    const oudGoed = oud && deliveryDate ? oud.deliveryDate === deliveryDate : null;
    const nieuwGoed = nieuw && deliveryDate ? nieuw.deliveryDate === deliveryDate : null;

    if (oud?.id === nieuw?.id) {
      if (nieuw) telling.gelijk_goed++;
      else telling.gelijk_geenmatch++;
    } else if (oud && nieuw) {
      telling.hersteld++;
      hersteld.push(`${name}: ${oud.invoiceNumber} (${oud.deliveryDate}) -> ${nieuw.invoiceNumber} (${nieuw.deliveryDate}), PDF ${deliveryDate}`);
    } else if (oud && !nieuw) {
      if (oudGoed === false) {
        telling.nieuw_geweigerd++;
        geweigerd.push(`${name}: oud koppelde ${oud.invoiceNumber} (${oud.deliveryDate}), PDF zegt ${deliveryDate}`);
      } else {
        telling.oud_fout_nieuw_ook++;
        geweigerd.push(`LET OP ${name}: oud koppelde ${oud.invoiceNumber} (${oud.deliveryDate}), PDF ${deliveryDate}, nieuw weigert`);
      }
    } else if (!oud && nieuw) {
      telling.nieuw_gekoppeld++;
    }

    if (nieuw && nieuwGoed === false) {
      console.log(`FOUT: nieuwe methode koppelt ${name} aan ${nieuw.invoiceNumber} (${nieuw.deliveryDate}) terwijl PDF ${deliveryDate} zegt`);
    }

    if (++verwerkt % 250 === 0) console.log(`  ${verwerkt}/${pdfs.length} verwerkt`);
  }

  console.log("\n=== Uitkomst ===");
  console.log(`  beide dezelfde koppeling      : ${telling.gelijk_goed}`);
  console.log(`  beide geen koppeling          : ${telling.gelijk_geenmatch}`);
  console.log(`  HERSTELD (andere salessheet)  : ${telling.hersteld}`);
  console.log(`  nieuw weigert foute koppeling : ${telling.nieuw_geweigerd}`);
  console.log(`  nieuw weigert terwijl oud goed of onbekend was: ${telling.oud_fout_nieuw_ook}`);
  console.log(`  nieuw koppelt waar oud niets vond: ${telling.nieuw_gekoppeld}`);
  console.log(`  leverdatum onleesbaar         : ${telling.datum_onleesbaar}`);

  if (hersteld.length) {
    console.log(`\n=== Herstelde koppelingen (${hersteld.length}) ===`);
    hersteld.forEach((r) => console.log("  " + r));
  }
  if (geweigerd.length) {
    console.log(`\n=== Geweigerd (${geweigerd.length}) ===`);
    geweigerd.forEach((r) => console.log("  " + r));
  }
})();
