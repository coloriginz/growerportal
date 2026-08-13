const { neon } = require('@neondatabase/serverless');
require('dotenv').config();
const sql = neon(process.env.DATABASE_URL);

async function main() {
  const batches = await sql`
    SELECT status, "recordsReceived", "recordsCreated", "recordsUpdated", "recordsSkipped",
           "durationMs", "errorMessage"
    FROM "ImportBatch"
    WHERE endpoint = 'lots' AND status = 'error'
    ORDER BY "startedAt" DESC
    LIMIT 10
  `;
  for (const b of batches) {
    const err = b.errorMessage ? b.errorMessage.substring(0, 200) : '-';
    console.log(`${b.status} | recv=${b.recordsReceived} | ${b.durationMs}ms | ${err}`);
  }
}
main().catch(console.error);
