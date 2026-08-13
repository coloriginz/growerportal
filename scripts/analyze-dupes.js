const { createReadStream } = require("fs");
const { parse } = require("csv-parse");
const path = require("path");

const INPUT_DIR = path.resolve(__dirname, "../private_input/PBI/backfill");

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
  for (const file of ["partij_2025.csv", "partij_2026.csv"]) {
    console.log(`\n=== ${file} ===`);
    const rows = await readCsv(path.join(INPUT_DIR, file));
    console.log(`Total rows: ${rows.length}`);

    // Count by part_id
    const byPartId = new Map();
    for (const row of rows) {
      const pid = row.part_id;
      if (!byPartId.has(pid)) byPartId.set(pid, []);
      byPartId.get(pid).push(row);
    }

    const uniquePartIds = byPartId.size;
    const dupes = [...byPartId.entries()].filter(([, v]) => v.length > 1);
    console.log(`Unique part_ids: ${uniquePartIds}`);
    console.log(`Duplicate part_ids: ${dupes.length}`);

    if (dupes.length > 0) {
      console.log(`\nTop 10 duplicates:`);
      const sorted = dupes.sort((a, b) => b[1].length - a[1].length).slice(0, 10);
      for (const [pid, dupRows] of sorted) {
        console.log(`\n  part_id=${pid} (${dupRows.length} rows):`);
        for (const r of dupRows) {
          console.log(`    parthdr_id=${r.parthdr_id} | lev=${r.rel_id_leverancier} | partijnr=${r.Partijnummer} | artikel=${r["Artikel Naam"]} | factuur=${r["Inkoop Factuur Nummer"]} | reden_correctie=${r.reden_id_correctie || "-"} | vol=${r["Inkoopfactuur volume"] || "-"} | corr_vol=${r["Inslagcorrectie volume"] || "-"}`);
        }
      }

      // Analyze: are dupes same or different data?
      let sameData = 0;
      let diffParthdr = 0;
      let diffLeverancier = 0;
      let diffArtikel = 0;
      let diffFactuur = 0;
      for (const [, dupRows] of dupes) {
        const first = dupRows[0];
        const allSame = dupRows.every(r =>
          r.parthdr_id === first.parthdr_id &&
          r.rel_id_leverancier === first.rel_id_leverancier &&
          r["Artikel Naam"] === first["Artikel Naam"]
        );
        if (allSame) sameData++;
        if (dupRows.some(r => r.parthdr_id !== first.parthdr_id)) diffParthdr++;
        if (dupRows.some(r => r.rel_id_leverancier !== first.rel_id_leverancier)) diffLeverancier++;
        if (dupRows.some(r => r["Artikel Naam"] !== first["Artikel Naam"])) diffArtikel++;
        if (dupRows.some(r => r["Inkoop Factuur Nummer"] !== first["Inkoop Factuur Nummer"])) diffFactuur++;
      }
      console.log(`\nDuplicate analysis:`);
      console.log(`  Fully identical (same parthdr, lev, artikel): ${sameData}`);
      console.log(`  Different parthdr_id: ${diffParthdr}`);
      console.log(`  Different leverancier: ${diffLeverancier}`);
      console.log(`  Different artikel: ${diffArtikel}`);
      console.log(`  Different factuur: ${diffFactuur}`);
    }

    // Also check lotNumber (Partijnummer) duplicates per leverancier
    const byLotSupplier = new Map();
    for (const row of rows) {
      const key = `${row.Partijnummer}__${row.rel_id_leverancier}`;
      if (!byLotSupplier.has(key)) byLotSupplier.set(key, []);
      byLotSupplier.get(key).push(row);
    }
    const lotSupplierDupes = [...byLotSupplier.entries()].filter(([, v]) => v.length > 1);
    console.log(`\nDuplicate lotNumber+leverancier combos: ${lotSupplierDupes.length}`);
  }
}

main().catch(console.error);
