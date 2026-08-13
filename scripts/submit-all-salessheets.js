/**
 * Recursively submit all PDF salessheets from private_input/salessheets/
 * subdirectories (COL/, COLX/) to the import API.
 *
 * Features:
 * - Detailed JSON log file with per-file results
 * - Resume support: skips files already in the log
 * - Summary report at the end with rejected files grouped
 * - Year filter: only process PDFs from a specific year subdirectory
 *
 * Usage:
 *   node scripts/submit-all-salessheets.js                    # all years
 *   node scripts/submit-all-salessheets.js --year 2026        # only 2026
 *   node scripts/submit-all-salessheets.js --year 2026 --resume  # resume 2026
 *
 * Log file: private_input/salessheets/import-log.json         (all years)
 *           private_input/salessheets/import-log-2026.json     (--year 2026)
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const https = require("https");

const BASE_DIR = path.join(__dirname, "..", "private_input", "salessheets");
const API_URL = "https://growerportal.test.apps.coloriginz.com/api/shipments/import-email";
const API_KEY = process.env.IMPORT_API_KEY;

if (!API_KEY) throw new Error("IMPORT_API_KEY ontbreekt — zet hem in .env");
const BATCH_PAUSE_MS = 100; // small pause between requests to avoid overwhelming the API

// Parse --year argument
const yearIdx = process.argv.indexOf("--year");
const YEAR_FILTER = yearIdx !== -1 ? process.argv[yearIdx + 1] : null;
const LOG_FILE = path.join(BASE_DIR, YEAR_FILTER ? `import-log-${YEAR_FILTER}.json` : "import-log.json");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function sendToApi(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const url = new URL(API_URL);
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${API_KEY}`,
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/** Recursively find all PDF files under a directory */
function findPdfs(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findPdfs(full));
    } else if (entry.name.toLowerCase().endsWith(".pdf")) {
      results.push(full);
    }
  }
  return results;
}

/** Load existing log or create empty */
function loadLog() {
  if (fs.existsSync(LOG_FILE)) {
    return JSON.parse(fs.readFileSync(LOG_FILE, "utf8"));
  }
  return {
    startedAt: new Date().toISOString(),
    lastUpdated: null,
    yearFilter: YEAR_FILTER || "all",
    totalFiles: 0,
    processed: 0,
    skipped: 0,
    errors: 0,
    results: [],
  };
}

function saveLog(log) {
  log.lastUpdated = new Date().toISOString();
  fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
}

