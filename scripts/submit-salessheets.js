/**
 * Parse .msg files from private_input/salessheets/ and submit PDF attachments
 * to the sales sheet import API endpoint.
 *
 * Usage: node scripts/submit-salessheets.js
 */
require("dotenv").config();
const MsgReader = require("msgreader");
const fs = require("fs");
const path = require("path");
const https = require("https");

const API_URL = "https://growerportal.test.apps.coloriginz.com/api/shipments/import-email";
const API_KEY = process.env.IMPORT_API_KEY;

if (!API_KEY) throw new Error("IMPORT_API_KEY ontbreekt — zet hem in .env");
const DIR = path.join(__dirname, "..", "private_input", "salessheets");

function sendToApi(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const url = new URL(API_URL);
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Length": Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
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
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".msg"));
  console.log(`Found ${files.length} .msg files\n`);

  let processed = 0;
  let skipped = 0;
  let errors = 0;

  for (const file of files) {
    const filePath = path.join(DIR, file);
    const msgData = fs.readFileSync(filePath);
    const reader = new MsgReader.default(msgData);
    const fileData = reader.getFileData();

    const subject = fileData.subject || file;
    const from = fileData.senderEmail || fileData.senderSmtp || "unknown";
    const receivedDateTime = fileData.messageDeliveryTime || fileData.clientSubmitTime || new Date().toISOString();

    // Extract PDF attachments
    const attachments = [];
    if (fileData.attachments) {
      for (let i = 0; i < fileData.attachments.length; i++) {
        const attMeta = fileData.attachments[i];
        const att = reader.getAttachment(i);
        if (!att.content) continue;

        const ext = (attMeta.extension || attMeta.fileName || "").toLowerCase();
        const isPdf = ext.includes("pdf") || (attMeta.fileName || "").toLowerCase().endsWith(".pdf");

        attachments.push({
          name: attMeta.fileName || `attachment-${i}.pdf`,
          contentType: isPdf ? "application/pdf" : "application/octet-stream",
          contentBytes: Buffer.from(att.content).toString("base64"),
          size: att.content.length,
          isInline: false,
        });
      }
    }

    if (attachments.length === 0) {
      console.log(`SKIP  ${file} (no attachments)`);
      skipped++;
      continue;
    }

    const payload = {
      subject,
      from,
      receivedDateTime: typeof receivedDateTime === "string" ? receivedDateTime : new Date().toISOString(),
      attachments,
    };

    try {
      const res = await sendToApi(payload);
      if (res.status === 201) {
        const p = res.body.processed?.length || 0;
        const s = res.body.skipped?.filter((x) => x.reason !== "not_pdf").length || 0;
        console.log(`OK    ${file} → ${p} processed, ${s} skipped`);
        processed++;
      } else if (res.status === 422) {
        console.log(`SKIP  ${file} → ${res.body.error}`);
        skipped++;
      } else {
        console.log(`ERR   ${file} → ${res.status}: ${JSON.stringify(res.body).slice(0, 120)}`);
        errors++;
      }
    } catch (err) {
      console.log(`ERR   ${file} → ${err.message}`);
      errors++;
    }
  }

  console.log(`\nDone: ${processed} processed, ${skipped} skipped, ${errors} errors`);
}

main().catch(console.error);
