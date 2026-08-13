/**
 * Backfill script: parse CSV files from private_input/PBI/backfill/
 * and send them to the deployed test API in batches.
 *
 * Usage: npx tsx scripts/backfill.ts [--dry-run] [--only suppliers|lots|orders|costs|growers]
 *
 * Order of processing:
 *   1. supplier_all.csv  → POST /api/import/suppliers
 *   2. partij_2025.csv   → POST /api/import/lots
 *   3. partij_2026.csv   → POST /api/import/lots
 *   4. orders_2025.csv   → POST /api/import/orders
 *   5. orders_2026.csv   → POST /api/import/orders
 *   6. cost_2025.csv     → POST /api/import/costs
 *   7. cost_2026.csv     → POST /api/import/costs
 *   8. grower_all.csv    → POST /api/import/growers
 */

import { createReadStream } from "fs";
import { parse } from "csv-parse";
import path from "path";

const API_BASE = "https://growerportal.test.apps.coloriginz.com";
const API_KEY = "grp_import_2026_kX9mQ4wT7nR2vL8pF3jH6cY1dA5sE0bG";
const BATCH_SIZE = 10000;
const INPUT_DIR = path.resolve(__dirname, "../private_input/PBI/backfill");

// ---------------------------------------------------------------------------
// CSV parsing helpers
// ---------------------------------------------------------------------------

