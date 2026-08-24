/*
 * Koppelt de salessheet-PDF's uit een lokale map aan afrekeningen die nog geen
 * PDF hebben, door ze in porties naar POST /api/shipments/import-email te
 * sturen — dezelfde route als de e-mailstroom. Dat is bewust: de datumcontrole
 * en het aanmaken van het Document horen op één plek te staan, anders krijg je
 * twee waarheden over wat een geldige koppeling is.
 *
 * Draaien:
 *   npx tsx scripts/link-salessheet-pdfs.ts                    # dry run (standaard)
 *   npx tsx scripts/link-salessheet-pdfs.ts --apply            # echt versturen
 *   npx tsx scripts/link-salessheet-pdfs.ts <map> --apply
 *   npx tsx scripts/link-salessheet-pdfs.ts --limit=20 --apply # eerst een proefje
 *
 * Opties:
 *   <map>            wortelmap met PDF's, recursief. Standaard private_input/salessheets.
 *   --apply          verstuur echt. Zonder deze vlag wordt er niets geschreven.
 *   --limit=N        stuur hooguit N bestanden (proefrun).
 *   --api-base=URL   doelportal. Standaard $API_BASE, anders de testomgeving.
 *   --batch-bytes=N  maximum aan base64 per verzoek. Standaard 3000000.
 *   --report=PAD     schrijf het rapport hierheen in plaats van de standaardnaam.
 *
 * Herhaalbaar: het script kijkt eerst welke afrekeningen nog geen PDF hebben en
 * verstuurt alleen bestanden die daarop aansluiten. Draait hij een tweede keer,
 * dan is er niets meer te doen; breekt hij halverwege af, dan pakt hij bij de
 * volgende run precies de rest op. Na een volledige flush van de datatabellen
 * staat alles weer op nul en koppelt hij de hele map opnieuw.
 *
 * De database gaat via de Neon HTTP-driver; Prisma over TCP 5432 komt niet door
 * het werknetwerk heen. Er komen bewust geen datums over die verbinding: de
 * HTTP-driver leest een timestamp als lokale tijd en Prisma als UTC, en dat
 * verschil zou hier een verkeerd oordeel opleveren. Het vergelijken van
 * leverdatums gebeurt in de importroute, aan de Prisma-kant.
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import { neon } from "@neondatabase/serverless";
import {
  parseSalesSheetFilename,
  parseSalesSheetFilenameSimple,
  parseSalesSheetFilenameLoose,
} from "../src/lib/salessheet-filename-parser";

// ---------------------------------------------------------------------------
// Instellingen
// ---------------------------------------------------------------------------

/*
 * Vercel kapt een request body af rond 4,5 MB en base64 maakt een bestand een
 * derde groter, dus 3 MB base64 (~2,2 MB aan PDF) houdt ruime marge voor de
 * JSON-omhulling. Het aantal bestanden per verzoek is apart begrensd omdat de
 * route per bijlage een PDF parseert en naar de blob-opslag uploadt; dertig
 * kleine bestanden in één verzoek halen de maxDuration van 300s niet.
 */
const DEFAULT_MAX_BASE64_BYTES = 3_000_000;
const MAX_FILES_PER_REQUEST = 20;

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

const DEFAULT_ROOT = path.resolve(__dirname, "../private_input/salessheets");
const DEFAULT_API_BASE = "https://growerportal.test.apps.coloriginz.com";

// ---------------------------------------------------------------------------
// Argumenten
// ---------------------------------------------------------------------------

interface Options {
  root: string;
  apply: boolean;
  limit: number;
  apiBase: string;
  maxBase64Bytes: number;
  reportPath: string | null;
}

