/**
 * Backfill orders from updated CSV.
 * Uses larger batch size (10000) for fewer HTTP roundtrips.
 * Run: node scripts/backfill-orders-2026.js
 */
require("dotenv").config();
const { createReadStream } = require("fs");
const { parse } = require("csv-parse");
const path = require("path");

const API_BASE = "https://growerportal.test.apps.coloriginz.com";
const API_KEY = process.env.IMPORT_API_KEY;

if (!API_KEY) throw new Error("IMPORT_API_KEY ontbreekt — zet hem in .env");
const BATCH_SIZE = 10000;
const INPUT_FILE = path.resolve(__dirname, "../private_input/PBI/backfill/orders_2026 NIEUW incl bronfeit en reden.csv");

function parseDecimal(val) {
  if (val === undefined || val === null || val === "") return null;
  const num = parseFloat(val.replace(",", "."));
  return isNaN(num) ? null : num;
}

function parseInt2(val) {
  if (val === undefined || val === null || val === "") return null;
  const num = parseInt(val, 10);
  return isNaN(num) ? null : num;
}

async function readCsv(filePath) {
  const rows = [];
  return new Promise((resolve, reject) => {
    createReadStream(filePath)
      .pipe(parse({ columns: true, skip_empty_lines: true, trim: true, relax_column_count: true }))
      .on("data", (row) => rows.push(row))
      .on("end", () => resolve(rows))
      .on("error", reject);
  });
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

async function sendBatch(records, batchNum, totalBatches) {
  const url = `${API_BASE}/api/import/orders`;
  const body = JSON.stringify({ orders: records });

  console.log(`  [${batchNum}/${totalBatches}] Sending ${records.length} records (${(body.length / 1024).toFixed(0)} KB)...`);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
        body,
      });
      const text = await res.text();
      if (res.ok) {
        try {
          const json = JSON.parse(text);
          console.log(`  [${batchNum}/${totalBatches}] OK — received=${json.received} txCreated=${json.transactions?.created} txDeleted=${json.transactions?.deleted} skipped=${json.transactions?.skipped} (${json.received > 0 ? ((Date.now()) + "ms") : ""})`);
        } catch {
          console.log(`  [${batchNum}/${totalBatches}] OK — ${text.substring(0, 200)}`);
        }
        return { ok: true };
      } else {
        console.error(`  [${batchNum}/${totalBatches}] FAILED (${res.status}) — ${text.substring(0, 500)}`);
        if (attempt < MAX_RETRIES) {
          console.log(`  Retrying in ${RETRY_DELAY_MS / 1000}s...`);
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [${batchNum}/${totalBatches}] Network error (attempt ${attempt}): ${msg}`);
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    }
  }
  return { ok: false };
}

async function main() {
  const startTime = Date.now();
  console.log(`Reading CSV: ${INPUT_FILE}`);

  const rows = await readCsv(INPUT_FILE);
  console.log(`Parsed ${rows.length} rows`);

  // Transform to API format
  const records = rows.map((row) => ({
    ordreg_id: parseInt2(row.ordreg_id),
    part_id: parseInt2(row.part_id),
    parthdr_id: parseInt2(row.parthdr_id),
    rel_id_kweker: parseInt2(row.rel_id_kweker),
    rel_id_leverancier: parseInt2(row.rel_id_leverancier),
    _datum_key_vertrek: row._datum_key_vertrek,
    Verkooptype: row.Verkooptype || null,
    Verkoopvolume: parseInt2(row.Verkoopvolume),
    Verkoop_colli: parseInt2(row.Verkoop_colli),
    Afrekenomzet: parseDecimal(row.Afrekenomzet),
    "Gem afrekenprijs": parseDecimal(row["Gem afrekenprijs"]),
    bron_feit_extra: row.bron_feit_extra || null,
    reden_id: parseInt2(row.reden_id),
  })).filter((r) => r.part_id != null && r.rel_id_kweker != null && r.rel_id_leverancier != null);

  console.log(`Valid records: ${records.length}`);

  const totalBatches = Math.ceil(records.length / BATCH_SIZE);
  let errors = 0;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const result = await sendBatch(batch, batchNum, totalBatches);
    if (!result.ok) errors++;
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nDone in ${totalTime}s — ${totalBatches} batches, ${errors} errors`);
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
