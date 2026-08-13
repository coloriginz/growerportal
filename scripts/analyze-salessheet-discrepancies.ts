/**
 * Analyze discrepancies between sales sheet PDFs and database records.
 *
 * Picks ~25 successfully imported PDFs, parses their full content,
 * queries the database for matching records, and compares.
 *
 * Usage: npx tsx scripts/analyze-salessheet-discrepancies.ts
 */
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PrismaClient } from "../src/generated/prisma";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();
const BASE_DIR = path.join(__dirname, "..", "private_input", "salessheets");

// ── PDF Text Extraction ──────────────────────────────────────────────

async function extractPages(pdfPath: string): Promise<string[]> {
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await getDocument({ data, useSystemFonts: true, verbosity: 0 }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let text = "";
    for (const item of content.items as any[]) {
      if (item.str) text += item.str;
      if (item.hasEOL) text += "\n";
    }
    pages.push(text);
  }
  return pages;
}

// ── PDF Content Parsing ──────────────────────────────────────────────

interface PdfLot {
  lotNumber: number;
  colli: number;
  stemsPerUnit: number;
  productName: string;
  stemLength: number;
  totalStems: number;
  avgPrice: number;
  totalAmount: number;
  s1: string;
  s2: string;
  transactions: PdfTransaction[];
}

interface PdfTransaction {
  stems: number;
  date: string;
  salesType: string;
  pricePerStem: number;
  amount: number;
}

interface PdfCost {
  description: string;
  amount: number;
}

interface PdfSalesSheet {
  invoiceNumber: string;
  ourInvoiceNumber: string;
  totalTurnover: number;
  totalCosts: number;
  netResult: number;
  deliveryTotalStems: number;
  deliveryTotalColli: number;
  lots: PdfLot[];
  costs: PdfCost[];
  corrections: number;
}

function parseDutchNumber(s: string): number {
  // "1.805,15" → 1805.15, "0,134" → 0.134
  return parseFloat(s.replace(/\./g, "").replace(",", "."));
}

