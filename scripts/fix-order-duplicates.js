/**
 * One-time cleanup script:
 * 1. Remove duplicate transactions (same fabricOrdregId + lotId + stems + amount + date)
 * 2. Recalculate all lot aggregates from transactions
 * 3. Recalculate all salessheet totals from lots
 *
 * Run: node scripts/fix-order-duplicates.js
 * Safe to run multiple times (idempotent).
 */
const { neon } = require("@neondatabase/serverless");
require("dotenv").config();

const sql = neon(process.env.DATABASE_URL);

async function main() {
  console.log("=== Step 1: Find and remove duplicate transactions ===");

  // Find duplicates: same (fabricOrdregId, lotId, stems, amount, date, salesType, bronFeitExtra)
  // Keep the oldest row (MIN(id)), delete the rest
  const dupeCount = await sql`
    SELECT COUNT(*) as cnt FROM (
      SELECT "fabricOrdregId", "lotId", stems, amount, date, "salesType", "bronFeitExtra",
             COUNT(*) as cnt
      FROM "Transaction"
      WHERE "fabricOrdregId" IS NOT NULL
      GROUP BY "fabricOrdregId", "lotId", stems, amount, date, "salesType", "bronFeitExtra"
      HAVING COUNT(*) > 1
    ) sub
  `;
  console.log("Duplicate groups found:", dupeCount[0].cnt);

  if (parseInt(dupeCount[0].cnt) > 0) {
    // Delete duplicates, keeping the row with the smallest id per group
    const deleted = await sql`
      DELETE FROM "Transaction"
      WHERE id IN (
        SELECT id FROM (
          SELECT id,
            ROW_NUMBER() OVER (
              PARTITION BY "fabricOrdregId", "lotId", stems, amount, date, "salesType", "bronFeitExtra"
              ORDER BY id
            ) as rn
          FROM "Transaction"
          WHERE "fabricOrdregId" IS NOT NULL
        ) ranked
        WHERE rn > 1
      )
    `;
    console.log("Deleted duplicate rows:", deleted.count || "done");
  }

  // Verify
  const dupeCheck = await sql`
    SELECT "fabricOrdregId", "lotId", COUNT(*) as cnt
    FROM "Transaction"
    WHERE "fabricOrdregId" IS NOT NULL
    GROUP BY "fabricOrdregId", "lotId"
    HAVING COUNT(*) > 1
    LIMIT 5
  `;
  console.log("Remaining (ordregId, lotId) duplicates (expected for multi-sub-tx):", dupeCheck.length);
  if (dupeCheck.length > 0) {
    for (const d of dupeCheck) {
      console.log("  ordregId=" + d.fabricOrdregId + " lotId=" + d.lotId + " count=" + d.cnt);
    }
    console.log("  (These are legitimate: same ordregId with different volumes/amounts)");
  }

  console.log("\n=== Step 2: Recalculate ALL lot aggregates from transactions ===");
  const lotsUpdated = await sql`
    UPDATE "Lot" AS l
    SET
      "totalStems" = COALESCE(agg.total_stems, 0),
      "totalAmount" = ROUND(COALESCE(agg.total_amount, 0)::numeric, 2),
      "avgPrice" = CASE WHEN COALESCE(agg.total_stems, 0) > 0
        THEN ROUND((COALESCE(agg.total_amount, 0) / agg.total_stems)::numeric, 4)
        ELSE 0 END,
      "updatedAt" = NOW()
    FROM (
      SELECT
        "lotId",
        SUM(stems)::int as total_stems,
        SUM(amount) as total_amount
      FROM "Transaction"
      GROUP BY "lotId"
    ) AS agg
    WHERE l.id = agg."lotId"
      AND (l."totalStems" != COALESCE(agg.total_stems, 0)
        OR l."totalAmount" != ROUND(COALESCE(agg.total_amount, 0)::numeric, 2))
  `;
  console.log("Lots recalculated:", lotsUpdated.count || "0 (all correct)");

  console.log("\n=== Step 3: Recalculate ALL salessheet totals ===");
  const ssUpdated = await sql`
    WITH lot_totals AS (
      SELECT "salesSheetId", SUM("totalAmount") as total
      FROM "Lot"
      WHERE "salesSheetId" IS NOT NULL
      GROUP BY "salesSheetId"
    ),
    cost_totals AS (
      SELECT "salesSheetId", SUM(amount) as total
      FROM "SalesSheetCost"
      GROUP BY "salesSheetId"
    )
    UPDATE "SalesSheet" AS ss
    SET
      "totalTurnover" = ROUND(COALESCE(lt.total, 0)::numeric, 2),
      "totalCosts" = ROUND(COALESCE(ct.total, 0)::numeric, 2),
      "netResult" = ROUND((COALESCE(lt.total, 0) - COALESCE(ct.total, 0))::numeric, 2),
      "updatedAt" = NOW()
    FROM lot_totals lt
    LEFT JOIN cost_totals ct ON ct."salesSheetId" = lt."salesSheetId"
    WHERE ss.id = lt."salesSheetId"
      AND (ss."totalTurnover" != ROUND(COALESCE(lt.total, 0)::numeric, 2)
        OR ss."totalCosts" != ROUND(COALESCE(ct.total, 0)::numeric, 2))
  `;
  console.log("SalesSheets recalculated:", ssUpdated.count || "0 (all correct)");

  console.log("\n=== Done ===");

  // Show the specific salessheet from the bug report as verification
  const ss = await sql`
    SELECT id, "invoiceNumber", "totalTurnover", "totalCosts", "netResult"
    FROM "SalesSheet"
    WHERE id = 'a02ea812-e369-466c-9bfb-f7f87e6a702f'
  `;
  if (ss.length > 0) {
    console.log("\nVerification - SalesSheet 217-26:", JSON.stringify(ss[0]));
  }

  const lots = await sql`
    SELECT "lotNumber", "totalStems", "totalAmount",
      (SELECT COUNT(*) FROM "Transaction" WHERE "lotId" = l.id) as tx_count
    FROM "Lot" l
    WHERE "salesSheetId" = 'a02ea812-e369-466c-9bfb-f7f87e6a702f'
    ORDER BY "lotNumber"
  `;
  console.log("Lots:");
  for (const l of lots) {
    console.log("  " + l.lotNumber + ": " + l.totalStems + " stems, " + l.tx_count + " transactions");
  }
}

main().catch(console.error);
