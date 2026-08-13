const { createReadStream } = require("fs");
const { parse } = require("csv-parse");
const path = require("path");

const FILE = path.resolve(__dirname, "../private_input/PBI/backfill/duplicate part ids.csv");

async function readCsv(filePath) {
  const rows = [];
  return new Promise((resolve, reject) => {
    createReadStream(filePath)
      .pipe(parse({ columns: true, skip_empty_lines: true, trim: true }))
      .on("data", (row) => rows.push(row))
      .on("end", () => resolve(rows))
      .on("error", reject);
  });
}

async function main() {
  const rows = await readCsv(FILE);
  console.log(`Total rows: ${rows.length}`);
  console.log(`Columns: ${Object.keys(rows[0]).join(", ")}\n`);

  // Unique part_ids
  const byPartId = new Map();
  for (const row of rows) {
    const pid = row.part_id;
    if (!byPartId.has(pid)) byPartId.set(pid, []);
    byPartId.get(pid).push(row);
  }
  console.log(`Unique part_ids: ${byPartId.size}`);

  // Facttype distribution
  const facttypes = {};
  for (const row of rows) {
    const ft = row["Facttype"] || "(empty)";
    facttypes[ft] = (facttypes[ft] || 0) + 1;
  }
  console.log(`\nFacttype distribution:`);
  for (const [k, v] of Object.entries(facttypes).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`);
  }

  // Facttype Sub distribution
  const facttypeSubs = {};
  for (const row of rows) {
    const ft = row["Facttype Sub"] || "(empty)";
    facttypeSubs[ft] = (facttypeSubs[ft] || 0) + 1;
  }
  console.log(`\nFacttype Sub distribution:`);
  for (const [k, v] of Object.entries(facttypeSubs).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`);
  }

  // reden_id_correctie distribution
  const redenen = {};
  for (const row of rows) {
    const r = row.reden_id_correctie || "(null)";
    redenen[r] = (redenen[r] || 0) + 1;
  }
  console.log(`\nReden ID correctie distribution:`);
  for (const [k, v] of Object.entries(redenen).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`);
  }

  // Pattern analysis: per part_id, how many origineel vs correctie vs productie?
  let patternsMap = {};
  for (const [pid, pidRows] of byPartId) {
    const subs = pidRows.map(r => r["Facttype Sub"]).sort();
    const key = subs.join(" + ");
    patternsMap[key] = (patternsMap[key] || 0) + 1;
  }
  console.log(`\nFacttype Sub patterns per part_id (top 20):`);
  const patterns = Object.entries(patternsMap).sort((a, b) => b[1] - a[1]).slice(0, 20);
  for (const [pattern, count] of patterns) {
    console.log(`  [${count}x] ${pattern}`);
  }

  // Key fields on origineel vs correctie rows
  console.log(`\n--- Fields on "origineel" rows vs "correctie" rows ---`);
  const origRows = rows.filter(r => r["Facttype Sub"] === "origineel");
  const corrRows = rows.filter(r => r["Facttype Sub"] === "correctie");
  const prodRows = rows.filter(r => r["Facttype Sub"] === "productie");

  console.log(`\nOrigineel rows: ${origRows.length}`);
  console.log(`Correctie rows: ${corrRows.length}`);
  console.log(`Productie rows: ${prodRows.length}`);

  // Check which fields differ between origineel and correctie for same part_id
  const fieldDiffs = {};
  const allFields = Object.keys(rows[0]);
  for (const [pid, pidRows] of byPartId) {
    const orig = pidRows.find(r => r["Facttype Sub"] === "origineel");
    const corrs = pidRows.filter(r => r["Facttype Sub"] === "correctie");
    if (!orig || corrs.length === 0) continue;

    for (const corr of corrs) {
      for (const f of allFields) {
        if (f === "Facttype Sub" || f === "reden_id_correctie") continue;
        if (corr[f] !== orig[f]) {
          if (!fieldDiffs[f]) fieldDiffs[f] = 0;
          fieldDiffs[f]++;
        }
      }
    }
  }
  console.log(`\nFields that differ between origineel and correctie (top 25):`);
  const diffsSorted = Object.entries(fieldDiffs).sort((a, b) => b[1] - a[1]).slice(0, 25);
  for (const [field, count] of diffsSorted) {
    console.log(`  ${field}: differs in ${count} correction rows`);
  }

  // Show a few examples of correctie-specific fields
  console.log(`\n--- Example part_id with origineel + correcties ---`);
  let shown = 0;
  for (const [pid, pidRows] of byPartId) {
    if (shown >= 3) break;
    const orig = pidRows.find(r => r["Facttype Sub"] === "origineel");
    const corrs = pidRows.filter(r => r["Facttype Sub"] !== "origineel");
    if (!orig || corrs.length < 2) continue;

    console.log(`\n  part_id=${pid} (${pidRows.length} rows):`);
    console.log(`    ORIGINEEL: vol=${orig["Inslag aantal"]}, colli=${orig["Inslag colli"]}, reden=${orig.reden_id_correctie || "-"}, inkoop_factuur_aantal=${orig.inkoop_factuur_aantal}, corr_aantal=${orig["Inslag aantal correctie"]}, corr_colli=${orig["Inslag colli correctie"]}, verdeelregel=${orig["Verdeelregel aantal"]}`);
    for (const c of corrs) {
      console.log(`    ${(c["Facttype Sub"] || "?").toUpperCase()}: vol=${c["Inslag aantal"]}, colli=${c["Inslag colli"]}, reden=${c.reden_id_correctie || "-"}, inkoop_factuur_aantal=${c.inkoop_factuur_aantal}, corr_aantal=${c["Inslag aantal correctie"]}, corr_colli=${c["Inslag colli correctie"]}, verdeelregel=${c["Verdeelregel aantal"]}`);
    }
    shown++;
  }
}

main().catch(console.error);
