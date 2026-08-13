const { neon } = require("@neondatabase/serverless");
require("dotenv").config();

const sql = neon(process.env.DATABASE_URL);

async function main() {
  // 1. Recent order import batches
  const batches = await sql`
    SELECT id, status, "recordsReceived", "recordsCreated", "recordsSkipped",
           details, "startedAt", "completedAt", "durationMs"
    FROM "ImportBatch"
    WHERE endpoint = 'orders'
    ORDER BY "startedAt" DESC
    LIMIT 15
  `;
  console.log("=== Recent order import batches ===");
  for (const b of batches) {
    console.log(
      `  ${b.startedAt} | status=${b.status} | received=${b.recordsReceived} created=${b.recordsCreated} skipped=${b.recordsSkipped} | ${b.durationMs}ms`
    );
    if (b.details) console.log("    details:", JSON.stringify(b.details));
  }

  // 2. Check staging data for the part_ids of the 4 lots
  const partIds = [5792668, 5792669, 5792670, 5792671];
  console.log("\n=== Staging orders (StagingKbtOrder) for these partIds ===");
  const staging = await sql`
    SELECT * FROM "StagingKbtOrder"
    WHERE "partId" IN (5792668, 5792669, 5792670, 5792671)
    ORDER BY "partId", "ordregId"
  `;
  console.log(`Found ${staging.length} staging rows`);
  for (const s of staging) {
    console.log(
      `  partId=${s.partId} ordregId=${s.ordregId} date=${s.datumKeyVertrek} type=${s.verkooptype} stems=${s.verkoopvolume} price=${s.gemAfrekenprijs} amt=${s.afrekenomzet} batchId=${s.importBatchId}`
    );
  }

  // 3. Current transactions
  console.log("\n=== Current transactions in DB ===");
  const txs = await sql`
    SELECT t.*, l."lotNumber", l."fabricPartId"
    FROM "Transaction" t
    JOIN "Lot" l ON l.id = t."lotId"
    WHERE l."fabricPartId" IN (5792668, 5792669, 5792670, 5792671)
    ORDER BY l."fabricPartId", t.date
  `;
  let currentPartId = null;
  for (const tx of txs) {
    if (tx.fabricPartId !== currentPartId) {
      currentPartId = tx.fabricPartId;
      console.log(`\nLot ${tx.lotNumber} (partId=${tx.fabricPartId}):`);
    }
    console.log(
      `  ${tx.date.toISOString().slice(0, 10)} ${tx.salesType} stems=${tx.stems} price=${tx.pricePerStem} amt=${tx.amount} ordregId=${tx.fabricOrdregId}`
    );
  }
}

main().catch(console.error);
