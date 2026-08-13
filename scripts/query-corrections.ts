import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";
config();
const sql = neon(process.env.DATABASE_URL!);

async function main() {
  // Check corrections for lot 3901167
  const lot = await sql`SELECT id, "lotNumber", "totalStems", "correctionVolume" FROM "Lot" WHERE "lotNumber" = '3901167' LIMIT 1`;
  console.log("Lot:", JSON.stringify(lot[0]));

  const corrections = await sql`SELECT * FROM "LotCorrection" WHERE "lotId" = ${lot[0].id}`;
  console.log("Corrections in DB:", corrections.length);
  corrections.forEach(c => console.log(JSON.stringify(c)));

  // Check if there are duplicate part_ids in the source data
  // by looking at unique constraint
  const constraint = await sql`
    SELECT conname, pg_get_constraintdef(oid) 
    FROM pg_constraint 
    WHERE conrelid = '"LotCorrection"'::regclass AND contype = 'u'
  `;
  console.log("\nUnique constraints:", JSON.stringify(constraint, null, 2));
}
main();
