import { createReadStream } from "fs";
import { parse } from "csv-parse";
import path from "path";

const filePath = path.resolve(__dirname, "../private_input/PBI/backfill/dubbele rijen part 2026 ivm corr reden.csv");

interface Row {
  part_id: string;
  Partijnummer: string;
  "Facttype Sub": string;
  reden_id_correctie: string;
  "Inslag aantal correctie": string;
  rel_id_leverancier: string;
}

async function main() {
  const rows: Row[] = [];
  await new Promise<void>((resolve, reject) => {
    createReadStream(filePath)
      .pipe(parse({ columns: true, skip_empty_lines: true, trim: true, relax_column_count: true }))
      .on("data", (row: Row) => rows.push(row))
      .on("end", () => resolve())
      .on("error", reject);
  });

  console.log(`Total rows: ${rows.length}`);

  // Split into origineel vs correctie
  const origineelRows = rows.filter(r => r["Facttype Sub"] === "origineel");
  const correctieRows = rows.filter(r => r["Facttype Sub"] !== "origineel");
  console.log(`Origineel rows: ${origineelRows.length}`);
  console.log(`Correctie rows: ${correctieRows.length}`);

  // Group corrections by part_id + reden_id_correctie
  const byPartAndReason = new Map<string, Row[]>();
  for (const row of correctieRows) {
    const key = `${row.part_id}::${row.reden_id_correctie}`;
    const arr = byPartAndReason.get(key) || [];
    arr.push(row);
    byPartAndReason.set(key, arr);
  }

  // Find duplicates: same part_id + same reden_id_correctie appearing > 1 time
  let dupeCount = 0;
  const dupeExamples: { key: string; count: number; rows: Row[] }[] = [];
  for (const [key, arr] of byPartAndReason) {
    if (arr.length > 1) {
      dupeCount++;
      if (dupeExamples.length < 10) {
        dupeExamples.push({ key, count: arr.length, rows: arr });
      }
    }
  }

  console.log(`\n--- Duplicate analysis: same part_id + same reden_id_correctie ---`);
  console.log(`Unique part_id+reden combos: ${byPartAndReason.size}`);
  console.log(`Combos with >1 row (DUPLICATES): ${dupeCount}`);

  if (dupeCount > 0) {
    console.log(`\nExamples (first 10):`);
    for (const ex of dupeExamples) {
      console.log(`\n  ${ex.key} (${ex.count} rows):`);
      for (const r of ex.rows) {
        console.log(`    part_id=${r.part_id} partijnr=${r.Partijnummer} reden=${r.reden_id_correctie} volume=${r["Inslag aantal correctie"]} leverancier=${r.rel_id_leverancier}`);
      }
    }
  }

  // Also check: same part_id with multiple DIFFERENT reden_id_correctie
  const byPartId = new Map<string, Set<string>>();
  for (const row of correctieRows) {
    const reasons = byPartId.get(row.part_id) || new Set();
    reasons.add(row.reden_id_correctie);
    byPartId.set(row.part_id, reasons);
  }

  let multiReasonCount = 0;
  for (const [, reasons] of byPartId) {
    if (reasons.size > 1) multiReasonCount++;
  }

  console.log(`\n--- Multiple different reasons per part_id ---`);
  console.log(`Part_ids with >1 different reden_id_correctie: ${multiReasonCount}`);
}

main();
