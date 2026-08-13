/**
 * Submit loose PDF files from private_input/salessheets/ to the import API.
 * These PDFs have a different naming pattern (REFERENCE-INVOICE.pdf),
 * so matching relies on PDF content parsing fallback.
 *
 * Usage: node scripts/submit-pdfs-salessheets.js
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const https = require("https");

const DIR = path.join(__dirname, "..", "private_input", "salessheets");
const API_URL = "https://growerportal.test.apps.coloriginz.com/api/shipments/import-email";
const API_KEY = process.env.IMPORT_API_KEY;

if (!API_KEY) throw new Error("IMPORT_API_KEY ontbreekt — zet hem in .env");

function sendToApi(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const url = new URL(API_URL);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
        "Content-Length": Buffer.byteLength(body),
      },
    }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const files = fs.readdirSync(DIR).filter((f) => f.toLowerCase().endsWith(".pdf"));
  console.log(`Found ${files.length} PDF files\n`);

  let processed = 0;
  let skipped = 0;
  let errors = 0;

  for (const file of files) {
    const buf = fs.readFileSync(path.join(DIR, file));
    const payload = {
      subject: file.replace(/\.pdf$/i, ""),
      from: "manual-upload@coloriginz.com",
      receivedDateTime: new Date().toISOString(),
      attachments: [
        {
          name: file,
          contentType: "application/pdf",
          contentBytes: buf.toString("base64"),
          size: buf.length,
          isInline: false,
        },
      ],
    };

    try {
      const res = await sendToApi(payload);
      if (res.status === 201) {
        const p = res.body.processed?.length || 0;
        const skippedPdfs = (res.body.skipped || []).filter((x) => x.reason !== "not_pdf");
        if (p > 0) {
          console.log(`OK    ${file} -> ${res.body.processed[0].supplierCode} / ${res.body.processed[0].invoiceNumber}`);
          processed++;
        } else {
          const reason = skippedPdfs.length > 0 ? skippedPdfs[0].reason : "unknown";
          console.log(`SKIP  ${file} -> ${reason}`);
          skipped++;
        }
      } else if (res.status === 422) {
        console.log(`SKIP  ${file} -> ${res.body.error}`);
        skipped++;
      } else {
        console.log(`ERR   ${file} -> ${res.status}: ${JSON.stringify(res.body).slice(0, 150)}`);
        errors++;
      }
    } catch (err) {
      console.log(`ERR   ${file} -> ${err.message}`);
      errors++;
    }
  }

  console.log(`\nDone: ${processed} processed, ${skipped} skipped, ${errors} errors`);
}

main().catch(console.error);
