const { neon } = require('@neondatabase/serverless');
const fs = require('fs');

const envContent = fs.readFileSync('.env', 'utf8');
const match = envContent.match(/^DATABASE_URL=["']?(.+?)["']?\s*$/m);
if (!match) { console.error('No DATABASE_URL found'); process.exit(1); }
const sql = neon(match[1]);

async function main() {
  const countRes = await sql`SELECT COUNT(*) as total FROM "ImportBatch" WHERE endpoint = 'orders'`;
  console.log('Total orders ImportBatch records:', countRes[0].total);

  const batches = await sql`
    SELECT id, "startedAt", "completedAt", "recordsCreated", "recordsUpdated", "recordsSkipped", status
    FROM "ImportBatch"
    WHERE endpoint = 'orders'
    ORDER BY "startedAt" ASC
  `;

  console.log('\n--- All orders batches (chronological) ---');
  let prevTime = null;
  for (let i = 0; i < batches.length; i++) {
    const row = batches[i];
    const started = new Date(row.startedAt);
    const gap = prevTime ? Math.round((started - prevTime) / 1000) : 0;
    const completed = row.completedAt ? new Date(row.completedAt) : null;
    const duration = completed ? Math.round((completed - started) / 1000) : '?';
    console.log(
      `  #${String(i+1).padStart(3)} ${started.toISOString().slice(11,19)} (+${String(gap).padStart(4)}s) | ${String(duration).padStart(3)}s | C=${String(row.recordsCreated).padStart(5)} U=${String(row.recordsUpdated).padStart(5)} S=${String(row.recordsSkipped).padStart(5)} | ${row.status}`
    );
    prevTime = started;
  }

  // Wave analysis
  console.log('\n--- Wave analysis ---');
  const times = batches.map(r => new Date(r.startedAt).getTime());
  const gaps = [];
  for (let i = 1; i < times.length; i++) {
    gaps.push({ index: i, gap: (times[i] - times[i-1]) / 1000 });
  }
  // Find all gaps > 60s
  const bigGaps = gaps.filter(g => g.gap > 60).sort((a, b) => b.gap - a.gap);
  console.log(`Large gaps (>60s): ${bigGaps.length}`);
  for (const g of bigGaps) {
    console.log(`  Between batch #${g.index} and #${g.index + 1}: ${g.gap}s`);
  }

  // Split into waves at large gaps
  if (bigGaps.length > 0) {
    const splitPoints = bigGaps.map(g => g.index).sort((a, b) => a - b);
    const waves = [];
    let start = 0;
    for (const sp of splitPoints) {
      waves.push(batches.slice(start, sp));
      start = sp;
    }
    waves.push(batches.slice(start));

    console.log(`\n=> ${waves.length} distinct waves detected:`);
    for (let w = 0; w < waves.length; w++) {
      const wave = waves[w];
      const created = wave.reduce((s, r) => s + (parseInt(r.recordsCreated) || 0), 0);
      const updated = wave.reduce((s, r) => s + (parseInt(r.recordsUpdated) || 0), 0);
      const skipped = wave.reduce((s, r) => s + (parseInt(r.recordsSkipped) || 0), 0);
      const t0 = new Date(wave[0].startedAt).toISOString().slice(0,19);
      const t1 = new Date(wave[wave.length-1].startedAt).toISOString().slice(0,19);
      console.log(`  Wave ${w+1}: ${wave.length} batches | ${t0} - ${t1} | C=${created} U=${updated} S=${skipped}`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