function parseArgs(argv: string[]): Options {
  const flags = argv.filter((a) => a.startsWith("--"));
  const positional = argv.filter((a) => !a.startsWith("--"));

  const value = (name: string): string | null => {
    const hit = flags.find((f) => f.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };

  const limitRaw = value("limit");
  const bytesRaw = value("batch-bytes");

  return {
    root: path.resolve(positional[0] ?? DEFAULT_ROOT),
    apply: flags.includes("--apply"),
    limit: limitRaw ? Number(limitRaw) : Infinity,
    apiBase: (value("api-base") ?? process.env.API_BASE ?? DEFAULT_API_BASE).replace(/\/+$/, ""),
    maxBase64Bytes: bytesRaw ? Number(bytesRaw) : DEFAULT_MAX_BASE64_BYTES,
    reportPath: value("report"),
  };
}

// ---------------------------------------------------------------------------
// Bestanden verzamelen en namen lezen
// ---------------------------------------------------------------------------

interface PdfFile {
  absolutePath: string;
  /** Pad ten opzichte van de wortelmap — dat is wat in het rapport leesbaar is. */
  relativePath: string;
  fileName: string;
  bytes: number;
}

function collectPdfs(dir: string, root: string, out: PdfFile[] = []): PdfFile[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) collectPdfs(p, root, out);
    else if (/\.pdf$/i.test(entry.name)) {
      out.push({
        absolutePath: p,
        relativePath: path.relative(root, p),
        fileName: entry.name,
        bytes: fs.statSync(p).size,
      });
    }
  }
  return out;
}

/** Dezelfde volgorde als de importroute: eerst rijk, dan simpel, dan ruim. */
function readName(fileName: string): { reference: string; ourInvoiceNumber: string } | null {
  const rich = parseSalesSheetFilename(fileName);
  if (rich) return { reference: rich.reference, ourInvoiceNumber: rich.ourInvoiceNumber };
  return parseSalesSheetFilenameSimple(fileName) ?? parseSalesSheetFilenameLoose(fileName);
}

// ---------------------------------------------------------------------------
// Database: wat is er nog vrij?
// ---------------------------------------------------------------------------

interface PortalState {
  /** Bestandsnamen die al als PDF aan een afrekening hangen, in kleine letters. */
  linkedFileNames: Set<string>;
  /** Referenties met minstens één afrekening zonder PDF. */
  freeReferences: Set<string>;
  /** Eigen factuurnummers van afrekeningen zonder PDF. */
  freeOurInvoiceNumbers: Set<string>;
  totalSheets: number;
  sheetsWithoutPdf: number;
}

async function readPortalState(): Promise<PortalState> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL ontbreekt — zet hem in .env");
  const sql = neon(url);

  const linkedRows = (await sql`
    SELECT DISTINCT d."fileName" AS name
    FROM "SalesSheet" s
    JOIN "Document" d ON d.id = s."pdfDocumentId"
  `) as { name: string | null }[];

  const freeRows = (await sql`
    SELECT "invoiceNumber", "ourInvoiceNumber"
    FROM "SalesSheet"
    WHERE "pdfDocumentId" IS NULL
  `) as { invoiceNumber: string; ourInvoiceNumber: string | null }[];

  const totalRows = (await sql`SELECT count(*)::int AS c FROM "SalesSheet"`) as { c: number }[];

  const freeReferences = new Set<string>();
  const freeOurInvoiceNumbers = new Set<string>();
  for (const row of freeRows) {
    freeReferences.add(row.invoiceNumber);
    // Afrekeningnummers hergebruiken per jaar, dus de lots-import hangt er een
    // "-<parthdrId>" achter (zie api/import/lots). Referentie "95" moet ook
    // "95-2254938" kunnen vinden, precies zoals findCandidates in de route doet.
    const suffixed = row.invoiceNumber.match(/^(.*)-\d{5,}$/);
    if (suffixed) freeReferences.add(suffixed[1]);
    if (row.ourInvoiceNumber) freeOurInvoiceNumbers.add(row.ourInvoiceNumber);
  }

  return {
    linkedFileNames: new Set(
      linkedRows.filter((r) => r.name).map((r) => (r.name as string).toLowerCase())
    ),
    freeReferences,
    freeOurInvoiceNumbers,
    totalSheets: totalRows[0].c,
    sheetsWithoutPdf: freeRows.length,
  };
}

