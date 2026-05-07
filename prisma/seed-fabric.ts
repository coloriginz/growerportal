// @ts-nocheck
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { hash } from "bcryptjs";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();

// ─── CONFIG ──────────────────────────────────────────────
const INPUT_DIR = path.join(__dirname, "..", "private_input", "PBI");
const CSV_FILES = {
  suppliers: path.join(INPUT_DIR, "output DAX all suppliers.csv"),
  partijen: path.join(INPUT_DIR, "output DAX query partijens.csv"),
  orders: path.join(INPUT_DIR, "output DAX query orders 30days.csv"),
  shcosts: path.join(INPUT_DIR, "output DAX shcosts.csv"),
};

// ─── CSV PARSING UTILITIES ───────────────────────────────

/**
 * Parse a CSV row respecting quoted fields (handles commas inside quotes).
 * Does NOT handle escaped quotes ("") — not present in our data.
 */
function parseCSVRow(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuote = !inQuote;
    } else if (ch === "," && !inQuote) {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Parse an entire CSV file into an array of objects keyed by header names.
 */
function parseCSV(filePath: string): Record<string, string>[] {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split("\n").map((l) => l.replace(/\r/g, "").trim()).filter(Boolean);
  if (lines.length === 0) return [];

  const headers = parseCSVRow(lines[0]);
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVRow(lines[i]);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = fields[j] ?? "";
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Parse a Dutch decimal string: "42,39" → 42.39, "1234" → 1234, "" → null
 */
function parseDecimal(value: string): number | null {
  if (!value || value.trim() === "") return null;
  const cleaned = value.trim().replace(",", ".");
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/**
 * Parse an integer string: "12345" → 12345, "" → null
 */
function parseInt2(value: string): number | null {
  if (!value || value.trim() === "") return null;
  const num = parseInt(value.trim(), 10);
  return isNaN(num) ? null : num;
}

/**
 * Parse a date string: "2026-04-29 00:00:00.000" → Date, "" → null
 */
function parseDate(value: string): Date | null {
  if (!value || value.trim() === "") return null;
  const d = new Date(value.trim());
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Return trimmed string or null if empty.
 */
function strOrNull(value: string): string | null {
  if (!value || value.trim() === "") return null;
  return value.trim();
}

/**
 * Derive article group from product name.
 * Uses the first word of the product name as a rough grouping.
 * Products like "Protea Cynaroides" → "Protea", "Rosa Gr Mix" → "Rosa"
 */
function deriveArticleGroup(productName: string): string {
  if (!productName) return "Unknown";
  // Common prefixes used as article groups in flower trade
  const name = productName.trim();
  const firstWord = name.split(/\s+/)[0];
  return firstWord || "Unknown";
}

// ─── PROGRESS LOGGING ────────────────────────────────────

function logStep(step: string) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${step}`);
  console.log("=".repeat(60));
}

function logProgress(current: number, total: number, label: string) {
  if (current % 1000 === 0 || current === total) {
    const pct = Math.round((current / total) * 100);
    console.log(`  [${pct}%] ${current}/${total} ${label}`);
  }
}

// ─── MAIN SEED FUNCTION ─────────────────────────────────

async function main() {
  const startTime = Date.now();

  // Verify CSV files exist
  for (const [name, filePath] of Object.entries(CSV_FILES)) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`CSV file not found: ${filePath} (${name})`);
    }
    console.log(`  Found: ${name} → ${path.basename(filePath)}`);
  }

  // ─── STEP 1: CLEAN EXISTING SALES DATA ──────────────────
  logStep("Step 1: Cleaning existing sales data");

  // Delete in cascade-safe order (children before parents)
  console.log("  Deleting transactions...");
  await prisma.transaction.deleteMany();
  console.log("  Deleting salessheet costs...");
  await prisma.salesSheetCost.deleteMany();
  console.log("  Deleting quality issues...");
  await prisma.qualityIssue.deleteMany();
  console.log("  Deleting lots...");
  await prisma.lot.deleteMany();
  console.log("  Deleting salessheets...");
  await prisma.salesSheet.deleteMany();
  console.log("  Deleting shipment forecasts...");
  await prisma.shipmentForecast.deleteMany();
  console.log("  Deleting certificates...");
  await prisma.certificate.deleteMany();
  console.log("  Deleting change requests...");
  await prisma.changeRequest.deleteMany();
  console.log("  Deleting documents...");
  await prisma.document.deleteMany();

  // Delete grower (kweker) sub-entities
  console.log("  Deleting growers (kweker sub-entities)...");
  await prisma.grower.deleteMany();

  // Delete supplier users (role = 'grower' for legacy or 'supplier')
  console.log("  Deleting supplier users...");
  await prisma.user.deleteMany({
    where: { role: { in: ["grower", "supplier"] } },
  });

  // Delete suppliers
  console.log("  Deleting suppliers...");
  await prisma.supplier.deleteMany();

  console.log("  Clean complete.");

  // ─── STEP 2: PARSE & CREATE SUPPLIERS ─────────────────────
  logStep("Step 2: Creating suppliers from CSV");

  const supplierRows = parseCSV(CSV_FILES.suppliers);
  console.log(`  Parsed ${supplierRows.length} supplier rows from CSV`);

  // Ensure at least one company exists for branding
  let defaultCompany = await prisma.company.findFirst({ where: { slug: "coloriginz" } });
  if (!defaultCompany) {
    defaultCompany = await prisma.company.create({
      data: {
        name: "Coloriginz",
        slug: "coloriginz",
        logoUrl: "/logos/coloriginz.png",
        emailFrom: "noreply@coloriginz.com",
        emailName: "Coloriginz Grower Portal",
        footerText: "Coloriginz — OZ Import BV, Aalsmeer",
      },
    });
    console.log("  Created default company: Coloriginz");
  }

  // Map fabricId → supplierId (UUID) for later lookups
  const supplierByFabricId = new Map<number, string>();
  const supplierByCode = new Map<string, string>();

  // Batch create suppliers
  let supplierCount = 0;
  for (const row of supplierRows) {
    const code = row["Code"]?.trim();
    const name = row["Naam"]?.trim();
    const fabricId = parseInt2(row["ID"]);

    if (!code || !name || fabricId === null) {
      console.warn(`  SKIP supplier row: missing code/name/id`, row);
      continue;
    }

    try {
      const supplier = await prisma.supplier.create({
        data: {
          code,
          name,
          fabricId,
          accountManagerName: strOrNull(row["AM Naam"]),
          accountManagerCode: strOrNull(row["AM Code"]),
          companyId: defaultCompany.id,
        },
      });
      supplierByFabricId.set(fabricId, supplier.id);
      supplierByCode.set(code, supplier.id);
      supplierCount++;
    } catch (err: any) {
      // Handle duplicate code (shouldn't happen per our analysis)
      if (err.code === "P2002") {
        console.warn(`  SKIP duplicate supplier code: ${code}`);
      } else {
        throw err;
      }
    }

    logProgress(supplierCount, supplierRows.length, "suppliers");
  }
  console.log(`  Created ${supplierCount} suppliers`);

  // ─── STEP 3: PARSE PARTIJEN CSV → CREATE SALESSHEETS + LOTS ──
  logStep("Step 3: Creating salessheets and lots from partijen CSV");

  const partijRows = parseCSV(CSV_FILES.partijen);
  console.log(`  Parsed ${partijRows.length} partij rows from CSV`);

  // Group rows by part_id to merge correction rows with main rows
  // Duplicate part_id rows: one has reden_id_correctie (correction), one has colli/volume
  const partijByPartId = new Map<number, Record<string, string>[]>();
  for (const row of partijRows) {
    const partId = parseInt2(row["part_id"]);
    if (partId === null) continue;
    if (!partijByPartId.has(partId)) partijByPartId.set(partId, []);
    partijByPartId.get(partId)!.push(row);
  }

  // Group by parthdr_id → SalesSheet
  // First, collect unique parthdr_ids and their associated supplier
  const parthdrsMap = new Map<number, { supplierId: string; rows: Record<string, string>[][]; invoiceNumber: string | null; deliveryDate: Date | null }>();

  for (const [partId, rows] of partijByPartId) {
    const firstRow = rows[0];
    const parthdrId = parseInt2(firstRow["parthdr_id"]);
    const relIdLeverancier = parseInt2(firstRow["rel_id_leverancier"]);

    if (parthdrId === null || relIdLeverancier === null) continue;

    const supplierId = supplierByFabricId.get(relIdLeverancier);
    if (!supplierId) continue; // supplier not in our data

    if (!parthdrsMap.has(parthdrId)) {
      parthdrsMap.set(parthdrId, {
        supplierId,
        rows: [],
        invoiceNumber: strOrNull(firstRow["Inkoop Factuur Nummer"]),
        deliveryDate: parseDate(firstRow["Lever Datum/Tijd"]),
      });
    }
    parthdrsMap.get(parthdrId)!.rows.push(rows);
  }

  console.log(`  Unique parthdr_ids (salessheets): ${parthdrsMap.size}`);
  console.log(`  Unique part_ids (lots): ${partijByPartId.size}`);

  // Create SalesSheets and Lots
  const salesSheetByParthdrId = new Map<number, string>(); // parthdr_id → salesSheet UUID
  const lotByPartId = new Map<number, string>(); // part_id → lot UUID
  const lotSupplierByPartId = new Map<number, string>(); // part_id → supplierId
  let salesSheetCount = 0;
  let lotCount = 0;
  let skippedLots = 0;

  // Track used invoiceNumbers to handle empty/duplicate values
  const usedInvoiceNumbers = new Set<string>();

  for (const [parthdrId, info] of parthdrsMap) {
    // Determine invoice number - must be unique
    let invoiceNumber = info.invoiceNumber;
    if (!invoiceNumber || invoiceNumber === "" || invoiceNumber === "xxx" || invoiceNumber === "volgt" || invoiceNumber === "test" || invoiceNumber === "restpartijen") {
      // Generate a synthetic invoice number for incomplete data
      invoiceNumber = `FABRIC-${parthdrId}`;
    }

    // Ensure uniqueness
    if (usedInvoiceNumbers.has(invoiceNumber)) {
      invoiceNumber = `${invoiceNumber}-${parthdrId}`;
    }
    usedInvoiceNumbers.add(invoiceNumber);

    const deliveryDate = info.deliveryDate ?? new Date();

    try {
      const salesSheet = await prisma.salesSheet.create({
        data: {
          invoiceNumber,
          fabricParthdrId: parthdrId,
          supplierId: info.supplierId,
          invoiceDate: deliveryDate,
          deliveryDate,
          totalTurnover: 0,
          totalCosts: 0,
          netResult: 0,
        },
      });
      salesSheetByParthdrId.set(parthdrId, salesSheet.id);
      salesSheetCount++;
    } catch (err: any) {
      if (err.code === "P2002") {
        console.warn(`  SKIP duplicate salessheet for parthdr_id: ${parthdrId}`);
        continue;
      }
      throw err;
    }

    // Create lots for this salessheet
    const salesSheetId = salesSheetByParthdrId.get(parthdrId)!;

    for (const lotRows of info.rows) {
      // Merge multiple rows for the same part_id
      const mainRow = lotRows[0]; // use first row as base
      const partId = parseInt2(mainRow["part_id"])!;
      const lotNumber = mainRow["Partijnummer"]?.trim();

      if (!lotNumber) {
        skippedLots++;
        continue;
      }

      // Merge correction and main data across rows
      let correctionReasonId: number | null = null;
      let invoicedColli: number | null = null;
      let invoicedVolume: number | null = null;
      let correctionVolume: number | null = null;

      for (const r of lotRows) {
        const redenId = parseInt2(r["reden_id_correctie"]);
        if (redenId !== null) correctionReasonId = redenId;

        const ic = parseInt2(r["Inkoopfactuur colli"]);
        if (ic !== null) invoicedColli = ic;

        const iv = parseInt2(r["Inkoopfactuur volume"]);
        if (iv !== null) invoicedVolume = iv;

        const cv = parseInt2(r["Inslagcorrectie volume"]);
        if (cv !== null) correctionVolume = cv;
      }

      const productName = mainRow["Artikel Naam"]?.trim() || "Unknown";
      const articleCode = strOrNull(mainRow["Artikel Code"]);
      const purchaseType = strOrNull(mainRow["Inkooptype Code"]);
      const s1 = strOrNull(mainRow["S01"]);
      const s2 = strOrNull(mainRow["S02"]);
      const s3 = strOrNull(mainRow["S03"]);
      const artId = parseInt2(mainRow["art_id"]);
      const delivDate = parseDate(mainRow["Lever Datum/Tijd"]) ?? deliveryDate;

      // Derive stemLength from S01 (usually stem length in cm)
      const stemLength = parseInt2(mainRow["S01"]) ?? 0;

      // Use invoicedColli as colli if available, otherwise 0
      const colli = invoicedColli ?? 0;

      // totalStems from invoicedVolume (actual received volume)
      const totalStems = invoicedVolume ?? 0;

      try {
        const lot = await prisma.lot.create({
          data: {
            lotNumber: String(lotNumber),
            refNumber: String(lotNumber),
            fabricPartId: partId,
            fabricParthdrId: parthdrId,
            supplierId: info.supplierId,
            salesSheetId,
            articleCode,
            productName,
            articleGroup: deriveArticleGroup(productName),
            purchaseType,
            fabricArticleId: artId,
            colli,
            stemLength,
            totalStems,
            avgPrice: 0,
            totalAmount: 0,
            deliveryDate: delivDate,
            status: "sold",
            s1,
            s2,
            s3,
            correctionReasonId,
            invoicedColli,
            invoicedVolume,
            correctionVolume,
          },
        });
        lotByPartId.set(partId, lot.id);
        lotSupplierByPartId.set(partId, info.supplierId);
        lotCount++;
      } catch (err: any) {
        if (err.code === "P2002") {
          // Duplicate lot - could be lotNumber+supplierId or fabricPartId unique
          skippedLots++;
        } else {
          throw err;
        }
      }
    }

    logProgress(salesSheetCount, parthdrsMap.size, "salessheets");
  }

  console.log(`  Created ${salesSheetCount} salessheets`);
  console.log(`  Created ${lotCount} lots (${skippedLots} skipped)`);

  // ─── STEP 4: PARSE ORDERS CSV → CREATE TRANSACTIONS + GROWERS ──
  logStep("Step 4: Creating transactions and growers from orders CSV");

  const orderRows = parseCSV(CSV_FILES.orders);
  console.log(`  Parsed ${orderRows.length} order rows from CSV`);

  // First pass: collect unique (rel_id_kweker, rel_id_leverancier) pairs → create Grower records
  const growerPairs = new Map<string, { fabricKwekerId: number; supplierId: string }>();

  for (const row of orderRows) {
    const relIdKweker = parseInt2(row["rel_id_kweker"]);
    const relIdLeverancier = parseInt2(row["rel_id_leverancier"]);
    if (relIdKweker === null || relIdLeverancier === null) continue;

    const supplierId = supplierByFabricId.get(relIdLeverancier);
    if (!supplierId) continue;

    const key = `${relIdKweker}`;
    if (!growerPairs.has(key)) {
      growerPairs.set(key, { fabricKwekerId: relIdKweker, supplierId });
    }
  }

  console.log(`  Unique growers (kwekers): ${growerPairs.size}`);

  // Create Grower records
  const growerByFabricId = new Map<number, string>(); // fabricKwekerId → grower UUID
  let growerCount = 0;

  for (const [, info] of growerPairs) {
    try {
      const grower = await prisma.grower.create({
        data: {
          fabricId: info.fabricKwekerId,
          supplierId: info.supplierId,
        },
      });
      growerByFabricId.set(info.fabricKwekerId, grower.id);
      growerCount++;
    } catch (err: any) {
      if (err.code === "P2002") {
        // Duplicate fabricId — find existing
        const existing = await prisma.grower.findUnique({ where: { fabricId: info.fabricKwekerId } });
        if (existing) growerByFabricId.set(info.fabricKwekerId, existing.id);
      } else {
        throw err;
      }
    }
  }
  console.log(`  Created ${growerCount} grower (kweker) records`);

  // Second pass: create transactions
  let txCount = 0;
  let txSkipped = 0;

  // Batch transactions for createMany (better perf than individual creates)
  const txBatch: {
    lotId: string;
    fabricOrdregId: number | null;
    fabricGrowerId: number | null;
    date: Date;
    salesType: string;
    stems: number;
    pricePerStem: number;
    amount: number;
  }[] = [];

  for (let i = 0; i < orderRows.length; i++) {
    const row = orderRows[i];
    const partId = parseInt2(row["part_id"]);
    const ordregId = parseInt2(row["ordreg_id"]);
    const relIdKweker = parseInt2(row["rel_id_kweker"]);
    const date = parseDate(row["_datum_key_vertrek"]);

    if (partId === null || date === null) {
      txSkipped++;
      continue;
    }

    const lotId = lotByPartId.get(partId);
    if (!lotId) {
      txSkipped++;
      continue;
    }

    const salesType = row["Verkooptype"]?.trim() || "Unknown";
    const stems = parseInt2(row["Verkoopvolume"]) ?? 0;
    const amount = parseDecimal(row["Afrekenomzet"]) ?? 0;
    const pricePerStem = parseDecimal(row["Gem afrekenprijs"]) ?? 0;

    txBatch.push({
      lotId,
      fabricOrdregId: ordregId,
      fabricGrowerId: relIdKweker,
      date,
      salesType,
      stems,
      pricePerStem: Math.round(pricePerStem * 10000) / 10000,
      amount: Math.round(amount * 100) / 100,
    });

    // Flush batch every 500 rows
    if (txBatch.length >= 500) {
      // createMany does not support unique constraint skip out of the box,
      // so we handle duplicates by using skipDuplicates
      await prisma.transaction.createMany({
        data: txBatch.map((t) => ({
          lotId: t.lotId,
          fabricOrdregId: t.fabricOrdregId,
          fabricGrowerId: t.fabricGrowerId,
          date: t.date,
          salesType: t.salesType,
          stems: t.stems,
          pricePerStem: t.pricePerStem,
          amount: t.amount,
        })),
        skipDuplicates: true,
      });
      txCount += txBatch.length;
      txBatch.length = 0;
      logProgress(txCount, orderRows.length, "transactions");
    }
  }

  // Flush remaining
  if (txBatch.length > 0) {
    await prisma.transaction.createMany({
      data: txBatch.map((t) => ({
        lotId: t.lotId,
        fabricOrdregId: t.fabricOrdregId,
        fabricGrowerId: t.fabricGrowerId,
        date: t.date,
        salesType: t.salesType,
        stems: t.stems,
        pricePerStem: t.pricePerStem,
        amount: t.amount,
      })),
      skipDuplicates: true,
    });
    txCount += txBatch.length;
  }

  console.log(`  Created ${txCount} transactions (${txSkipped} skipped - missing lot/date)`);

  // Link lots to growers based on transaction data
  logStep("Step 4b: Linking lots to growers and updating lot aggregates");

  // Collect per-lot grower assignments and aggregates from order rows
  const lotGrower = new Map<string, string>(); // lotId → growerId
  const lotAggregates = new Map<string, { totalStems: number; totalAmount: number }>();

  for (const row of orderRows) {
    const partId = parseInt2(row["part_id"]);
    const relIdKweker = parseInt2(row["rel_id_kweker"]);
    if (partId === null) continue;

    const lotId = lotByPartId.get(partId);
    if (!lotId) continue;

    // Set grower link
    if (relIdKweker !== null) {
      const growerId = growerByFabricId.get(relIdKweker);
      if (growerId && !lotGrower.has(lotId)) {
        lotGrower.set(lotId, growerId);
      }
    }

    // Accumulate aggregates
    const stems = parseInt2(row["Verkoopvolume"]) ?? 0;
    const amount = parseDecimal(row["Afrekenomzet"]) ?? 0;

    if (!lotAggregates.has(lotId)) {
      lotAggregates.set(lotId, { totalStems: 0, totalAmount: 0 });
    }
    const agg = lotAggregates.get(lotId)!;
    agg.totalStems += stems;
    agg.totalAmount += amount;
  }

  // Update lots with grower links and aggregated totals
  let lotUpdates = 0;
  for (const [lotId, agg] of lotAggregates) {
    const growerId = lotGrower.get(lotId) ?? null;
    const avgPrice = agg.totalStems > 0 ? agg.totalAmount / agg.totalStems : 0;

    // Only update totalStems/totalAmount from orders if we have order data
    // (lots without orders keep their partij-based values)
    const updateData: Record<string, any> = {};
    if (agg.totalStems > 0) {
      updateData.totalStems = agg.totalStems;
      updateData.totalAmount = Math.round(agg.totalAmount * 100) / 100;
      updateData.avgPrice = Math.round(avgPrice * 10000) / 10000;
    }
    if (growerId) {
      updateData.growerId = growerId;
    }

    if (Object.keys(updateData).length > 0) {
      await prisma.lot.update({
        where: { id: lotId },
        data: updateData,
      });
      lotUpdates++;
    }

    logProgress(lotUpdates, lotAggregates.size, "lots updated");
  }
  console.log(`  Updated ${lotUpdates} lots with grower links and aggregates`);

  // ─── STEP 5: PARSE SHCOSTS CSV → CREATE SALESSHEETCOSTS ──
  logStep("Step 5: Creating salessheet costs from shcosts CSV");

  const shcostRows = parseCSV(CSV_FILES.shcosts);
  console.log(`  Parsed ${shcostRows.length} shcost rows from CSV`);

  let costCount = 0;
  let costSkipped = 0;

  // Batch for createMany
  const costBatch: {
    salesSheetId: string;
    description: string;
    amount: number;
    fabricShkostId: number | null;
    fabricKostId: number | null;
    costTypeCode: string | null;
    costTypeName: string | null;
    totalTurnover: number | null;
    totalQuantity: number | null;
  }[] = [];

  for (let i = 0; i < shcostRows.length; i++) {
    const row = shcostRows[i];
    const parthdrId = parseInt2(row["Parthdr ID"]);
    const shkostId = parseInt2(row["Shkost ID"]);

    if (parthdrId === null) {
      costSkipped++;
      continue;
    }

    const salesSheetId = salesSheetByParthdrId.get(parthdrId);
    if (!salesSheetId) {
      costSkipped++;
      continue;
    }

    const description = row["Kost Naam"]?.trim() || "Unknown cost";
    const amount = parseDecimal(row["Salesheet Amount"]) ?? 0;
    const kostId = parseInt2(row["Kost ID"]);
    const costTypeCode = strOrNull(row["Kost Type Code"]);
    const costTypeName = strOrNull(row["Kost Type Naam"]);
    const totalTurnover = parseDecimal(row["Totaal Omzet"]);
    const totalQuantity = parseInt2(row["Totaal Aantal"]);

    costBatch.push({
      salesSheetId,
      description,
      amount: Math.round(amount * 100) / 100,
      fabricShkostId: shkostId,
      fabricKostId: kostId,
      costTypeCode,
      costTypeName,
      totalTurnover: totalTurnover !== null ? Math.round(totalTurnover * 100) / 100 : null,
      totalQuantity,
    });

    // Flush batch
    if (costBatch.length >= 500) {
      await prisma.salesSheetCost.createMany({
        data: costBatch.map((c) => ({
          salesSheetId: c.salesSheetId,
          description: c.description,
          amount: c.amount,
          fabricShkostId: c.fabricShkostId,
          fabricKostId: c.fabricKostId,
          costTypeCode: c.costTypeCode,
          costTypeName: c.costTypeName,
          totalTurnover: c.totalTurnover,
          totalQuantity: c.totalQuantity,
        })),
        skipDuplicates: true,
      });
      costCount += costBatch.length;
      costBatch.length = 0;
      logProgress(costCount, shcostRows.length, "costs");
    }
  }

  // Flush remaining
  if (costBatch.length > 0) {
    await prisma.salesSheetCost.createMany({
      data: costBatch.map((c) => ({
        salesSheetId: c.salesSheetId,
        description: c.description,
        amount: c.amount,
        fabricShkostId: c.fabricShkostId,
        fabricKostId: c.fabricKostId,
        costTypeCode: c.costTypeCode,
        costTypeName: c.costTypeName,
        totalTurnover: c.totalTurnover,
        totalQuantity: c.totalQuantity,
      })),
      skipDuplicates: true,
    });
    costCount += costBatch.length;
  }

  console.log(`  Created ${costCount} salessheet costs (${costSkipped} skipped - no matching salessheet)`);

  // ─── STEP 5b: RECALCULATE SALESSHEET TOTALS ──────────────
  logStep("Step 5b: Recalculating salessheet totals");

  // For each salessheet, sum lot amounts as turnover and costs from SalesSheetCost
  let ssUpdated = 0;
  for (const [parthdrId, salesSheetId] of salesSheetByParthdrId) {
    // Sum lot totals
    const lotAgg = await prisma.lot.aggregate({
      where: { salesSheetId },
      _sum: { totalAmount: true },
    });
    const totalTurnover = Number(lotAgg._sum.totalAmount ?? 0);

    // Sum costs
    const costAgg = await prisma.salesSheetCost.aggregate({
      where: { salesSheetId },
      _sum: { amount: true },
    });
    const totalCosts = Number(costAgg._sum.amount ?? 0);

    // Find earliest and latest dates from shcosts for this salessheet
    const shcostForSS = shcostRows.filter((r) => parseInt2(r["Parthdr ID"]) === parthdrId);
    let lastReceiptDate: Date | null = null;
    let lastRegistrationDate: Date | null = null;
    for (const r of shcostForSS) {
      const rd = parseDate(r["Laatste Ontvangstdatum"]);
      const ad = parseDate(r["Laatste Aanmelddatum"]);
      if (rd && (!lastReceiptDate || rd > lastReceiptDate)) lastReceiptDate = rd;
      if (ad && (!lastRegistrationDate || ad > lastRegistrationDate)) lastRegistrationDate = ad;
    }

    await prisma.salesSheet.update({
      where: { id: salesSheetId },
      data: {
        totalTurnover: Math.round(totalTurnover * 100) / 100,
        totalCosts: Math.round(totalCosts * 100) / 100,
        netResult: Math.round((totalTurnover - totalCosts) * 100) / 100,
        lastReceiptDate,
        lastRegistrationDate,
      },
    });
    ssUpdated++;
    logProgress(ssUpdated, salesSheetByParthdrId.size, "salessheets recalculated");
  }
  console.log(`  Recalculated ${ssUpdated} salessheet totals`);

  // ─── STEP 6: CREATE TEST USER ACCOUNTS ────────────────────
  logStep("Step 6: Creating test user accounts for suppliers");

  const supplierPasswordHash = await hash("GreenField99", 12);

  // Pick a few well-known suppliers to create login accounts for
  // Use the first 5 suppliers that have lots with transactions (i.e., real data)
  const suppliersWithData = await prisma.supplier.findMany({
    where: {
      lots: {
        some: {
          transactions: {
            some: {},
          },
        },
      },
    },
    take: 10,
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true },
  });

  let userCount = 0;
  for (const supplier of suppliersWithData) {
    const email = `${supplier.code.toLowerCase()}@example.com`;

    try {
      await prisma.user.create({
        data: {
          email,
          passwordHash: supplierPasswordHash,
          name: supplier.name,
          role: "supplier",
          isActive: true,
          supplierId: supplier.id,
        },
      });
      userCount++;
      console.log(`  Created user: ${email} (${supplier.code} - ${supplier.name})`);
    } catch (err: any) {
      if (err.code === "P2002") {
        console.warn(`  SKIP duplicate user email: ${email}`);
      } else {
        throw err;
      }
    }
  }
  console.log(`  Created ${userCount} supplier user accounts`);

  // ─── SUMMARY ──────────────────────────────────────────────
  logStep("Seed complete - Summary");

  const counts = {
    suppliers: await prisma.supplier.count(),
    growers: await prisma.grower.count(),
    users: await prisma.user.count(),
    salesSheets: await prisma.salesSheet.count(),
    lots: await prisma.lot.count(),
    transactions: await prisma.transaction.count(),
    salesSheetCosts: await prisma.salesSheetCost.count(),
    companies: await prisma.company.count(),
  };

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`  ${counts.companies} companies`);
  console.log(`  ${counts.suppliers} suppliers`);
  console.log(`  ${counts.growers} growers (kwekers)`);
  console.log(`  ${counts.users} users`);
  console.log(`  ${counts.salesSheets} salessheets`);
  console.log(`  ${counts.lots} lots`);
  console.log(`  ${counts.transactions} transactions`);
  console.log(`  ${counts.salesSheetCosts} salessheet costs`);
  console.log(`\n  Time: ${elapsed}s`);

  if (suppliersWithData.length > 0) {
    console.log(`\n  Sample login credentials (password: GreenField99):`);
    for (const s of suppliersWithData) {
      console.log(`    ${s.code.toLowerCase()}@example.com`);
    }
  }

  console.log(`\n  Existing admin/commercie/finance/transporteur accounts are preserved.`);
}

main()
  .catch((e) => {
    console.error("\nSeed failed with error:");
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