async function main() {
  const isResume = process.argv.includes("--resume");

  // Find top-level company dirs (COL/, COLX/)
  const companyDirs = fs.readdirSync(BASE_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^COL/i.test(d.name))
    .map((d) => path.join(BASE_DIR, d.name));

  // Build list of scan directories
  const scanDirs = [];
  for (const companyDir of companyDirs) {
    if (YEAR_FILTER) {
      // Only scan the specific year subdirectory
      const yearDir = path.join(companyDir, YEAR_FILTER);
      if (fs.existsSync(yearDir)) {
        scanDirs.push(yearDir);
      }
    } else {
      scanDirs.push(companyDir);
    }
  }

  if (scanDirs.length === 0) {
    console.log(`No directories found${YEAR_FILTER ? ` for year ${YEAR_FILTER}` : ""}`);
    return;
  }

  const allPdfs = [];
  for (const dir of scanDirs) {
    allPdfs.push(...findPdfs(dir));
  }

  // Sort for consistent ordering
  allPdfs.sort();

  console.log(`Year filter: ${YEAR_FILTER || "all"}`);
  console.log(`Scanning: ${scanDirs.map((d) => path.relative(BASE_DIR, d)).join(", ")}`);
  console.log(`Found ${allPdfs.length} PDF files\n`);
  console.log(`Log file: ${LOG_FILE}\n`);

  // Load or create log
  const log = isResume ? loadLog() : {
    startedAt: new Date().toISOString(),
    lastUpdated: null,
    yearFilter: YEAR_FILTER || "all",
    totalFiles: allPdfs.length,
    processed: 0,
    skipped: 0,
    errors: 0,
    results: [],
  };

  // Build set of already-processed files (for resume)
  const alreadyDone = new Set(log.results.map((r) => r.file));

  let done = 0;
  let newProcessed = 0;
  let newSkipped = 0;
  let newErrors = 0;
  const startTime = Date.now();

  for (const pdfPath of allPdfs) {
    const relPath = path.relative(BASE_DIR, pdfPath).replace(/\\/g, "/");

    if (isResume && alreadyDone.has(relPath)) {
      done++;
      continue;
    }

    const fileName = path.basename(pdfPath);
    const buf = fs.readFileSync(pdfPath);

    const payload = {
      subject: fileName.replace(/\.pdf$/i, ""),
      from: "bulk-import@coloriginz.com",
      receivedDateTime: new Date().toISOString(),
      attachments: [
        {
          name: fileName,
          contentType: "application/pdf",
          contentBytes: buf.toString("base64"),
          size: buf.length,
          isInline: false,
        },
      ],
    };

    let result;
    try {
      const res = await sendToApi(payload);
      if (res.status === 201) {
        const p = res.body.processed || [];
        const skippedPdfs = (res.body.skipped || []).filter((x) => x.reason !== "not_pdf");
        if (p.length > 0) {
          result = {
            file: relPath,
            status: "OK",
            supplier: p[0].supplierCode,
            reference: p[0].invoiceNumber,
            ourInvoice: p[0].ourInvoiceNumber,
          };
          newProcessed++;
        } else {
          const reason = skippedPdfs.length > 0 ? skippedPdfs[0].reason : "unknown";
          result = { file: relPath, status: "SKIPPED", reason };
          newSkipped++;
        }
      } else if (res.status === 422) {
        result = { file: relPath, status: "SKIPPED", reason: res.body.error || "no_pdf" };
        newSkipped++;
      } else {
        result = { file: relPath, status: "ERROR", reason: `HTTP ${res.status}`, detail: JSON.stringify(res.body).slice(0, 200) };
        newErrors++;
      }
    } catch (err) {
      result = { file: relPath, status: "ERROR", reason: err.message };
      newErrors++;
    }

    log.results.push(result);
    done++;

    // Progress output
    const total = allPdfs.length;
    const pct = ((done / total) * 100).toFixed(1);
    const icon = result.status === "OK" ? "OK   " : result.status === "SKIPPED" ? "SKIP " : "ERR  ";
    const detail = result.status === "OK" ? `${result.supplier} / ${result.reference}` : result.reason;
    process.stdout.write(`[${done}/${total} ${pct}%] ${icon} ${relPath} -> ${detail}\n`);

    // Save log every 50 files for resume safety
    if (done % 50 === 0) {
      log.totalFiles = total;
      log.processed = log.results.filter((r) => r.status === "OK").length;
      log.skipped = log.results.filter((r) => r.status === "SKIPPED").length;
      log.errors = log.results.filter((r) => r.status === "ERROR").length;
      saveLog(log);
    }

    await sleep(BATCH_PAUSE_MS);
  }

  // Final log save
  log.totalFiles = allPdfs.length;
  log.processed = log.results.filter((r) => r.status === "OK").length;
  log.skipped = log.results.filter((r) => r.status === "SKIPPED").length;
  log.errors = log.results.filter((r) => r.status === "ERROR").length;
  log.completedAt = new Date().toISOString();
  saveLog(log);

  // Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("\n" + "=".repeat(70));
  console.log("SUMMARY");
  console.log("=".repeat(70));
  console.log(`Year filter:  ${YEAR_FILTER || "all"}`);
  console.log(`Total files:  ${allPdfs.length}`);
  console.log(`Processed:    ${log.processed}`);
  console.log(`Skipped:      ${log.skipped}`);
  console.log(`Errors:       ${log.errors}`);
  console.log(`Duration:     ${elapsed}s`);
  console.log(`Log file:     ${LOG_FILE}`);

  // List all rejected files grouped by reason
  const rejected = log.results.filter((r) => r.status !== "OK");
  if (rejected.length > 0) {
    console.log("\n" + "-".repeat(70));
    console.log("REJECTED FILES (grouped by reason)");
    console.log("-".repeat(70));

    const byReason = {};
    for (const r of rejected) {
      const key = r.reason || "unknown";
      if (!byReason[key]) byReason[key] = [];
      byReason[key].push(r.file);
    }

    for (const [reason, files] of Object.entries(byReason)) {
      console.log(`\n  ${reason} (${files.length} files):`);
      for (const f of files) {
        console.log(`    - ${f}`);
      }
    }
  }

  console.log("\n" + "=".repeat(70));
}

main().catch(console.error);
