const fs = require('fs');
const { parse } = require('csv-parse/sync');

const BATCH_SIZE = 5000;
const data = parse(fs.readFileSync('private_input/PBI/backfill/orders_2025.csv'), {
  columns: true, skip_empty_lines: true, trim: true
});

console.log(`Total rows: ${data.length}`);
console.log(`Total batches: ${Math.ceil(data.length / BATCH_SIZE)}\n`);

// Simulate what happens batch by batch
const seenOrdregIds = new Set();
const seenPartIds = new Set();

for (let i = 0; i < data.length; i += BATCH_SIZE) {
  const batch = data.slice(i, i + BATCH_SIZE);
  const batchNum = Math.floor(i / BATCH_SIZE) + 1;

  let newOrdreg = 0, dupOrdreg = 0, nullOrdreg = 0;
  let newPartId = 0, dupPartId = 0;

  for (const row of batch) {
    const oid = row.ordreg_id;
    const pid = row.part_id;

    if (!oid || oid === '') {
      nullOrdreg++;
    } else if (seenOrdregIds.has(oid)) {
      dupOrdreg++;
    } else {
      newOrdreg++;
      seenOrdregIds.add(oid);
    }

    if (seenPartIds.has(pid)) {
      dupPartId++;
    } else {
      newPartId++;
      seenPartIds.add(pid);
    }
  }

  console.log(`Batch ${batchNum}: ${batch.length} rows | ordreg: ${newOrdreg} new, ${dupOrdreg} dup, ${nullOrdreg} null | part_id: ${newPartId} new, ${dupPartId} dup`);
}

// Also check: are ordreg_ids repeated in a pattern?
console.log('\n--- First 20 rows: ordreg_id + part_id ---');
for (let i = 0; i < 20; i++) {
  console.log(`  row ${i}: ordreg_id=${data[i].ordreg_id || '(null)'}, part_id=${data[i].part_id}, type=${data[i].Verkooptype || '-'}, vol=${data[i].Verkoopvolume || '-'}`);
}