function parsePdfContent(pages: string[]): PdfSalesSheet {
  const allText = pages.join("\n");

  // Extract invoice numbers from header
  // Pattern: reference number appears near "Invoice number" / "Factuurnummer"
  let invoiceNumber = "";
  let ourInvoiceNumber = "";

  // The reference and our-invoice appear as standalone numbers near "INVOICE"/"FACTUUR"
  // They appear as two consecutive standalone number lines
  const invoiceMatch = allText.match(/(?:Invoice number|Factuurnummer)\s*\n?([\s\S]*?)(?:VAT|GGN)/);
  if (invoiceMatch) {
    // Look for the two numbers that appear before these labels
    // They're typically on standalone lines like "184-21\n395158\n"
  }

  // More reliable: find the reference number pattern in all text
  // The reference appears near the top, as a standalone line
  const refPatterns = allText.match(/\n(\d[\d-]+)\n(\d{6})\n/);
  if (refPatterns) {
    invoiceNumber = refPatterns[1];
    ourInvoiceNumber = refPatterns[2];
  }

  // ── Parse cost summary (page 1) ──
  const costs: PdfCost[] = [];
  let totalTurnover = 0;
  let totalCosts = 0;
  let netResult = 0;

  // English: "€ 1.896,65Total nett turnover" or "€ 11.021,02Totale netto omzet"
  const turnoverMatch = allText.match(/€\s*([\d.,]+)\s*(?:Total nett turnover|Totale netto omzet)/);
  if (turnoverMatch) {
    totalTurnover = parseDutchNumber(turnoverMatch[1]);
  }

  // English: "Total costs € 370,41" or "Totaal kosten € 1.459,58"
  const totalCostsMatch = allText.match(/(?:Total costs|Totaal kosten)\s*€\s*([\d.,]+)/);
  if (totalCostsMatch) {
    totalCosts = parseDutchNumber(totalCostsMatch[1]);
  }

  // English: "€ 1.526,24To be received by supplier" or net result line
  const netMatch = allText.match(/€\s*([\d.,]+)\s*(?:To be received by supplier|Subtotaal)/);
  if (netMatch) {
    netResult = parseDutchNumber(netMatch[1]);
  }
  // For COLX format with "Netto te betalen" — try that too
  if (netResult === 0) {
    const netMatch2 = allText.match(/€\s*([\d.,]+)\s*(?:Netto|Net amount)/i);
    if (netMatch2) netResult = parseDutchNumber(netMatch2[1]);
  }

  // Parse individual cost lines
  // English format: "Commission direct sales 189,67"
  // Dutch format: "Commissie directe verkoop 1.072,25"
  const costPatterns = [
    /^(Container rental|Fusthuur\s*\w*)\s+([\d.,]+)$/gm,
    /^(Customers? Clearing|Klanten?\s*Clearing)\s+([\d.,]+)$/gm,
    /^(Distribution Costs?|Distributiekosten)\s+([\d.,]+)$/gm,
    /^(Handling charges?|Verwerkingskosten)\s+([\d.,]+)$/gm,
    /^(Waste tax|Afvalheffing)\s+([\d.,]+)$/gm,
    /^(Admin\.?\/?\.?Price information|Administratie\s*kosten)\s+([\d.,]+)$/gm,
    /^(Commission direct sales?|Commissie directe verkoop)\s+([\d.,]+)$/gm,
    /^(Transaction levy|Transactie heffing)\s+([\d.,]+)$/gm,
    /^(Commission auction|Commissie veiling\w*)\s+([\d.,]+)$/gm,
  ];
  for (const pat of costPatterns) {
    let m;
    while ((m = pat.exec(allText)) !== null) {
      costs.push({ description: m[1].trim(), amount: parseDutchNumber(m[2]) });
    }
  }
  // Fallback: generic cost line pattern — "Description 123,45" (only if few costs found)
  if (costs.length < 3) {
    const genericCost = /^([A-Z][\w\s.\/]+?)\s+([\d]+[.,]\d{2})$/gm;
    let m;
    while ((m = genericCost.exec(pages[0])) !== null) {
      const desc = m[1].trim();
      // Skip turnover lines and totals
      if (/total|omzet|turnover|received|supplier|leverancier|subtotaal|betalen|netto/i.test(desc)) continue;
      if (/direct|production|veiling|auction|VBA|VPL/i.test(desc)) continue;
      costs.push({ description: desc, amount: parseDutchNumber(m[2]) });
    }
  }

  // ── Parse lot/transaction details (page 2+) ──
  const lots: PdfLot[] = [];

  // Lot header pattern (EN): "Lot 3846782 3 X 400 Dianthus Br Amazon Neon Purple 55 0,134 1.200 COLSPRIN 12"
  // Lot header pattern (NL): "Partij 3881572 22 X 40 Ranunculus Romance Hydra 50 25 1,170 880 MONARNL 23"
  // General: "Lot/Partij <lotNumber> <colli> X <stemsPerUnit> <productName> <stemLength> [s2] <avgPrice> <totalStems> <s1> <s2again>"
  const lotHeaderRe = /(?:Lot|Partij)\s+(\d+)\s+(\d+)\s+X\s+(\d+)\s+(.+?)(?:\s+)([\d.,]+)\s*([A-Z]{2,}[\w]*)\s+(\d+)/g;

  // We need a more robust approach. Let me parse line by line.
  const transactionPages = pages.slice(1).join("\n"); // Skip page 1 (costs)

  // Split into lot blocks: each starts with "Lot " or "Partij "
  const lotBlocks = transactionPages.split(/(?=(?:Lot|Partij)\s+\d)/);

  for (const block of lotBlocks) {
    const lotMatch = block.match(/^(?:Lot|Partij)\s+(\d+)\s+(\d+)\s+X\s+(\d+)\s+(.+)/);
    if (!lotMatch) continue;

    const lotNumber = parseInt(lotMatch[1]);
    const colli = parseInt(lotMatch[2]);
    const stemsPerUnit = parseInt(lotMatch[3]);
    const restOfFirstLine = lotMatch[4];

    // Parse the rest of the first line for product name, stem length, etc.
    // The text after product name contains: stemLength [s2] avgPrice totalStems s1 s2
    // But product names can contain numbers, so we need to be careful
    // Strategy: find the last numeric fields from the end
    const firstLineTokens = restOfFirstLine.trim().split(/\s+/);

    // From the end: s2(num), s1(alpha), totalStems(num with dots), avgPrice(num with comma), maybe s2-quality(num), stemLength(num)
    // Let's try to extract from right to left
    let s1 = "", s2 = "";
    let totalStems = 0, avgPrice = 0, stemLength = 0;
    let productName = "";

    // Work backwards through tokens
    const tokens = [...firstLineTokens];
    // Last token is likely s2 (a number like "12" or "23")
    if (tokens.length > 0 && /^\d{1,3}$/.test(tokens[tokens.length - 1])) {
      s2 = tokens.pop()!;
    }
    // Next is s1 (alphanumeric like "COLSPRIN" or "MONARNL")
    if (tokens.length > 0 && /^[A-Z]+\d*$/i.test(tokens[tokens.length - 1])) {
      s1 = tokens.pop()!;
    }
    // Next is totalStems (can have dots like "1.200")
    if (tokens.length > 0 && /^[\d.]+$/.test(tokens[tokens.length - 1])) {
      totalStems = parseDutchNumber(tokens.pop()!);
    }
    // Next is avgPrice (has comma like "0,134")
    if (tokens.length > 0 && /^\d+,\d+$/.test(tokens[tokens.length - 1])) {
      avgPrice = parseDutchNumber(tokens.pop()!);
    }
    // Next might be another number (s2 quality like "25") then stemLength
    // Or directly stemLength
    // Check: if last remaining token is a small number (20-100), it's stemLength
    // But there could be two numbers: stemLength and s2-quality
    // Let's handle: the remaining tokens end with 1-2 pure numbers
    const trailingNums: string[] = [];
    while (tokens.length > 0 && /^\d+$/.test(tokens[tokens.length - 1])) {
      trailingNums.unshift(tokens.pop()!);
    }
    if (trailingNums.length >= 1) {
      stemLength = parseInt(trailingNums[0]);
    }

    productName = tokens.join(" ");

    // Parse transactions from remaining lines
    const transactions: PdfTransaction[] = [];
    const lines = block.split("\n").slice(1); // skip first (header) line
    let lotTotalAmount = 0;

    for (const line of lines) {
      // Transaction line patterns:
      // EN: "600 05-01-2026 Direct sales 0,140 84,00"
      // NL: "880 02-03-2026 Directe verkopen 1,170 1.029,36"
      // Also: "-200 03-01-2026 Handling: more in box 0,000 0,00"
      // Also: "120 02-03-2026 Retour van klant door inferieure kwaliteit 0,000 0,00"
      const txMatch = line.match(/^\s*(-?[\d.]+)\s*(\d{2}-\d{2}-\d{4})\s+(.+?)\s+(\d+,\d+)\s+([\d.,]+)\s*$/);
      if (txMatch) {
        const stems = parseDutchNumber(txMatch[1]);
        transactions.push({
          stems,
          date: txMatch[2],
          salesType: txMatch[3].trim(),
          pricePerStem: parseDutchNumber(txMatch[4]),
          amount: parseDutchNumber(txMatch[5]),
        });
      }

      // Lot subtotal line: "160,20 1.200 0,134"
      const subtotalMatch = line.match(/^\s*([\d.,]+)\s+([\d.]+)\s+(\d+,\d+)\s*$/);
      if (subtotalMatch && !txMatch) {
        lotTotalAmount = parseDutchNumber(subtotalMatch[1]);
      }
    }

    lots.push({
      lotNumber,
      colli,
      stemsPerUnit,
      productName,
      stemLength,
      totalStems,
      avgPrice,
      totalAmount: lotTotalAmount || transactions.reduce((s, t) => s + t.amount, 0),
      s1,
      s2,
      transactions,
    });
  }

  // Delivery total: "Delivery total 33 8.000 € 1.897" or "Levering totaal 191 7.980 € 11.021"
  let deliveryTotalStems = 0;
  let deliveryTotalColli = 0;
  const deliveryMatch = allText.match(/(?:Delivery total|Levering totaal)\s+(\d+)\s+([\d.]+)\s+€\s*([\d.,]+)/);
  if (deliveryMatch) {
    deliveryTotalColli = parseInt(deliveryMatch[1]);
    deliveryTotalStems = parseDutchNumber(deliveryMatch[2]);
  }

  // Corrections line: "-50" or "-300"
  let corrections = 0;
  const corrMatch = allText.match(/(-?\d+)\s*Correcties|(-?\d+)\s*Corrections/);
  if (corrMatch) {
    corrections = parseInt(corrMatch[1] || corrMatch[2]);
  }

  return {
    invoiceNumber,
    ourInvoiceNumber,
    totalTurnover,
    totalCosts,
    netResult,
    deliveryTotalStems,
    deliveryTotalColli,
    lots,
    costs,
    corrections,
  };
}

