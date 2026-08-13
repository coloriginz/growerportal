import { readFileSync } from "fs";
import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";
dotenv.config();

async function main() {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const buf = readFileSync("private_input/salessheets/COL/2026/1/Salessheet/186-23-395423.pdf");
  const doc = await getDocument({ data: new Uint8Array(buf), useSystemFonts: true, verbosity: 0 }).promise;
  const page = await doc.getPage(2);
  const content = await page.getTextContent();
  const items = content.items as Array<{ str: string; hasEOL?: boolean }>;
  const lines: string[] = [];
  let currentLine = "";
  for (const item of items) {
    currentLine += item.str;
    if (item.hasEOL) { lines.push(currentLine.trim()); currentLine = ""; }
  }
  if (currentLine.trim()) lines.push(currentLine.trim());

  for (const line of lines) {
    if (line.startsWith("Lot ")) console.log("LOT LINE:", line);
  }
  await doc.destroy();

  const sql = neon(process.env.DATABASE_URL!);
  const lotNum = 3849745;
  const res = await sql`SELECT id, "fabricPartId", "lotNumber", "totalStems", "totalAmount" FROM "Lot" WHERE "lotNumber" = ${lotNum}`;
  console.log("DB result for lotNumber 3849745:", JSON.stringify(res));

  const res2 = await sql`SELECT id, "fabricPartId", "lotNumber", "totalStems", "totalAmount" FROM "Lot" WHERE "lotNumber" = ${String(lotNum)}`;
  console.log("DB result for lotNumber '3849745':", JSON.stringify(res2));
}
main().catch(e => console.error(e.message));
