/*
 * Herstelt salessheet-PDF's die aan de verkeerde levering hangen.
 *
 * Controleert elke bestaande koppeling door de leverdatum op de PDF te
 * vergelijken met SalesSheet.deliveryDate. Bij een afwijking wordt de juiste
 * salessheet gezocht met dezelfde regel als de importroute; lukt dat, dan
 * wordt de koppeling verplaatst, anders losgemaakt.
 *
 * Ook `ourInvoiceNumber` wordt op de foute salessheet leeggemaakt: dat veld is
 * ooit gevuld vanuit de verkeerd gekoppelde PDF en is dus besmet.
 *
 * Draaien:
 *   npx tsx scripts/fix-salessheet-pdf-links.ts            # alleen rapporteren
 *   npx tsx scripts/fix-salessheet-pdf-links.ts --apply    # ook wegschrijven
 *
 * Voor productie draait hetzelfde script tegen een ander env-bestand:
 *   ENV_FILE=.env.production npx tsx scripts/fix-salessheet-pdf-links.ts
 *
 * Leest via de Neon HTTP-driver; Prisma over TCP 5432 komt niet door het
 * werknetwerk heen.
 */
import fs from "fs";
import dotenv from "dotenv";
import { neon } from "@neondatabase/serverless";
import { del } from "@vercel/blob";
import { parseSalesSheetFilename, parseSalesSheetFilenameSimple } from "../src/lib/salessheet-filename-parser";
import { parseSalesSheetPdf } from "../src/lib/salessheet-pdf-parser";

const APPLY = process.argv.includes("--apply");
const PARALLEL = 6;

const ENV_FILE = process.env.ENV_FILE || ".env";
if (!fs.existsSync(ENV_FILE)) throw new Error(`${ENV_FILE} bestaat niet`);

/*
 * Het hele bestand laden, niet alleen DATABASE_URL: del() hieronder haalt
 * BLOB_READ_WRITE_TOKEN uit de omgeving. Wijst de database naar productie
 * terwijl het blob-token nog naar test wijst, dan wordt de koppeling wel
 * losgemaakt maar het bestand niet verwijderd — of erger, in de verkeerde
 * store gezocht. Beide horen uit hetzelfde bestand te komen.
 */
dotenv.config({ path: ENV_FILE, override: true });

const url = process.env.DATABASE_URL;
if (!url) throw new Error(`DATABASE_URL ontbreekt in ${ENV_FILE}`);
if (APPLY && !process.env.BLOB_READ_WRITE_TOKEN) {
  throw new Error(`BLOB_READ_WRITE_TOKEN ontbreekt in ${ENV_FILE} — nodig om losgemaakte PDF's op te ruimen`);
}
const sql = neon(url);

interface Sheet {
  id: string;
  invoiceNumber: string;
  ourInvoiceNumber: string | null;
  deliveryDate: string;
  supplierId: string;
  supplierCode: string;
  pdfDocumentId: string | null;
}

interface Link {
  sheetId: string;
  invoiceNumber: string;
  deliveryDate: string;
  supplierCode: string;
  documentId: string;
  fileName: string;
  fileUrl: string;
}

type Uitkomst =
  | { soort: "ok" }
  | { soort: "onleesbaar" }
  | { soort: "verplaatsen"; naar: Sheet; pdfDatum: string }
  | { soort: "losmaken"; pdfDatum: string; reden: string };