// ── Database Query ──────────────────────────────────────────────────

interface DbSalesSheet {
  invoiceNumber: string;
  ourInvoiceNumber: string | null;
  totalTurnover: number;
  totalCosts: number;
  netResult: number;
  lots: {
    lotNumber: string;
    productName: string;
    stemLength: number;
    totalStems: number;
    avgPrice: number;
    totalAmount: number;
    colli: number;
    s1: string | null;
    s2: string | null;
    s3: string | null;
    transactions: {
      salesType: string;
      stems: number;
      pricePerStem: number;
      amount: number;
      date: Date;
    }[];
  }[];
  costs: {
    description: string;
    amount: number;
    costTypeCode: string | null;
  }[];
}

async function getDbSalesSheet(invoiceNumber: string): Promise<DbSalesSheet | null> {
  const ss = await prisma.salesSheet.findUnique({
    where: { invoiceNumber },
    include: {
      lots: {
        include: {
          transactions: {
            orderBy: { date: "asc" },
          },
        },
        orderBy: { lotNumber: "asc" },
      },
      costs: {
        orderBy: { description: "asc" },
      },
    },
  });

  if (!ss) return null;

  return {
    invoiceNumber: ss.invoiceNumber,
    ourInvoiceNumber: ss.ourInvoiceNumber,
    totalTurnover: Number(ss.totalTurnover),
    totalCosts: Number(ss.totalCosts),
    netResult: Number(ss.netResult),
    lots: ss.lots.map((l) => ({
      lotNumber: l.lotNumber,
      productName: l.productName,
      stemLength: l.stemLength,
      totalStems: l.totalStems,
      avgPrice: Number(l.avgPrice),
      totalAmount: Number(l.totalAmount),
      colli: l.colli,
      s1: l.s1,
      s2: l.s2,
      s3: l.s3,
      transactions: l.transactions.map((t) => ({
        salesType: t.salesType,
        stems: t.stems,
        pricePerStem: Number(t.pricePerStem),
        amount: Number(t.amount),
        date: t.date,
      })),
    })),
    costs: ss.costs.map((c) => ({
      description: c.description,
      amount: Number(c.amount),
      costTypeCode: c.costTypeCode,
    })),
  };
}

