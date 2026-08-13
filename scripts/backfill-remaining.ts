/**
 * Backfill only orders_2026.csv and grower_all.csv
 * (orders_2025, lots, suppliers, costs already done)
 */

import "dotenv/config";
import { createReadStream } from "fs";
import { parse } from "csv-parse";
import path from "path";

const API_BASE = "https://growerportal.test.apps.coloriginz.com";
const API_KEY = process.env.IMPORT_API_KEY;

if (!API_KEY) throw new Error("IMPORT_API_KEY ontbreekt — zet hem in .env");
const BATCH_SIZE = 5000;
const INPUT_DIR = path.resolve(__dirname, "../private_input/PBI/backfill");

function parseDecimal(val: string | undefined | null): number | null {
  if (val === undefined || val === null || val === "") return null;
  const num = parseFloat(val.replace(",", "."));
  return isNaN(num) ? null : num;
}

function parseInt2(val: string | undefined | null): number | null {
  if (val === undefined || val === null || val === "") return null;
  const num = parseInt(val, 10);
  return isNaN(num) ? null : num;
}

function parseStr(val: string | undefined | null): string | null {
  if (val === undefined || val === null || val === "") return null;
  return val;
}

async function readCsv(filePath: string): Promise<Record<string, string>[]> {
  const rows: Record<string, string>[] = [];
  return new Promise((resolve, reject) => {
    createReadStream(filePath)
      .pipe(parse({ columns: true, skip_empty_lines: true, trim: true, relax_column_count: true }))
      .on("data", (row: Record<string, string>) => rows.push(row))
      .on("end", () => resolve(rows))
      .on("error", reject);
  });
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

async function sendBatch(
  endpoint: string, bodyKey: string, records: unknown[], batchNum: number, totalBatches: number
): Promise<{ ok: boolean; status: number; body: string }> {
  const url = `${API_BASE}/api/import/${endpoint}`;
  const body = JSON.stringify({ [bodyKey]: records });

  console.log(`  [${batchNum}/${totalBatches}] Sending ${records.length} records to ${endpoint}...`);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
        body,
      });
      const text = await res.text();
      return { ok: res.ok, status: res.status, body: text };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < MAX_RETRIES) {
        console.log(`  [${batchNum}/${totalBatches}] Network error (attempt ${attempt}/${MAX_RETRIES}): ${msg} — retrying in ${RETRY_DELAY_MS / 1000}s...`);
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      } else {
        return { ok: false, status: 0, body: `Network error after ${MAX_RETRIES} attempts: ${msg}` };
      }
    }
  }
  return { ok: false, status: 0, body: "Unexpected retry loop exit" };
}

async function processFile(
  file: string, endpoint: string, bodyKey: string,
  transform: (row: Record<string, string>) => unknown,
  filter?: (rec: Record<string, unknown>) => boolean
) {
  const filePath = path.join(INPUT_DIR, file);
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Processing: ${file} → /api/import/${endpoint}`);
  console.log(`${"=".repeat(60)}`);

  const rows = await readCsv(filePath);
  console.log(`  Parsed ${rows.length} rows from CSV`);

  const transformed = rows.map(transform);
  const valid = filter ? transformed.filter((r) => filter(r as Record<string, unknown>)) : transformed;

  if (valid.length < transformed.length) {
    console.log(`  Filtered: ${transformed.length - valid.length} rows with missing required fields`);
  }

  const totalBatches = Math.ceil(valid.length / BATCH_SIZE);
  let totalErrors = 0;

  for (let i = 0; i < valid.length; i += BATCH_SIZE) {
    const batch = valid.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const result = await sendBatch(endpoint, bodyKey, batch, batchNum, totalBatches);

    if (result.ok) {
      try {
        const json = JSON.parse(result.body);
        const summary = Object.entries(json)
          .filter(([k]) => k !== "errors" && k !== "details")
          .map(([k, v]) => typeof v === "object" && v !== null ? `${k}: ${JSON.stringify(v)}` : `${k}: ${v}`)
          .join(", ");
        console.log(`  [${batchNum}/${totalBatches}] OK — ${summary}`);
      } catch {
        console.log(`  [${batchNum}/${totalBatches}] OK — ${result.body.substring(0, 200)}`);
      }
    } else {
      totalErrors++;
      console.error(`  [${batchNum}/${totalBatches}] FAILED (${result.status}) — ${result.body.substring(0, 500)}`);
    }
  }

  console.log(`\n  Done: ${file} — ${totalBatches} batches, ${totalErrors} errors`);
}

async function main() {
  const startTime = Date.now();

  // 1. Orders 2026
  await processFile(
    "orders_2026.csv", "orders", "orders",
    (row) => ({
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
    }),
    (rec) => rec.part_id != null && rec.rel_id_kweker != null && rec.rel_id_leverancier != null
  );

  // 2. Growers
  await processFile(
    "grower_all.csv", "growers", "growers",
    (row) => ({
      Naam: row["Naam"],
      Code: row["Code"],
      ID: parseInt2(row["ID"])!,
      "Land Code": parseStr(row["Land Code"]),
      "Land Naam": parseStr(row["Land Naam"]),
      Plaats: parseStr(row["Plaats"]),
    })
  );

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Backfill complete in ${totalTime}s`);
  console.log(`${"=".repeat(60)}`);
}

main().catch((err) => { console.error("Fatal error:", err); process.exit(1); });
