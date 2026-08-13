/**
 * Validate lot data (stems + amount) from salessheet PDFs against the database.
 *
 * Usage: npx tsx scripts/validate-lots.ts [--count 50]
 *
 * Picks random salessheet PDFs, parses lot-level totals, and compares
 * with the database Transaction aggregates.
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import path from "path";
import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";

dotenv.config();
const DB_URL = process.env.DATABASE_URL || "";
const PDF_DIR = path.resolve(__dirname, "../private_input/salessheets/COL/2026");
const OUTPUT_FILE = path.resolve(__dirname, "../private_input/salessheets/kbt-validation-report.csv");

// ---------------------------------------------------------------------------
// PDF parsing
// ---------------------------------------------------------------------------

interface PdfLot {
  lotNumber: number;
  stems: number;
  amount: number;
}

interface PdfResult {
  file: string;
  invoiceNumber: string | null;
  lots: PdfLot[];
}

async function parseSalessheetPdf(filePath: string): Promise<PdfResult> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const buf = readFileSync(filePath);
  const doc = await getDocument({
    data: new Uint8Array(buf),
    useSystemFonts: true,
    verbosity: 0,
  }).promise;

  const allLines: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items = content.items as Array<{ str: string; hasEOL?: boolean }>;
    let currentLine = "";
    for (const item of items) {
      currentLine += item.str;
      if (item.hasEOL) {
        allLines.push(currentLine.trim());
        currentLine = "";
      }
    }
    if (currentLine.trim()) allLines.push(currentLine.trim());
  }

  await doc.destroy();

  // Extract invoice number (last standalone number near "Invoice number" label)
  let invoiceNumber: string | null = null;
  for (let i = 0; i < allLines.length; i++) {
    if (/Invoice number|Factuurnummer/i.test(allLines[i])) {
      for (let j = Math.max(0, i - 15); j < Math.min(allLines.length, i + 5); j++) {
        const l = allLines[j].trim();
        if (/^\d{5,8}$/.test(l)) {
          invoiceNumber = l;
        }
      }
      break;
    }
  }

  // Extract lots
  const lots: PdfLot[] = [];
  // Find all "Lot NNNNNNN" lines and their summary lines
  const lotStartIndices: { idx: number; partId: number }[] = [];
  for (let i = 0; i < allLines.length; i++) {
    const m = allLines[i].match(/^Lot\s+(\d{5,10})\b/);
    if (m) {
      lotStartIndices.push({ idx: i, partId: parseInt(m[1], 10) });
    }
  }

  for (let li = 0; li < lotStartIndices.length; li++) {
    const { partId } = lotStartIndices[li];
    const startIdx = lotStartIndices[li].idx;
    const endIdx =
      li + 1 < lotStartIndices.length
        ? lotStartIndices[li + 1].idx
        : allLines.length;

    // Find the lot summary line: last line before next lot that matches
    // the pattern {amount}{stems} {avgPrice}
    // Amount: Dutch format with comma and 2 decimals
    // Stems: integer, optionally with dot thousands separator
    // AvgPrice: Dutch decimal
    let lotStems = 0;
    let lotAmount = 0;
    let found = false;

    for (let i = endIdx - 1; i > startIdx; i--) {
      const line = allLines[i].trim();
      // Pattern: amount (Dutch, 2 dec) + stems (int) + space + avgPrice
      // e.g. "327,003.000 0,109" or "81,90500 0,164" or "-12,50200 0,000"
      const m = line.match(
        /^(-?\d[\d.]*,\d{2})(\d[\d.]*)\s+(-?\d[\d,]+)$/
      );
      if (m) {
        lotAmount = parseFloat(m[1].replace(/\./g, "").replace(",", "."));
        lotStems = parseInt(m[2].replace(/\./g, ""), 10);
        found = true;
        break;
      }
    }

    if (found) {
      lots.push({ lotNumber: partId, stems: lotStems, amount: lotAmount });
    }
  }

  return {
    file: path.basename(filePath),
    invoiceNumber,
    lots,
  };
}

// ---------------------------------------------------------------------------
// Collect all PDF files recursively
// ---------------------------------------------------------------------------

function collectPdfs(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    try {
      const stat = statSync(full);
      if (stat.isDirectory()) {
        results.push(...collectPdfs(full));
      } else if (entry.toLowerCase().endsWith(".pdf")) {
        results.push(full);
      }
    } catch {
      // skip inaccessible
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const allMode = args.includes("--all");
  const countIdx = args.indexOf("--count");
  const targetLots = allMode ? Infinity : (countIdx >= 0 ? parseInt(args[countIdx + 1], 10) : 50);

  console.log(`Validating ${allMode ? "ALL" : `~${targetLots}`} lots from salessheet PDFs against DB`);
  console.log(`PDF directory: ${PDF_DIR}`);
  console.log(`Output: ${OUTPUT_FILE}\n`);

  // Collect PDFs
  const allPdfs = collectPdfs(PDF_DIR);
  console.log(`Found ${allPdfs.length} PDF files`);

  if (!allMode) {
    // Shuffle for random sample
    for (let i = allPdfs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allPdfs[i], allPdfs[j]] = [allPdfs[j], allPdfs[i]];
    }
  }

  // Parse PDFs
  const parsedLots: (PdfLot & { file: string })[] = [];
  let pdfsProcessed = 0;
  let pdfErrors = 0;

  for (const pdfPath of allPdfs) {
    if (parsedLots.length >= targetLots) break;
    try {
      const result = await parseSalessheetPdf(pdfPath);
      pdfsProcessed++;
      if (pdfsProcessed % 50 === 0) {
        process.stdout.write(`  Parsed ${pdfsProcessed}/${allPdfs.length} PDFs, ${parsedLots.length} lots...\r`);
      }
      for (const lot of result.lots) {
        parsedLots.push({ ...lot, file: result.file });
        if (parsedLots.length >= targetLots) break;
      }
    } catch {
      pdfErrors++;
    }
  }

  console.log(`Parsed ${pdfsProcessed} PDFs (${pdfErrors} errors), extracted ${parsedLots.length} lots\n`);

  // Query database
  const sql = neon(DB_URL);

  // Batch query in chunks (neon has param limits)
  const lotNumbers = [...new Set(parsedLots.map((l) => String(l.lotNumber)))];
  const CHUNK = 500;
  const dbMap = new Map<number, { totalStems: number; totalAmount: number; correctionVolume: number; id: string; supplierCode: string; supplierName: string; invoiceNumber: string }>();
  for (let i = 0; i < lotNumbers.length; i += CHUNK) {
    const chunk = lotNumbers.slice(i, i + CHUNK);
    const dbLots = await sql`
      SELECT l."lotNumber", l."totalStems", l."totalAmount", l."correctionVolume", l.id,
             s.code as "supplierCode", s.name as "supplierName",
             ss."invoiceNumber"
      FROM "Lot" l
      JOIN "Supplier" s ON s.id = l."supplierId"
      LEFT JOIN "SalesSheet" ss ON ss.id = l."salesSheetId"
      WHERE l."lotNumber" = ANY(${chunk})
    `;
    for (const row of dbLots) {
      dbMap.set(parseInt(row.lotNumber), {
        totalStems: parseInt(row.totalStems) || 0,
        totalAmount: parseFloat(row.totalAmount) || 0,
        correctionVolume: parseInt(row.correctionVolume) || 0,
        id: row.id,
        supplierCode: row.supplierCode || "",
        supplierName: row.supplierName || "",
        invoiceNumber: row.invoiceNumber || "",
      });
    }
  }
  console.log(`Matched ${dbMap.size}/${lotNumbers.length} unique lot numbers in DB`);

  // Get correction info for all matched lots
  const allLotIds = [...dbMap.values()].map((v) => v.id);
  interface TxInfo { stems: number; amount: number; cnt: number }
  const txMap = new Map<string, { origineel: TxInfo; correcties: TxInfo; prullenbak: TxInfo }>();

  for (let i = 0; i < allLotIds.length; i += CHUNK) {
    const chunk = allLotIds.slice(i, i + CHUNK);
    const txSummary = await sql`
      SELECT "lotId", "bronFeitExtra",
             SUM(stems)::int as stems, ROUND(SUM(amount)::numeric, 3) as amount,
             COUNT(*)::int as cnt
      FROM "Transaction"
      WHERE "lotId" = ANY(${chunk})
      GROUP BY "lotId", "bronFeitExtra"
    `;
    for (const row of txSummary) {
      if (!txMap.has(row.lotId)) {
        txMap.set(row.lotId, {
          origineel: { stems: 0, amount: 0, cnt: 0 },
          correcties: { stems: 0, amount: 0, cnt: 0 },
          prullenbak: { stems: 0, amount: 0, cnt: 0 },
        });
      }
      const entry = txMap.get(row.lotId)!;
      const key = row.bronFeitExtra === "correcties" ? "correcties"
        : row.bronFeitExtra === "prullenbak-factcor" ? "prullenbak"
        : "origineel";
      entry[key] = { stems: parseInt(row.stems) || 0, amount: parseFloat(row.amount) || 0, cnt: parseInt(row.cnt) || 0 };
    }
  }

  // Build CSV rows
  const csvHeader = [
    "lot_number", "supplier_code", "supplier_name", "salessheet", "pdf_file", "status",
    "pdf_stems", "pdf_amount",
    "db_stems_netto", "db_amount_netto",
    "correction_volume", "db_stems_bruto",
    "stems_diff", "amount_diff",
    "db_orig_stems", "db_orig_amount", "db_orig_txs",
    "db_corr_stems", "db_corr_amount", "db_corr_txs",
    "db_prullenbak_stems", "db_prullenbak_amount", "db_prullenbak_txs",
    "has_corrections", "opmerkingen",
  ].join(";");

  const csvRows: string[] = [csvHeader];

  let matches = 0, stemsOk = 0, amountOk = 0, notFound = 0;

  for (const lot of parsedLots) {
    const dbLot = dbMap.get(lot.lotNumber);
    if (!dbLot) {
      notFound++;
      csvRows.push([
        lot.lotNumber, "", "", "", lot.file, "NOT_FOUND",
        lot.stems, lot.amount.toFixed(2),
        "", "", "", "", "", "",
        "", "", "", "", "", "", "", "", "",
        "", "Lot niet gevonden in database",
      ].join(";"));
      continue;
    }

    const dbStems = dbLot.totalStems;
    const dbAmount = dbLot.totalAmount;
    const corrVol = dbLot.correctionVolume; // negative (e.g. -20)
    // Bruto = netto minus correctie: 140 - (-20) = 160 (wat de PDF toont)
    const dbStemsBruto = dbStems - corrVol;
    const tx = txMap.get(dbLot.id);
    const orig = tx?.origineel ?? { stems: 0, amount: 0, cnt: 0 };
    const corr = tx?.correcties ?? { stems: 0, amount: 0, cnt: 0 };
    const prullenbak = tx?.prullenbak ?? { stems: 0, amount: 0, cnt: 0 };
    const hasCorrections = corr.cnt > 0 || prullenbak.cnt > 0;
    const hasLotCorrection = corrVol !== 0;

    // Vergelijk met bruto (pre-correctie) stems als er lot-correcties zijn
    const stemsMatchNetto = lot.stems === dbStems;
    const stemsMatchBruto = lot.stems === dbStemsBruto;
    const amountMatch = Math.abs(lot.amount - dbAmount) < 0.02;
    if (stemsMatchNetto || stemsMatchBruto) stemsOk++;
    if (amountMatch) amountOk++;

    let status: string;
    let opmerkingen = "";

    if (stemsMatchNetto && amountMatch) {
      matches++;
      status = "OK";
    } else if (hasLotCorrection && stemsMatchBruto && amountMatch) {
      matches++;
      status = "OK_LOTCORR";
      opmerkingen = `Stelen kloppen met bruto (voor correctie ${corrVol}); bedrag klopt`;
    } else {
      // Check if origineel matches PDF (transaction-level corrections)
      const origStemsMatch = orig.stems === lot.stems;
      const origAmountMatch = Math.abs(orig.amount - lot.amount) < 0.02;

      if (hasCorrections && origStemsMatch && origAmountMatch) {
        status = "OK_CORR";
        opmerkingen = "Netto verschilt door correcties; origineel klopt met PDF";
      } else if (amountMatch && !stemsMatchNetto) {
        status = "STEMS_DIFF";
        opmerkingen = "Bedrag klopt; stelen verschil (waarschijnlijk 0-bedrag quality lines in PDF die niet in Fabric zitten)";
      } else {
        status = "MISMATCH";
        if (dbAmount > lot.amount * 1.5) {
          opmerkingen = "DB bedrag veel hoger dan PDF - mogelijk latere verkopen of ander Fabric-verkooptype";
        } else if (lot.amount > dbAmount * 1.5) {
          opmerkingen = "PDF bedrag veel hoger dan DB - mogelijk ontbrekende transacties in Fabric";
        } else {
          opmerkingen = "Afwijking in stelen en/of bedrag";
        }
      }
    }

    const stemsDiff = lot.stems - dbStems;
    const amountDiff = lot.amount - dbAmount;

    csvRows.push([
      lot.lotNumber, dbLot.supplierCode, dbLot.supplierName, dbLot.invoiceNumber, lot.file, status,
      lot.stems, lot.amount.toFixed(2),
      dbStems, dbAmount.toFixed(2),
      corrVol, dbStemsBruto,
      stemsDiff, amountDiff.toFixed(2),
      orig.stems, orig.amount.toFixed(2), orig.cnt,
      corr.stems, corr.amount.toFixed(2), corr.cnt,
      prullenbak.stems, prullenbak.amount.toFixed(2), prullenbak.cnt,
      hasLotCorrection || hasCorrections ? "ja" : "nee", opmerkingen,
    ].join(";"));
  }

  // Write CSV
  writeFileSync(OUTPUT_FILE, csvRows.join("\n"), "utf-8");

  // Console summary
  const checked = parsedLots.length - notFound;
  const okLotCorr = csvRows.filter((r) => r.includes(";OK_LOTCORR;")).length;
  const okCorr = csvRows.filter((r) => r.includes(";OK_CORR;")).length;
  const stemsDiffOnly = csvRows.filter((r) => r.includes(";STEMS_DIFF;")).length;
  const mismatchCount = csvRows.filter((r) => r.includes(";MISMATCH;")).length;
  const totalOk = matches + okLotCorr + okCorr;

  console.log("\n" + "=".repeat(70));
  console.log("VALIDATION RESULTS");
  console.log("=".repeat(70));
  console.log(`Lots in PDFs:        ${parsedLots.length}`);
  console.log(`Not found in DB:     ${notFound}`);
  console.log(`Checked against DB:  ${checked}`);
  console.log();
  console.log(`OK (exact match):    ${matches} (${((matches / checked) * 100).toFixed(1)}%)`);
  console.log(`OK_LOTCORR (bruto):  ${okLotCorr} (${((okLotCorr / checked) * 100).toFixed(1)}%)`);
  console.log(`OK_CORR (tx orig):   ${okCorr} (${((okCorr / checked) * 100).toFixed(1)}%)`);
  console.log(`--- Totaal OK:       ${totalOk} (${((totalOk / checked) * 100).toFixed(1)}%)`);
  console.log(`STEMS_DIFF only:     ${stemsDiffOnly} (${((stemsDiffOnly / checked) * 100).toFixed(1)}%)`);
  console.log(`MISMATCH:            ${mismatchCount} (${((mismatchCount / checked) * 100).toFixed(1)}%)`);
  console.log();
  console.log(`Stems correct:       ${stemsOk}/${checked} (${((stemsOk / checked) * 100).toFixed(1)}%)`);
  console.log(`Amount correct:      ${amountOk}/${checked} (${((amountOk / checked) * 100).toFixed(1)}%)`);
  console.log();
  console.log(`Report written to: ${OUTPUT_FILE}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