// ── Comparison ──────────────────────────────────────────────────────

interface Discrepancy {
  field: string;
  pdfValue: any;
  dbValue: any;
  diff?: number;
  note?: string;
}

function compare(pdf: PdfSalesSheet, db: DbSalesSheet): Discrepancy[] {
  const disc: Discrepancy[] = [];
  const TOLERANCE = 0.02; // Allow 2 cent rounding

  // ── SalesSheet level ──
  if (Math.abs(pdf.totalTurnover - db.totalTurnover) > TOLERANCE) {
    disc.push({
      field: "totalTurnover",
      pdfValue: pdf.totalTurnover,
      dbValue: db.totalTurnover,
      diff: pdf.totalTurnover - db.totalTurnover,
    });
  }
  if (Math.abs(pdf.totalCosts - db.totalCosts) > TOLERANCE) {
    disc.push({
      field: "totalCosts",
      pdfValue: pdf.totalCosts,
      dbValue: db.totalCosts,
      diff: pdf.totalCosts - db.totalCosts,
    });
  }
  if (Math.abs(pdf.netResult - db.netResult) > TOLERANCE) {
    disc.push({
      field: "netResult",
      pdfValue: pdf.netResult,
      dbValue: db.netResult,
      diff: pdf.netResult - db.netResult,
    });
  }

  // ── Lot count ──
  if (pdf.lots.length !== db.lots.length) {
    disc.push({
      field: "lotCount",
      pdfValue: pdf.lots.length,
      dbValue: db.lots.length,
      note: pdf.lots.length > db.lots.length ? "DB missing lots" : "DB has extra lots",
    });
  }

  // ── Lot-level comparison ──
  const dbLotMap = new Map(db.lots.map((l) => [l.lotNumber, l]));

  for (const pdfLot of pdf.lots) {
    const dbLot = dbLotMap.get(String(pdfLot.lotNumber));
    if (!dbLot) {
      disc.push({
        field: `lot.${pdfLot.lotNumber}.missing`,
        pdfValue: `${pdfLot.productName} (${pdfLot.totalStems} stems)`,
        dbValue: "NOT FOUND",
        note: "Lot in PDF but not in DB",
      });
      continue;
    }

    // Stems
    if (pdfLot.totalStems !== dbLot.totalStems) {
      disc.push({
        field: `lot.${pdfLot.lotNumber}.totalStems`,
        pdfValue: pdfLot.totalStems,
        dbValue: dbLot.totalStems,
        diff: pdfLot.totalStems - dbLot.totalStems,
      });
    }

    // Amount
    if (Math.abs(pdfLot.totalAmount - dbLot.totalAmount) > TOLERANCE) {
      disc.push({
        field: `lot.${pdfLot.lotNumber}.totalAmount`,
        pdfValue: pdfLot.totalAmount,
        dbValue: dbLot.totalAmount,
        diff: pdfLot.totalAmount - dbLot.totalAmount,
      });
    }

    // Product name
    if (pdfLot.productName.toLowerCase() !== dbLot.productName.toLowerCase()) {
      disc.push({
        field: `lot.${pdfLot.lotNumber}.productName`,
        pdfValue: pdfLot.productName,
        dbValue: dbLot.productName,
      });
    }

    // Stem length
    if (pdfLot.stemLength !== dbLot.stemLength) {
      disc.push({
        field: `lot.${pdfLot.lotNumber}.stemLength`,
        pdfValue: pdfLot.stemLength,
        dbValue: dbLot.stemLength,
      });
    }

    // Transaction count
    if (pdfLot.transactions.length !== dbLot.transactions.length) {
      disc.push({
        field: `lot.${pdfLot.lotNumber}.txCount`,
        pdfValue: pdfLot.transactions.length,
        dbValue: dbLot.transactions.length,
        note: `PDF: ${pdfLot.transactions.map((t) => t.salesType).join(", ")} | DB: ${dbLot.transactions.map((t) => t.salesType).join(", ")}`,
      });
    }

    // Compare individual transactions (by stem count + type)
    for (const pdfTx of pdfLot.transactions) {
      const matchingDbTx = dbLot.transactions.find(
        (t) => t.stems === pdfTx.stems && t.salesType === pdfTx.salesType
      );
      if (!matchingDbTx) {
        // Try fuzzy match on sales type
        const fuzzyMatch = dbLot.transactions.find((t) => t.stems === pdfTx.stems);
        if (fuzzyMatch) {
          disc.push({
            field: `lot.${pdfLot.lotNumber}.tx.salesType`,
            pdfValue: pdfTx.salesType,
            dbValue: fuzzyMatch.salesType,
            note: `${pdfTx.stems} stems`,
          });
        } else {
          disc.push({
            field: `lot.${pdfLot.lotNumber}.tx.missing`,
            pdfValue: `${pdfTx.stems} stems, ${pdfTx.salesType}, €${pdfTx.amount}`,
            dbValue: "NOT FOUND",
          });
        }
      }
    }

    // Check for DB transactions not in PDF
    for (const dbTx of dbLot.transactions) {
      const inPdf = pdfLot.transactions.find(
        (t) => t.stems === dbTx.stems
      );
      if (!inPdf) {
        disc.push({
          field: `lot.${pdfLot.lotNumber}.tx.extraInDb`,
          pdfValue: "NOT IN PDF",
          dbValue: `${dbTx.stems} stems, ${dbTx.salesType}, €${dbTx.amount}`,
        });
      }
    }
  }

  // Check for DB lots not in PDF
  for (const dbLot of db.lots) {
    const inPdf = pdf.lots.find((l) => String(l.lotNumber) === dbLot.lotNumber);
    if (!inPdf) {
      disc.push({
        field: `lot.${dbLot.lotNumber}.extraInDb`,
        pdfValue: "NOT IN PDF",
        dbValue: `${dbLot.productName} (${dbLot.totalStems} stems)`,
        note: "Lot in DB but not in PDF",
      });
    }
  }

  // ── Cost comparison ──
  if (pdf.costs.length !== db.costs.length) {
    disc.push({
      field: "costCount",
      pdfValue: pdf.costs.length,
      dbValue: db.costs.length,
    });
  }

  const pdfCostTotal = pdf.costs.reduce((s, c) => s + c.amount, 0);
  const dbCostTotal = db.costs.reduce((s, c) => s + c.amount, 0);
  if (Math.abs(pdfCostTotal - dbCostTotal) > TOLERANCE) {
    disc.push({
      field: "costTotal(sum of lines)",
      pdfValue: pdfCostTotal,
      dbValue: dbCostTotal,
      diff: pdfCostTotal - dbCostTotal,
    });
  }

  return disc;
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  // Load import log
  const log = JSON.parse(fs.readFileSync(path.join(BASE_DIR, "import-log-2026.json"), "utf8"));
  const okResults = log.results.filter((r: any) => r.status === "OK");

  // Pick diverse sample: spread across suppliers and months
  const bySupplier: Record<string, any[]> = {};
  for (const r of okResults) {
    if (!bySupplier[r.supplier]) bySupplier[r.supplier] = [];
    bySupplier[r.supplier].push(r);
  }

  const sample: any[] = [];
  const suppliers = Object.entries(bySupplier).sort((a: any, b: any) => b[1].length - a[1].length);

  // Take 2-3 from top suppliers, 1 from smaller ones
  for (const [, items] of suppliers) {
    const take = (items as any[]).length > 30 ? 3 : (items as any[]).length > 10 ? 2 : 1;
    // Spread across different months
    const sorted = (items as any[]).sort((a: any, b: any) => a.file.localeCompare(b.file));
    const step = Math.max(1, Math.floor(sorted.length / take));
    for (let i = 0; i < take && i * step < sorted.length; i++) {
      sample.push(sorted[i * step]);
    }
    if (sample.length >= 30) break;
  }

  console.log(`Selected ${sample.length} sales sheets for analysis\n`);
  console.log("=".repeat(80));

  // Track patterns
  const allDiscrepancies: { file: string; ref: string; supplier: string; discrepancies: Discrepancy[] }[] = [];
  const patternCounts: Record<string, number> = {};
  let parseErrors = 0;

  for (const item of sample) {
    const pdfPath = path.join(BASE_DIR, item.file);
    const ref = item.reference;
    const supplier = item.supplier;

    console.log(`\n${"─".repeat(80)}`);
    console.log(`PDF: ${item.file}`);
    console.log(`Reference: ${ref} | Supplier: ${supplier}`);

    // 1. Parse PDF
    let pdf: PdfSalesSheet;
    try {
      const pages = await extractPages(pdfPath);
      pdf = parsePdfContent(pages);
    } catch (err: any) {
      console.log(`  ERROR parsing PDF: ${err.message}`);
      parseErrors++;
      continue;
    }

    // 2. Get DB data
    const db = await getDbSalesSheet(ref);
    if (!db) {
      console.log(`  ERROR: SalesSheet "${ref}" not found in database`);
      continue;
    }

    // 3. Compare
    const discrepancies = compare(pdf, db);

    console.log(`  PDF: ${pdf.lots.length} lots, turnover €${pdf.totalTurnover.toFixed(2)}, costs €${pdf.totalCosts.toFixed(2)}, net €${pdf.netResult.toFixed(2)}`);
    console.log(`  DB:  ${db.lots.length} lots, turnover €${db.totalTurnover.toFixed(2)}, costs €${db.totalCosts.toFixed(2)}, net €${db.netResult.toFixed(2)}`);
    console.log(`  PDF tx count: ${pdf.lots.reduce((s, l) => s + l.transactions.length, 0)} | DB tx count: ${db.lots.reduce((s, l) => s + l.transactions.length, 0)}`);
    console.log(`  PDF cost lines: ${pdf.costs.length} | DB cost lines: ${db.costs.length}`);

    if (discrepancies.length === 0) {
      console.log(`  MATCH`);
    } else {
      console.log(`  ${discrepancies.length} DISCREPANCIES:`);
      for (const d of discrepancies) {
        const diffStr = d.diff !== undefined ? ` (diff: ${d.diff > 0 ? "+" : ""}${d.diff.toFixed(2)})` : "";
        const noteStr = d.note ? ` [${d.note}]` : "";
        console.log(`    - ${d.field}: PDF=${d.pdfValue} | DB=${d.dbValue}${diffStr}${noteStr}`);

        // Track pattern
        const patternKey = d.field.replace(/\.\d+\./g, ".N.").replace(/\d+/g, "N");
        patternCounts[patternKey] = (patternCounts[patternKey] || 0) + 1;
      }
    }

    allDiscrepancies.push({ file: item.file, ref, supplier, discrepancies });
  }

  // ── Summary Report ──
  console.log("\n" + "=".repeat(80));
  console.log("SUMMARY REPORT");
  console.log("=".repeat(80));
  console.log(`Analyzed: ${sample.length} sales sheets`);
  console.log(`Parse errors: ${parseErrors}`);

  const matchCount = allDiscrepancies.filter((d) => d.discrepancies.length === 0).length;
  const mismatchCount = allDiscrepancies.filter((d) => d.discrepancies.length > 0).length;
  console.log(`Perfect matches: ${matchCount}`);
  console.log(`With discrepancies: ${mismatchCount}`);

  console.log("\n─── Discrepancy Patterns (most common) ───");
  const sortedPatterns = Object.entries(patternCounts).sort((a, b) => b[1] - a[1]);
  for (const [pattern, count] of sortedPatterns) {
    console.log(`  ${count}x  ${pattern}`);
  }

  // ── Turnover discrepancies detail ──
  const turnoverDisc = allDiscrepancies.filter((d) =>
    d.discrepancies.some((dd) => dd.field === "totalTurnover")
  );
  if (turnoverDisc.length > 0) {
    console.log("\n─── Turnover Discrepancies ───");
    for (const d of turnoverDisc) {
      const td = d.discrepancies.find((dd) => dd.field === "totalTurnover")!;
      console.log(`  ${d.ref} (${d.supplier}): PDF €${td.pdfValue.toFixed(2)} vs DB €${td.dbValue.toFixed(2)} (diff €${td.diff!.toFixed(2)})`);
    }
  }

  // ── Cost discrepancies detail ──
  const costDisc = allDiscrepancies.filter((d) =>
    d.discrepancies.some((dd) => dd.field === "totalCosts" || dd.field === "costCount")
  );
  if (costDisc.length > 0) {
    console.log("\n─── Cost Discrepancies ───");
    for (const d of costDisc) {
      const cd = d.discrepancies.find((dd) => dd.field === "totalCosts");
      const cc = d.discrepancies.find((dd) => dd.field === "costCount");
      let msg = `  ${d.ref} (${d.supplier}):`;
      if (cd) msg += ` amount PDF €${cd.pdfValue.toFixed(2)} vs DB €${cd.dbValue.toFixed(2)}`;
      if (cc) msg += ` lines PDF ${cc.pdfValue} vs DB ${cc.dbValue}`;
      console.log(msg);
    }
  }

  // ── Lot count discrepancies ──
  const lotDisc = allDiscrepancies.filter((d) =>
    d.discrepancies.some((dd) => dd.field === "lotCount")
  );
  if (lotDisc.length > 0) {
    console.log("\n─── Lot Count Discrepancies ───");
    for (const d of lotDisc) {
      const ld = d.discrepancies.find((dd) => dd.field === "lotCount")!;
      console.log(`  ${d.ref} (${d.supplier}): PDF ${ld.pdfValue} lots vs DB ${ld.dbValue} lots [${ld.note}]`);
    }
  }

  // ── Sales type mapping issues ──
  const salesTypeDisc = allDiscrepancies.filter((d) =>
    d.discrepancies.some((dd) => dd.field.includes("salesType"))
  );
  if (salesTypeDisc.length > 0) {
    console.log("\n─── Sales Type Mapping Issues ───");
    const typeMap: Record<string, Set<string>> = {};
    for (const d of salesTypeDisc) {
      for (const dd of d.discrepancies.filter((x) => x.field.includes("salesType"))) {
        const key = `PDF:"${dd.pdfValue}" → DB:"${dd.dbValue}"`;
        if (!typeMap[key]) typeMap[key] = new Set();
        typeMap[key].add(d.ref);
      }
    }
    for (const [mapping, refs] of Object.entries(typeMap)) {
      console.log(`  ${mapping} (${refs.size} occurrences)`);
    }
  }

  // ── Transaction count differences ──
  const txCountDisc = allDiscrepancies.filter((d) =>
    d.discrepancies.some((dd) => dd.field.includes("txCount"))
  );
  if (txCountDisc.length > 0) {
    console.log("\n─── Transaction Count Differences (per lot) ───");
    for (const d of txCountDisc) {
      for (const dd of d.discrepancies.filter((x) => x.field.includes("txCount"))) {
        console.log(`  ${d.ref}.${dd.field}: PDF ${dd.pdfValue} vs DB ${dd.dbValue} [${dd.note}]`);
      }
    }
  }

  // Save full results to JSON
  const outputPath = path.join(BASE_DIR, "discrepancy-analysis-2026.json");
  fs.writeFileSync(outputPath, JSON.stringify(allDiscrepancies, null, 2));
  console.log(`\nFull results saved to: ${outputPath}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  prisma.$disconnect();
  process.exit(1);
});
