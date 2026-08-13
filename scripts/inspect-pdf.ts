import { readFileSync } from "fs";

const filePath = process.argv[2];
if (!filePath) { console.error("Usage: npx tsx scripts/inspect-pdf.ts <pdf-path>"); process.exit(1); }

async function main() {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const buf = readFileSync(filePath);
  const doc = await getDocument({ data: new Uint8Array(buf), useSystemFonts: true, verbosity: 0 }).promise;
  console.log("Pages:", doc.numPages);
  const maxPages = Math.min(doc.numPages, 4);
  for (let p = 1; p <= maxPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items = content.items as Array<{ str: string; hasEOL?: boolean }>;
    const lines: string[] = [];
    let cur = "";
    for (const it of items) { cur += it.str; if (it.hasEOL) { lines.push(cur.trim()); cur = ""; } }
    if (cur.trim()) lines.push(cur.trim());
    console.log(`--- PAGE ${p} ---`);
    lines.forEach((l, i) => console.log(`${i}: ${l}`));
  }
  await doc.destroy();
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
