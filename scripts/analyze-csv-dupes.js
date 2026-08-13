const fs = require("fs");
const { parse } = require("csv-parse/sync");

const file = "private_input/PBI/backfill/orders_2026 NIEUW incl bronfeit en reden.csv";
const data = parse(fs.readFileSync(file), { columns: true, skip_empty_lines: true, trim: true });

console.log("Total rows:", data.length);
console.log("Columns:", Object.keys(data[0]).join(", "));
console.log("");

// Check duplicates by (ordreg_id, part_id, bron_feit_extra)
const byKey3 = new Map();
let nullOrdreg = 0;
for (const row of data) {
  if (!row.ordreg_id || row.ordreg_id === "") { nullOrdreg++; continue; }
  const key = row.ordreg_id + "::" + row.part_id + "::" + (row.bron_feit_extra || "");
  if (!byKey3.has(key)) byKey3.set(key, []);
  byKey3.get(key).push(row);
}

const dupes3 = [...byKey3.entries()].filter(([, v]) => v.length > 1);
console.log("Null ordreg_id:", nullOrdreg);
console.log("Unique (ordreg_id, part_id, bron_feit_extra):", byKey3.size);
console.log("Duplicates on 3-col key:", dupes3.length);

if (dupes3.length > 0) {
  console.log("\nTop 5 duplicates on 3-col key:");
  const top = dupes3.sort((a, b) => b[1].length - a[1].length).slice(0, 5);
  for (const [key, rows] of top) {
    console.log("  Key: " + key + " (" + rows.length + " rows)");
    for (const r of rows) {
      console.log(
        "    date=" + r._datum_key_vertrek +
        " type=" + (r.Verkooptype || "-") +
        " vol=" + (r.Verkoopvolume || "-") +
        " omzet=" + (r.Afrekenomzet || "-") +
        " bronfeit=" + (r.bron_feit_extra || "-") +
        " reden=" + (r.reden_id || "-")
      );
    }
  }

  // Are 3-col dupes truly identical?
  let identical3 = 0;
  for (const [, rows] of dupes3) {
    const first = rows[0];
    const allSame = rows.every(
      (r) =>
        r._datum_key_vertrek === first._datum_key_vertrek &&
        r.Verkooptype === first.Verkooptype &&
        r.Verkoopvolume === first.Verkoopvolume &&
        r.Afrekenomzet === first.Afrekenomzet
    );
    if (allSame) identical3++;
  }
  console.log("\n3-col dupes that are fully identical:", identical3, "of", dupes3.length);
}

// Check duplicates by (ordreg_id, part_id) only
const byKey2 = new Map();
for (const row of data) {
  if (!row.ordreg_id || row.ordreg_id === "") continue;
  const key = row.ordreg_id + "::" + row.part_id;
  if (!byKey2.has(key)) byKey2.set(key, []);
  byKey2.get(key).push(row);
}
const dupes2 = [...byKey2.entries()].filter(([, v]) => v.length > 1);
console.log("\nDuplicates on (ordreg_id, part_id) only:", dupes2.length);

if (dupes2.length > 0) {
  console.log("\nTop 5 (ordreg_id, part_id) dupes:");
  const top2 = dupes2.sort((a, b) => b[1].length - a[1].length).slice(0, 5);
  for (const [key, rows] of top2) {
    console.log("  Key: " + key + " (" + rows.length + " rows)");
    for (const r of rows) {
      console.log(
        "    date=" + r._datum_key_vertrek +
        " type=" + (r.Verkooptype || "-") +
        " vol=" + (r.Verkoopvolume || "-") +
        " omzet=" + (r.Afrekenomzet || "-") +
        " bronfeit=" + (r.bron_feit_extra || "-") +
        " reden=" + (r.reden_id || "-")
      );
    }
  }

  let diffBronfeit = 0, sameBronfeit = 0;
  let diffDate = 0, diffType = 0, diffVol = 0;
  for (const [, rows] of dupes2) {
    const first = rows[0];
    if (rows.every((r) => r.bron_feit_extra === first.bron_feit_extra)) sameBronfeit++;
    else diffBronfeit++;
    if (rows.some((r) => r._datum_key_vertrek !== first._datum_key_vertrek)) diffDate++;
    if (rows.some((r) => r.Verkooptype !== first.Verkooptype)) diffType++;
    if (rows.some((r) => r.Verkoopvolume !== first.Verkoopvolume)) diffVol++;
  }
  console.log("\n(ordreg_id, part_id) dupe analysis:");
  console.log("  Same bronfeit:", sameBronfeit, "| Different:", diffBronfeit);
  console.log("  Different date:", diffDate);
  console.log("  Different type:", diffType);
  console.log("  Different volume:", diffVol);
}

// Check: what does a 4-col key look like? (ordreg_id, part_id, bron_feit_extra, Verkooptype)
const byKey4 = new Map();
for (const row of data) {
  if (!row.ordreg_id || row.ordreg_id === "") continue;
  const key = row.ordreg_id + "::" + row.part_id + "::" + (row.bron_feit_extra || "") + "::" + (row.Verkooptype || "");
  if (!byKey4.has(key)) byKey4.set(key, []);
  byKey4.get(key).push(row);
}
const dupes4 = [...byKey4.entries()].filter(([, v]) => v.length > 1);
console.log("\nDuplicates on (ordreg_id, part_id, bronfeit, verkooptype):", dupes4.length);

// Check: what about (ordreg_id, part_id, bron_feit_extra, _datum_key_vertrek)?
const byKey5 = new Map();
for (const row of data) {
  if (!row.ordreg_id || row.ordreg_id === "") continue;
  const key = row.ordreg_id + "::" + row.part_id + "::" + (row.bron_feit_extra || "") + "::" + row._datum_key_vertrek;
  if (!byKey5.has(key)) byKey5.set(key, []);
  byKey5.get(key).push(row);
}
const dupes5 = [...byKey5.entries()].filter(([, v]) => v.length > 1);
console.log("Duplicates on (ordreg_id, part_id, bronfeit, datum):", dupes5.length);

if (dupes5.length > 0) {
  console.log("\nTop 3 (4-col with date) dupes:");
  const top5 = dupes5.sort((a, b) => b[1].length - a[1].length).slice(0, 3);
  for (const [key, rows] of top5) {
    console.log("  Key: " + key + " (" + rows.length + " rows)");
    for (const r of rows) {
      console.log(
        "    type=" + (r.Verkooptype || "-") +
        " vol=" + (r.Verkoopvolume || "-") +
        " omzet=" + (r.Afrekenomzet || "-") +
        " reden=" + (r.reden_id || "-")
      );
    }
  }
}