(async () => {
  const sheets = (await sql`
    SELECT ss.id, ss."invoiceNumber", ss."ourInvoiceNumber",
           to_char(ss."deliveryDate", 'YYYY-MM-DD') AS "deliveryDate",
           ss."supplierId", ss."pdfDocumentId", s.code AS "supplierCode"
    FROM "SalesSheet" ss JOIN "Supplier" s ON s.id = ss."supplierId"`) as unknown as Sheet[];

  const links = (await sql`
    SELECT ss.id AS "sheetId", ss."invoiceNumber",
           to_char(ss."deliveryDate", 'YYYY-MM-DD') AS "deliveryDate",
           s.code AS "supplierCode", d.id AS "documentId", d."fileName", d."fileUrl"
    FROM "SalesSheet" ss
    JOIN "Document" d ON d.id = ss."pdfDocumentId"
    JOIN "Supplier" s ON s.id = ss."supplierId"
    ORDER BY s.code, ss."invoiceNumber"`) as unknown as Link[];

  // De host erbij, want dit script maakt koppelingen los en verwijdert blobs.
  // Zien op welke omgeving je zit hoort niet af te hangen van onthouden welk
  // env-bestand je had meegegeven.
  const host = url.match(/@([^/]+)\//)?.[1] ?? "onbekend";
  console.log(`Database uit ${ENV_FILE} (${host})`);
  console.log(`${sheets.length} salessheets, ${links.length} met een gekoppelde PDF`);
  console.log(APPLY ? "Modus: WEGSCHRIJVEN\n" : "Modus: alleen rapporteren (gebruik --apply om te herstellen)\n");

  const byId = new Map(sheets.map((s) => [s.id, s]));

  function zoekJuiste(
    references: (string | null)[],
    ourInvoiceNumber: string | null,
    supplierCode: string | null,
    pdfDatum: string
  ): Sheet[] {
    const kandidaten = new Map<string, Sheet>();
    for (const ref of [...new Set(references.filter((r): r is string => !!r))]) {
      const suffixed = new RegExp(`^${ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-\\d{5,}$`);
      for (const s of sheets) {
        if (s.invoiceNumber === ref || suffixed.test(s.invoiceNumber)) kandidaten.set(s.id, s);
      }
    }
    if (ourInvoiceNumber) {
      for (const s of sheets) if (s.ourInvoiceNumber === ourInvoiceNumber) kandidaten.set(s.id, s);
    }
    let lijst = [...kandidaten.values()];
    if (supplierCode) {
      const vanLev = lijst.filter((s) => s.supplierCode === supplierCode);
      if (vanLev.length > 0) lijst = vanLev;
    }
    let opDatum = lijst.filter((s) => s.deliveryDate === pdfDatum);
    // Bij een gedeelde leverdatum geeft ons eigen salessheetnummer de doorslag:
    // een salessheet die al een ander nummer draagt, hoort bij een andere PDF.
    if (opDatum.length > 1 && ourInvoiceNumber) {
      const exact = opDatum.filter((s) => s.ourInvoiceNumber === ourInvoiceNumber);
      const vrij = opDatum.filter((s) => !s.ourInvoiceNumber || s.ourInvoiceNumber === ourInvoiceNumber);
      if (exact.length === 1) opDatum = exact;
      else if (vrij.length === 1) opDatum = vrij;
    }
    return opDatum;
  }

  async function controleer(link: Link): Promise<Uitkomst> {
    let buffer: Buffer;
    try {
      const res = await fetch(link.fileUrl);
      if (!res.ok) return { soort: "onleesbaar" };
      buffer = Buffer.from(await res.arrayBuffer());
    } catch {
      return { soort: "onleesbaar" };
    }

    let pdfDatum: string | null = null;
    let pdfReference: string | null = null;
    let ourInvoiceNumber: string | null = null;
    try {
      const parsed = await parseSalesSheetPdf(buffer);
      pdfDatum = parsed.deliveryDate;
      pdfReference = parsed.reference;
      ourInvoiceNumber = parsed.ourInvoiceNumber;
    } catch {
      return { soort: "onleesbaar" };
    }
    if (!pdfDatum) return { soort: "onleesbaar" };
    if (pdfDatum === link.deliveryDate) return { soort: "ok" };

    const named = parseSalesSheetFilename(link.fileName);
    const fromName = named ?? parseSalesSheetFilenameSimple(link.fileName);
    const juiste = zoekJuiste(
      [fromName?.reference ?? null, pdfReference],
      fromName?.ourInvoiceNumber ?? ourInvoiceNumber,
      named?.supplierCode ?? null,
      pdfDatum
    );

    if (juiste.length !== 1) {
      return {
        soort: "losmaken",
        pdfDatum,
        reden: juiste.length === 0 ? "geen passende salessheet gevonden" : `${juiste.length} kandidaten met dezelfde leverdatum`,
      };
    }
    const doel = juiste[0];
    if (doel.pdfDocumentId && doel.pdfDocumentId !== link.documentId) {
      return { soort: "losmaken", pdfDatum, reden: `doelsalessheet ${doel.invoiceNumber} heeft al een PDF` };
    }
    return { soort: "verplaatsen", naar: doel, pdfDatum };
  }

  const telling = { ok: 0, onleesbaar: 0, verplaatst: 0, losgemaakt: 0 };
  const regels: string[] = [];

  for (let i = 0; i < links.length; i += PARALLEL) {
    const groep = links.slice(i, i + PARALLEL);
    const uitkomsten = await Promise.all(groep.map(controleer));

    for (let j = 0; j < groep.length; j++) {
      const link = groep[j];
      const u = uitkomsten[j];

      if (u.soort === "ok") { telling.ok++; continue; }
      if (u.soort === "onleesbaar") { telling.onleesbaar++; continue; }

      const kop = `${link.supplierCode} ${link.invoiceNumber} (${link.deliveryDate}) <- ${link.fileName}, PDF zegt ${u.pdfDatum}`;

      if (u.soort === "verplaatsen") {
        telling.verplaatst++;
        regels.push(`VERPLAATSEN  ${kop}\n             naar ${u.naar.supplierCode} ${u.naar.invoiceNumber} (${u.naar.deliveryDate})`);
        if (APPLY) {
          // De vier pdf*-velden gaan mee leeg: blijft `pdfNetResult` staan bij een
          // document dat hier zo meteen niet meer hangt, dan levert dat een
          // blijvende valse mismatch op — een signaal dat naar zichzelf wijst.
          await sql`UPDATE "SalesSheet" SET "pdfDocumentId" = NULL, "ourInvoiceNumber" = NULL, "pdfTurnover" = NULL, "pdfCosts" = NULL, "pdfNetResult" = NULL, "pdfParsedAt" = NULL WHERE id = ${link.sheetId}`;
          await sql`UPDATE "Document" SET "supplierId" = ${u.naar.supplierId}, name = ${"Sales Sheet " + u.naar.invoiceNumber} WHERE id = ${link.documentId}`;
          await sql`UPDATE "SalesSheet" SET "pdfDocumentId" = ${link.documentId} WHERE id = ${u.naar.id}`;
          byId.get(u.naar.id)!.pdfDocumentId = link.documentId;
        }
      } else {
        telling.losgemaakt++;
        regels.push(`LOSMAKEN     ${kop}\n             ${u.reden} — document wordt verwijderd`);
        if (APPLY) {
          // Het Document zelf moet ook weg. Het hangt via Document.supplierId aan
          // de verkeerde leverancier en blijft anders zichtbaar op diens
          // documentenpagina, ook zonder koppeling aan de salessheet.
          //
          // Ook hier gaan de vier pdf*-velden mee leeg: blijft een gelezen bedrag
          // achter bij een document dat er niet meer is, dan levert dat een
          // blijvende valse afwijking op — een signaal dat naar zichzelf wijst.
          await sql`UPDATE "SalesSheet" SET "pdfDocumentId" = NULL, "ourInvoiceNumber" = NULL, "pdfTurnover" = NULL, "pdfCosts" = NULL, "pdfNetResult" = NULL, "pdfParsedAt" = NULL WHERE id = ${link.sheetId}`;
          await sql`DELETE FROM "Document" WHERE id = ${link.documentId}`;
          try {
            await del(link.fileUrl);
          } catch {
            // Blob opruimen is niet kritiek; de verwijzing is al weg.
          }
        }
      }
    }

    if ((i + PARALLEL) % 120 < PARALLEL) console.log(`  ${Math.min(i + PARALLEL, links.length)}/${links.length} gecontroleerd`);
  }

  console.log("\n=== Uitkomst ===");
  console.log(`  koppeling klopt        : ${telling.ok}`);
  console.log(`  niet te controleren    : ${telling.onleesbaar}`);
  console.log(`  te verplaatsen         : ${telling.verplaatst}`);
  console.log(`  los te maken           : ${telling.losgemaakt}`);

  if (regels.length) {
    console.log(`\n=== Details (${regels.length}) ===`);
    regels.forEach((r) => console.log(r));
  }
  if (!APPLY && regels.length) {
    console.log("\nNiets weggeschreven. Draai opnieuw met --apply om te herstellen.");
  }
})();
