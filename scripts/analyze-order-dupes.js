const fs = require('fs');
const { parse } = require('csv-parse/sync');

for (const [label, file] of [['2025', 'orders_2025.csv'], ['2026', 'orders_2026.csv']]) {
  const data = parse(fs.readFileSync('private_input/PBI/backfill/' + file), {columns:true, skip_empty_lines:true, trim:true});

  console.log('=== orders_' + label + ' ===');
  console.log('Total rows:', data.length);
  console.log('Columns:', Object.keys(data[0]).join(', '));

  // Check for duplicate ordreg_ids
  const byOrdregId = new Map();
  let nullCount = 0;
  for (const row of data) {
    const id = row.ordreg_id;
    if (id === undefined || id === null || id === '') { nullCount++; continue; }
    if (!byOrdregId.has(id)) byOrdregId.set(id, []);
    byOrdregId.get(id).push(row);
  }
  const dupes = [...byOrdregId.entries()].filter(([,v]) => v.length > 1);
  console.log('Unique ordreg_ids:', byOrdregId.size);
  console.log('Null/empty ordreg_ids:', nullCount);
  console.log('Duplicate ordreg_ids:', dupes.length);

  if (dupes.length > 0) {
    console.log('\nTop 10 duplicates:');
    const top = dupes.sort((a,b) => b[1].length - a[1].length).slice(0,10);
    for (const [id, rows] of top) {
      console.log('  ordreg_id=' + id + ' (' + rows.length + ' rows)');
      for (const r of rows) {
        console.log('    part_id=' + r.part_id + ' | type=' + (r.Verkooptype || '-') + ' | vol=' + (r.Verkoopvolume || '-') + ' | omzet=' + (r.Afrekenomzet || '-'));
      }
    }

    // Check if dupes have different data
    let samePart = 0, diffPart = 0;
    let sameType = 0, diffType = 0;
    let sameVol = 0, diffVol = 0;
    for (const [, rows] of dupes) {
      const first = rows[0];
      if (rows.every(r => r.part_id === first.part_id)) samePart++; else diffPart++;
      if (rows.every(r => r.Verkooptype === first.Verkooptype)) sameType++; else diffType++;
      if (rows.every(r => r.Verkoopvolume === first.Verkoopvolume)) sameVol++; else diffVol++;
    }
    console.log('\nDuplicate analysis:');
    console.log('  Same part_id:', samePart, '| Different:', diffPart);
    console.log('  Same Verkooptype:', sameType, '| Different:', diffType);
    console.log('  Same Verkoopvolume:', sameVol, '| Different:', diffVol);
  }
  console.log('');
}