// ---------------------------------------------------------------------------
// Indelen
// ---------------------------------------------------------------------------

type Verdict =
  | "to_send"
  | "already_linked"
  | "no_free_sales_sheet"
  | "unreadable_name"
  | "duplicate_file_name";

interface Candidate extends PdfFile {
  reference: string | null;
  ourInvoiceNumber: string | null;
  verdict: Verdict;
  /** Uitkomst van het versturen; blijft leeg in een dry run. */
  result?: string;
  detail?: string;
}

function classify(files: PdfFile[], state: PortalState): Candidate[] {
  const seen = new Set<string>();
  return files.map((file) => {
    const key = file.fileName.toLowerCase();
    const base = { ...file, reference: null, ourInvoiceNumber: null };

    // Twee bestanden met dezelfde naam kunnen we in het antwoord van de route
    // niet uit elkaar houden, want dat rapporteert per fileName. Nu komt dat in
    // deze map niet voor, maar dat is geen reden om de tweede stil te verliezen.
    if (seen.has(key)) return { ...base, verdict: "duplicate_file_name" as const };
    seen.add(key);

    const parsed = readName(file.fileName);
    if (!parsed) return { ...base, verdict: "unreadable_name" as const };

    const named = {
      ...base,
      reference: parsed.reference,
      ourInvoiceNumber: parsed.ourInvoiceNumber,
    };

    // Deze PDF hangt al ergens aan. Alleen op de referentie kijken is hier niet
    // genoeg: bij een hergebruikt nummer als "13" staan er nog vijf vrije
    // afrekeningen naast, en dan zou dit bestand elke run opnieuw meegaan.
    if (state.linkedFileNames.has(key)) return { ...named, verdict: "already_linked" as const };

    const free =
      state.freeReferences.has(parsed.reference) ||
      state.freeOurInvoiceNumbers.has(parsed.ourInvoiceNumber);

    return { ...named, verdict: free ? ("to_send" as const) : ("no_free_sales_sheet" as const) };
  });
}

// ---------------------------------------------------------------------------
// Porties
// ---------------------------------------------------------------------------

/** Lengte van de base64-tekst van een bestand van n bytes. */
function base64Length(bytes: number): number {
  return Math.ceil(bytes / 3) * 4;
}

/**
 * Deelt de te versturen bestanden in porties op grootte. Een bestand dat in zijn
 * eentje al over de grens gaat krijgt een eigen portie: liever één verzoek dat
 * de server misschien weigert dan een bestand dat stilzwijgend wegvalt.
 */
function buildBatches(files: Candidate[], maxBase64Bytes: number): Candidate[][] {
  const batches: Candidate[][] = [];
  let current: Candidate[] = [];
  let currentBytes = 0;

  for (const file of files) {
    const encoded = base64Length(file.bytes);
    const tooBig = current.length > 0 && currentBytes + encoded > maxBase64Bytes;
    const tooMany = current.length >= MAX_FILES_PER_REQUEST;
    if (tooBig || tooMany) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(file);
    currentBytes += encoded;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

// ---------------------------------------------------------------------------
// Versturen
// ---------------------------------------------------------------------------

interface RouteResponse {
  ingestionId?: string;
  processed?: { fileName: string; invoiceNumber: string; supplierCode: string }[];
  skipped?: { fileName: string; reason: string }[];
  error?: string;
}

/** Bouwt de body die de route verwacht: dezelfde vorm als een Outlook-mail. */
function buildBody(batch: Candidate[]): string {
  return JSON.stringify({
    subject: `Bulk link of ${batch.length} sales sheet PDF(s)`,
    from: "bulk-link@coloriginz.com",
    receivedDateTime: new Date().toISOString(),
    attachments: batch.map((file) => {
      const buffer = fs.readFileSync(file.absolutePath);
      return {
        name: file.fileName,
        contentType: "application/pdf",
        contentBytes: buffer.toString("base64"),
        size: buffer.length,
        isInline: false,
      };
    }),
  });
}

async function sendBatch(
  batch: Candidate[],
  options: Options
): Promise<{ ok: boolean; status: number; body: RouteResponse | string }> {
  const apiKey = process.env.IMPORT_API_KEY;
  if (!apiKey) throw new Error("IMPORT_API_KEY ontbreekt — zet hem in .env");

  const body = buildBody(batch);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${options.apiBase}/api/shipments/import-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body,
      });
      const text = await res.text();
      try {
        return { ok: res.ok, status: res.status, body: JSON.parse(text) as RouteResponse };
      } catch {
        return { ok: res.ok, status: res.status, body: text };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (attempt === MAX_RETRIES) {
        return { ok: false, status: 0, body: `network error after ${MAX_RETRIES} attempts: ${message}` };
      }
      console.log(`    network error (attempt ${attempt}/${MAX_RETRIES}): ${message} — retrying`);
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
  }
  return { ok: false, status: 0, body: "unexpected retry loop exit" };
}

