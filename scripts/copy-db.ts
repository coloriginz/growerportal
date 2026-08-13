/**
 * Copy all data from dev database to production database.
 * Handles circular FK dependencies by nullifying backreferences, inserting, then updating.
 */
import { neon } from "@neondatabase/serverless";
import * as dotenv from "dotenv";
import * as fs from "fs";

const devEnv = dotenv.parse(fs.readFileSync(".env"));
const prodEnv = dotenv.parse(fs.readFileSync(".env.production"));

const devSql = neon(devEnv.DIRECT_URL!);
const prodSql = neon(prodEnv.DIRECT_URL!);

// Tables in strict dependency order
// Phase 1: tables with no or only forward FK dependencies (with nullable backrefs nullified)
const PHASE1_TABLES = [
  "Company",
  "Transporter",
  "Setting",
  "CorrectionReasonCode",
  "SalesSheetIngestion",
  "FustType",
  "FabricRelation",
  "ImportBatch",
];

// Phase 2: core entities (Supplier needs User.commercieId nullified first)
// User needs Supplier, Supplier needs User — break cycle
const PHASE2_TABLES = [
  "Supplier",    // insert with commercieId = NULL
  "User",        // insert with supplierId (Supplier exists now)
  // Then update Supplier.commercieId
];

// Phase 3: entities depending on Supplier + User
const PHASE3_TABLES = [
  "_UserCompanies",
  "Grower",
  "SalesSheet",   // insert with pdfDocumentId = NULL
  "Document",     // needs Supplier
  // Then update SalesSheet.pdfDocumentId
  "SalesSheetCost",
  "Lot",
  "LotCorrection",
  "Transaction",
  "QualityIssue",
  "Certificate",
  "ChangeRequest",
  "ShipmentForecast",
];

// Phase 4: Fust entities
const PHASE4_TABLES = [
  "FustOrder",
  "FustOrderItem",
  "FustPickup",
  "FustDelivery",
  "FustDeliveryItem",
  "FustInvoice",
  "FustInvoiceItem",
  "FustGrowerInvoice",
  "FustGrowerInvoiceItem",
  "FustGrowerCharge",
  "FustIssuanceVoucher",
  "FustIssuanceVoucherItem",
  "FustVoucherOrderLink",
  "FustAuditLog",
  "FustEmailIngestion",
  "StagingKbtOrder",
  "StagingKbtPartij",
  "StagingKbtShcost",
];

async function copyTable(table: string, nullifyCols: string[] = []) {
  const rows = await devSql.query(`SELECT * FROM "${table}"`);
  if (rows.length === 0) {
    console.log(`  ${table}: 0 rows (skip)`);
    return;
  }

  const cols = Object.keys(rows[0]);
  const colList = cols.map((c) => `"${c}"`).join(", ");

  const BATCH_SIZE = 50;
  let inserted = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const values: unknown[] = [];
    const valueClauses: string[] = [];

    for (const row of batch) {
      const placeholders = cols.map((_, j) => `$${values.length + j + 1}`);
      valueClauses.push(`(${placeholders.join(", ")})`);
      for (const col of cols) {
        if (nullifyCols.includes(col)) {
          values.push(null);
        } else {
          values.push(row[col]);
        }
      }
    }

    const sql = `INSERT INTO "${table}" (${colList}) VALUES ${valueClauses.join(", ")}`;
    await prodSql.query(sql, values);
    inserted += batch.length;

    if (inserted % 1000 === 0 && rows.length > 1000) {
      process.stdout.write(`  ${table}: ${inserted}/${rows.length}...\r`);
    }
  }

  console.log(`  ${table}: ${inserted} rows copied${nullifyCols.length ? ` (nullified: ${nullifyCols.join(", ")})` : ""}`);
}

async function updateBackrefs(table: string, col: string) {
  // Read original values from dev
  const rows = await devSql.query(`SELECT "id", "${col}" FROM "${table}" WHERE "${col}" IS NOT NULL`);
  if (rows.length === 0) return;

  let updated = 0;
  for (const row of rows) {
    await prodSql.query(`UPDATE "${table}" SET "${col}" = $1 WHERE "id" = $2`, [row[col], row.id]);
    updated++;
  }
  console.log(`  ${table}.${col}: ${updated} rows updated`);
}

// For _UserCompanies (no id column)
async function copyJoinTable(table: string) {
  const rows = await devSql.query(`SELECT * FROM "${table}"`);
  if (rows.length === 0) {
    console.log(`  ${table}: 0 rows (skip)`);
    return;
  }

  const cols = Object.keys(rows[0]);
  const colList = cols.map((c) => `"${c}"`).join(", ");

  for (const row of rows) {
    const values = cols.map((c) => row[c]);
    const placeholders = cols.map((_, j) => `$${j + 1}`);
    await prodSql.query(`INSERT INTO "${table}" (${colList}) VALUES (${placeholders.join(", ")})`, values);
  }
  console.log(`  ${table}: ${rows.length} rows copied`);
}

async function main() {
  console.log("Copying dev database to production...\n");

  // Phase 1: Independent tables
  console.log("Phase 1: Independent tables");
  for (const table of PHASE1_TABLES) {
    try {
      await copyTable(table);
    } catch (err: unknown) {
      console.error(`  ${table}: ERROR - ${err instanceof Error ? err.message : err}`);
    }
  }

  // Phase 2: Break Supplier ↔ User cycle
  console.log("\nPhase 2: Supplier + User (break cycle)");
  try {
    await copyTable("Supplier", ["commercieId"]); // nullify commercieId
    await copyTable("User");                       // User.supplierId → Supplier exists
    await updateBackrefs("Supplier", "commercieId"); // restore commercieId
  } catch (err: unknown) {
    console.error(`  Phase 2 ERROR: ${err instanceof Error ? err.message : err}`);
  }

  // Phase 3: Supplier-dependent entities
  console.log("\nPhase 3: Supplier-dependent entities");
  for (const table of PHASE3_TABLES) {
    try {
      if (table === "_UserCompanies") {
        await copyJoinTable(table);
      } else if (table === "SalesSheet") {
        await copyTable(table, ["pdfDocumentId"]); // nullify pdfDocumentId
      } else {
        await copyTable(table);
      }
    } catch (err: unknown) {
      console.error(`  ${table}: ERROR - ${err instanceof Error ? err.message : err}`);
    }
  }

  // Restore SalesSheet.pdfDocumentId
  try {
    await updateBackrefs("SalesSheet", "pdfDocumentId");
  } catch (err: unknown) {
    console.error(`  SalesSheet.pdfDocumentId update ERROR: ${err instanceof Error ? err.message : err}`);
  }

  // Phase 4: Fust entities
  console.log("\nPhase 4: Fust entities");
  for (const table of PHASE4_TABLES) {
    try {
      await copyTable(table);
    } catch (err: unknown) {
      console.error(`  ${table}: ERROR - ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log("\nDone!");
}

main().catch(console.error);