/** Parse Dutch comma-decimal ("3542,49") to number. Returns null for empty. */
function parseDecimal(val: string | undefined | null): number | null {
  if (val === undefined || val === null || val === "") return null;
  const cleaned = val.replace(",", ".");
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/** Parse integer string. Returns null for empty. */
function parseInt2(val: string | undefined | null): number | null {
  if (val === undefined || val === null || val === "") return null;
  const num = parseInt(val, 10);
  return isNaN(num) ? null : num;
}

/** Parse string, return null for empty */
function parseStr(val: string | undefined | null): string | null {
  if (val === undefined || val === null || val === "") return null;
  return val;
}

/** Read a CSV file and return all rows as objects */
async function readCsv(filePath: string): Promise<Record<string, string>[]> {
  const rows: Record<string, string>[] = [];
  return new Promise((resolve, reject) => {
    createReadStream(filePath)
      .pipe(
        parse({
          columns: true,
          skip_empty_lines: true,
          trim: true,
          relax_column_count: true,
        })
      )
      .on("data", (row: Record<string, string>) => rows.push(row))
      .on("end", () => resolve(rows))
      .on("error", reject);
  });
}

/**
 * Split records into batches, optionally keeping rows with the same groupKey
 * value together in the same batch to avoid partial deletes on the server.
 */
function splitIntoBatches(
  records: unknown[],
  batchSize: number,
  groupKey: string | null
): unknown[][] {
  if (!groupKey) {
    // Simple fixed-size batches
    const batches: unknown[][] = [];
    for (let i = 0; i < records.length; i += batchSize) {
      batches.push(records.slice(i, i + batchSize));
    }
    return batches;
  }

  // Group-aware batching: never split rows with the same groupKey across batches
  const batches: unknown[][] = [];
  let current: unknown[] = [];

  // Sort by groupKey so same-key rows are adjacent
  const sorted = [...records].sort((a, b) => {
    const aKey = (a as Record<string, unknown>)[groupKey];
    const bKey = (b as Record<string, unknown>)[groupKey];
    if (aKey == null && bKey == null) return 0;
    if (aKey == null) return -1;
    if (bKey == null) return 1;
    return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
  });

  let i = 0;
  while (i < sorted.length) {
    const keyValue = (sorted[i] as Record<string, unknown>)[groupKey];
    // Collect all rows with the same key
    let j = i;
    while (j < sorted.length && (sorted[j] as Record<string, unknown>)[groupKey] === keyValue) {
      j++;
    }
    const group = sorted.slice(i, j);

    // If adding this group would exceed batchSize and current is non-empty, flush
    if (current.length > 0 && current.length + group.length > batchSize) {
      batches.push(current);
      current = [];
    }

    current.push(...group);
    i = j;
  }

  if (current.length > 0) {
    batches.push(current);
  }

  return batches;
}

// ---------------------------------------------------------------------------
// Row transformers — CSV row → API JSON shape
// ---------------------------------------------------------------------------

function transformSupplier(row: Record<string, string>) {
  return {
    Code: row["Code"],
    Naam: row["Naam"],
    ID: parseInt2(row["ID"])!,
    "AM Naam": parseStr(row["AM Naam"]),
    "AM Code": parseStr(row["AM Code"]),
  };
}

function transformPartij(row: Record<string, string>) {
  return {
    part_id: parseInt2(row["part_id"])!,
    parthdr_id: parseInt2(row["parthdr_id"])!,
    rel_id_leverancier: parseInt2(row["rel_id_leverancier"])!,
    Partijnummer: parseInt2(row["Partijnummer"]) ?? row["Partijnummer"],
    "Inkoop Factuur Nummer": parseStr(row["Inkoop Factuur Nummer"]),
    "Lever Datum/Tijd": parseStr(row["Lever Datum/Tijd"]),
    "Artikel Naam": parseStr(row["Artikel Naam"]),
    "Artikel Code": parseStr(row["Artikel Code"]),
    "Inkooptype Code": parseStr(row["Inkooptype Code"]),
    S01: parseStr(row["S01"]),
    S02: parseStr(row["S02"]),
    S03: parseStr(row["S03"]),
    art_id: parseInt2(row["art_id"]),
    reden_id_correctie: parseInt2(row["reden_id_correctie"]),
    "Inkoopfactuur colli": parseInt2(row["Inkoopfactuur colli"]),
    "Inkoopfactuur volume": parseInt2(row["Inkoopfactuur volume"]),
    "Inslag aantal correctie": parseInt2(row["Inslag aantal correctie"]),
    "Facttype Sub": parseStr(row["Facttype Sub"]),
  };
}

function transformOrder(row: Record<string, string>) {
  return {
    ordreg_id: parseInt2(row["ordreg_id"]),
    part_id: parseInt2(row["part_id"])!,
    parthdr_id: parseInt2(row["parthdr_id"])!,
    rel_id_kweker: parseInt2(row["rel_id_kweker"])!,
    rel_id_leverancier: parseInt2(row["rel_id_leverancier"])!,
    _datum_key_vertrek: row["_datum_key_vertrek"],
    Verkooptype: parseStr(row["Verkooptype"]),
    Verkoopvolume: parseInt2(row["Verkoopvolume"]),
    Verkoop_colli: parseInt2(row["Verkoop_colli"]),
    Afrekenomzet: parseDecimal(row["Afrekenomzet"]),
    "Gem afrekenprijs": parseDecimal(row["Gem afrekenprijs"]),
    bron_feit_extra: parseStr(row["bron_feit_extra"]),
    reden_id: parseInt2(row["reden_id"]),
  };
}

function transformCost(row: Record<string, string>) {
  return {
    "Shkost ID": parseInt2(row["Shkost ID"])!,
    "Parthdr ID": parseInt2(row["Parthdr ID"])!,
    "Kost Naam": parseStr(row["Kost Naam"]),
    "Kost ID": parseInt2(row["Kost ID"]),
    "Kost Type Code": parseStr(row["Kost Type Code"]),
    "Kost Type Naam": parseStr(row["Kost Type Naam"]),
    "Totaal Omzet": parseDecimal(row["Totaal Omzet"]),
    "Totaal Aantal": parseInt2(row["Totaal Aantal"]),
    "Salesheet Amount": parseDecimal(row["Salesheet Amount"])!,
    "Laatste Ontvangstdatum": parseStr(row["Laatste Ontvangstdatum"]),
    "Laatste Aanmelddatum": parseStr(row["Laatste Aanmelddatum"]),
  };
}

function transformGrower(row: Record<string, string>) {
  return {
    Naam: row["Naam"],
    Code: row["Code"],
    ID: parseInt2(row["ID"])!,
    "Land Code": parseStr(row["Land Code"]),
    "Land Naam": parseStr(row["Land Naam"]),
    Plaats: parseStr(row["Plaats"]),
  };
}

// ---------------------------------------------------------------------------
// API caller
// ---------------------------------------------------------------------------

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

async function sendBatch(
  endpoint: string,
  bodyKey: string,
  records: unknown[],
  batchNum: number,
  totalBatches: number
): Promise<{ ok: boolean; status: number; body: string }> {
  const url = `${API_BASE}/api/import/${endpoint}`;
  const body = JSON.stringify({ [bodyKey]: records });

  console.log(
    `  [${batchNum}/${totalBatches}] Sending ${records.length} records to ${endpoint}...`
  );

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${API_KEY}`,
        },
        body,
      });

      const text = await res.text();
      return { ok: res.ok, status: res.status, body: text };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < MAX_RETRIES) {
        console.log(
          `  [${batchNum}/${totalBatches}] Network error (attempt ${attempt}/${MAX_RETRIES}): ${msg} — retrying in ${RETRY_DELAY_MS / 1000}s...`
        );
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      } else {
        return { ok: false, status: 0, body: `Network error after ${MAX_RETRIES} attempts: ${msg}` };
      }
    }
  }

  return { ok: false, status: 0, body: "Unexpected retry loop exit" };
}

// ---------------------------------------------------------------------------
// Process a single file
// ---------------------------------------------------------------------------

interface FileConfig {
  file: string;
  endpoint: string;
  bodyKey: string;
  transform: (row: Record<string, string>) => unknown;
}

async function processFile(config: FileConfig, dryRun: boolean) {
  const filePath = path.join(INPUT_DIR, config.file);
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Processing: ${config.file} → /api/import/${config.endpoint}`);
  console.log(`${"=".repeat(60)}`);

  const rows = await readCsv(filePath);
  console.log(`  Parsed ${rows.length} rows from CSV`);

  // Transform all rows
  const transformed = rows.map(config.transform);

  // Filter out rows with null required fields (e.g. missing IDs)
  const valid = transformed.filter((r) => {
    const rec = r as Record<string, unknown>;
    // For orders: part_id, rel_id_kweker, rel_id_leverancier are required
    // For lots: part_id, parthdr_id, rel_id_leverancier are required
    // For costs: Shkost ID, Parthdr ID, Salesheet Amount are required
    // For suppliers/growers: ID is required
    if (config.endpoint === "orders") {
      return rec.part_id != null && rec.rel_id_kweker != null && rec.rel_id_leverancier != null;
    }
    if (config.endpoint === "lots") {
      return rec.part_id != null && rec.parthdr_id != null && rec.rel_id_leverancier != null;
    }
    if (config.endpoint === "costs") {
      return rec["Shkost ID"] != null && rec["Parthdr ID"] != null && rec["Salesheet Amount"] != null;
    }
    return true;
  });

  if (valid.length < transformed.length) {
    console.log(`  Filtered: ${transformed.length - valid.length} rows with missing required fields`);
  }

  if (dryRun) {
    console.log(`  [DRY RUN] Would send ${valid.length} records in ${Math.ceil(valid.length / BATCH_SIZE)} batch(es)`);
    console.log(`  Sample record:`, JSON.stringify(valid[0], null, 2));
    return;
  }

  // Split into batches — for lots and orders, keep rows with the same part_id together
  // (orders use delete+reinsert per lot, so splitting a lot across batches causes data loss)
  const groupKey = (config.endpoint === "lots" || config.endpoint === "orders") ? "part_id" : null;
  const batches = splitIntoBatches(valid, BATCH_SIZE, groupKey);
  const totalBatches = batches.length;
  let totalCreated = 0;
  let totalUpdated = 0;
  let totalErrors = 0;

  for (let batchNum = 1; batchNum <= totalBatches; batchNum++) {
    const batch = batches[batchNum - 1];

    const result = await sendBatch(
      config.endpoint,
      config.bodyKey,
      batch,
      batchNum,
      totalBatches
    );

    if (result.ok) {
      try {
        const json = JSON.parse(result.body);
        // Different endpoints return different shapes — log the full summary
        const summary = Object.entries(json)
          .filter(([k]) => k !== "errors" && k !== "details")
          .map(([k, v]) => {
            if (typeof v === "object" && v !== null) {
              return `${k}: ${JSON.stringify(v)}`;
            }
            return `${k}: ${v}`;
          })
          .join(", ");
        console.log(`  [${batchNum}/${totalBatches}] OK — ${summary}`);
      } catch {
        console.log(`  [${batchNum}/${totalBatches}] OK — ${result.body.substring(0, 200)}`);
      }
    } else {
      totalErrors++;
      console.error(
        `  [${batchNum}/${totalBatches}] FAILED (${result.status}) — ${result.body.substring(0, 500)}`
      );
      // Don't abort on error — continue with next batch
    }
  }

  console.log(
    `\n  TOTALS for ${config.file}: created=${totalCreated}, updated=${totalUpdated}, errors=${totalErrors}`
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const FILES: FileConfig[] = [
  {
    file: "supplier_all.csv",
    endpoint: "suppliers",
    bodyKey: "suppliers",
    transform: transformSupplier,
  },
  {
    file: "partij_2025.csv",
    endpoint: "lots",
    bodyKey: "partijen",
    transform: transformPartij,
  },
  {
    file: "partij_2026.csv",
    endpoint: "lots",
    bodyKey: "partijen",
    transform: transformPartij,
  },
  {
    file: "orders_2025 NIEUW incl bronfeit en reden.csv",
    endpoint: "orders",
    bodyKey: "orders",
    transform: transformOrder,
  },
  {
    file: "orders_2026 NIEUW incl bronfeit en reden.csv",
    endpoint: "orders",
    bodyKey: "orders",
    transform: transformOrder,
  },
  {
    file: "cost_2025.csv",
    endpoint: "costs",
    bodyKey: "costs",
    transform: transformCost,
  },
  {
    file: "cost_2026.csv",
    endpoint: "costs",
    bodyKey: "costs",
    transform: transformCost,
  },
  {
    file: "grower_all.csv",
    endpoint: "growers",
    bodyKey: "growers",
    transform: transformGrower,
  },
];

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const onlyIndex = args.indexOf("--only");
  const onlyFilter = onlyIndex >= 0 ? args[onlyIndex + 1] : null;

  console.log(`Backfill script — API: ${API_BASE}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  if (dryRun) console.log("MODE: DRY RUN (no API calls)");
  if (onlyFilter) console.log(`FILTER: only ${onlyFilter}`);
  console.log();

  const filesToProcess = onlyFilter
    ? FILES.filter((f) => f.endpoint === onlyFilter)
    : FILES;

  if (filesToProcess.length === 0) {
    console.error(`No files match filter: ${onlyFilter}`);
    console.error(`Valid options: suppliers, lots, orders, costs, growers`);
    process.exit(1);
  }

  const startTime = Date.now();

  for (const config of filesToProcess) {
    await processFile(config, dryRun);
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Backfill complete in ${totalTime}s`);
  console.log(`${"=".repeat(60)}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