/** Schrijft de uitkomst van één verzoek terug op de bestanden in die portie. */
function recordBatchResult(
  batch: Candidate[],
  result: { ok: boolean; status: number; body: RouteResponse | string }
): { linked: number; skipped: number; failed: number } {
  const counts = { linked: 0, skipped: 0, failed: 0 };

  if (!result.ok || typeof result.body === "string") {
    const detail =
      typeof result.body === "string" ? result.body.slice(0, 300) : (result.body.error ?? "unknown");
    for (const file of batch) {
      file.result = "failed";
      file.detail = `HTTP ${result.status}: ${detail}`;
      counts.failed++;
    }
    return counts;
  }

  const processed = new Map((result.body.processed ?? []).map((p) => [p.fileName, p]));
  const skipped = new Map((result.body.skipped ?? []).map((s) => [s.fileName, s]));

  for (const file of batch) {
    const hit = processed.get(file.fileName);
    if (hit) {
      file.result = "linked";
      file.detail = `${hit.supplierCode} / ${hit.invoiceNumber}`;
      counts.linked++;
      continue;
    }
    const miss = skipped.get(file.fileName);
    if (miss) {
      file.result = "skipped";
      file.detail = miss.reason;
      counts.skipped++;
      continue;
    }
    // De route noemt elk bestand in processed of skipped; komt er toch niets
    // terug, dan is er iets mis met het antwoord en niet met het bestand.
    file.result = "failed";
    file.detail = "not reported by the API";
    counts.failed++;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Rapport
// ---------------------------------------------------------------------------

function defaultReportPath(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return path.resolve(__dirname, `../private_input/link-salessheet-pdfs-${stamp}.json`);
}

function tally<T extends string>(values: (T | undefined)[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const key = value ?? "not_sent";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();

  console.log("Link sales sheet PDFs");
  console.log(`  folder    : ${options.root}`);
  console.log(`  target    : ${options.apiBase}`);
  console.log(`  mode      : ${options.apply ? "APPLY (writes to the portal and to blob storage)" : "DRY RUN (nothing is written)"}`);
  console.log(`  batch cap : ${options.maxBase64Bytes.toLocaleString("en-US")} base64 bytes, max ${MAX_FILES_PER_REQUEST} files`);
  if (options.limit !== Infinity) console.log(`  limit     : ${options.limit} file(s)`);
  console.log();

  if (!fs.existsSync(options.root)) {
    console.error(`Folder not found: ${options.root}`);
    process.exit(1);
  }

  const files = collectPdfs(options.root, options.root);
  console.log(`Found ${files.length} PDF file(s).`);

  const state = await readPortalState();
  console.log(
    `Portal: ${state.totalSheets} sales sheet(s), ${state.sheetsWithoutPdf} without a PDF, ` +
      `${state.linkedFileNames.size} file name(s) already attached.`
  );

  const classified = classify(files, state);
  const verdicts = tally(classified.map((c) => c.verdict));
  console.log();
  console.log("Classification:");
  for (const [verdict, count] of Object.entries(verdicts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${verdict.padEnd(22)} ${String(count).padStart(6)}`);
  }

  let toSend = classified.filter((c) => c.verdict === "to_send");
  if (options.limit !== Infinity) toSend = toSend.slice(0, options.limit);

  const batches = buildBatches(toSend, options.maxBase64Bytes);
  const totalBytes = toSend.reduce((sum, f) => sum + f.bytes, 0);
  console.log();
  console.log(
    `To send: ${toSend.length} file(s), ${(totalBytes / 1024 / 1024).toFixed(1)} MB raw ` +
      `(${(base64Length(totalBytes) / 1024 / 1024).toFixed(1)} MB base64) in ${batches.length} request(s).`
  );
  if (batches.length > 0) {
    // De schatting hierboven telt alleen de base64. De echte body draagt ook de
    // JSON-omhulling; die wordt hier één keer gemeten op de zwaarste portie, want
    // een limiet die pas bij verzoek 80 blijkt te knellen is een dure limiet.
    const sizes = batches.map((b) => base64Length(b.reduce((s, f) => s + f.bytes, 0)));
    const heaviest = batches[sizes.indexOf(Math.max(...sizes))];
    const measured = Buffer.byteLength(buildBody(heaviest), "utf8");
    console.log(
      `Largest request: ${Math.max(...sizes).toLocaleString("en-US")} base64 bytes over ` +
        `${heaviest.length} file(s); measured body ${measured.toLocaleString("en-US")} bytes ` +
        `(${((measured / 4_500_000) * 100).toFixed(0)}% of the 4.5 MB Vercel limit).`
    );
  }

  const totals = { linked: 0, skipped: 0, failed: 0 };

  if (options.apply && batches.length > 0) {
    console.log();
    let done = 0;
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const bytes = base64Length(batch.reduce((s, f) => s + f.bytes, 0));
      const result = await sendBatch(batch, options);
      const counts = recordBatchResult(batch, result);
      totals.linked += counts.linked;
      totals.skipped += counts.skipped;
      totals.failed += counts.failed;
      done += batch.length;

      const elapsed = (Date.now() - startedAt) / 1000;
      const eta = done > 0 ? ((elapsed / done) * (toSend.length - done)).toFixed(0) : "?";
      console.log(
        `  [${String(i + 1).padStart(3)}/${batches.length}] ${String(batch.length).padStart(2)} file(s), ` +
          `${(bytes / 1024 / 1024).toFixed(2)} MB — linked ${counts.linked}, skipped ${counts.skipped}, ` +
          `failed ${counts.failed} — ${done}/${toSend.length} done, ~${eta}s left`
      );
    }
  } else if (!options.apply) {
    console.log();
    console.log("Dry run: no request was sent. Re-run with --apply to link.");
    for (const sample of toSend.slice(0, 5)) {
      console.log(`  would send ${sample.relativePath} (reference ${sample.reference})`);
    }
  }

  const reportPath = options.reportPath ? path.resolve(options.reportPath) : defaultReportPath();
  const report = {
    generatedAt: new Date().toISOString(),
    mode: options.apply ? "apply" : "dry-run",
    root: options.root,
    apiBase: options.apiBase,
    portal: {
      salesSheets: state.totalSheets,
      salesSheetsWithoutPdf: state.sheetsWithoutPdf,
      fileNamesAlreadyAttached: state.linkedFileNames.size,
    },
    totals: {
      files: classified.length,
      byVerdict: verdicts,
      selected: toSend.length,
      requests: batches.length,
      rawBytes: totalBytes,
      byResult: options.apply ? totals : null,
    },
    files: classified.map((c) => ({
      file: c.relativePath,
      bytes: c.bytes,
      reference: c.reference,
      ourInvoiceNumber: c.ourInvoiceNumber,
      verdict: c.verdict,
      result: c.result ?? null,
      detail: c.detail ?? null,
    })),
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log();
  if (options.apply) {
    console.log(`Result: linked ${totals.linked}, skipped ${totals.skipped}, failed ${totals.failed}.`);
  }
  console.log(`Report written to ${reportPath}`);
  console.log(`Done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s.`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
