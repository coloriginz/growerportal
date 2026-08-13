/*
 * Schrijft het kopblok van een salessheet uit in leesvolgorde,
 * zodat je het op de PDF kunt terugvinden.
 */
const fs = require("fs");

const BESTAND = process.argv[2] ||
  "private_input/salessheets/COL/2025/Salessheet/094-23-370828.pdf";

(async () => {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await getDocument({
    data: new Uint8Array(fs.readFileSync(BESTAND)), useSystemFonts: true, verbosity: 0,
  }).promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  const c = await page.getTextContent();

  const items = c.items
    .filter((i) => i.str.trim())
    .map((i) => ({ t: i.str.trim(), x: Math.round(i.transform[4]), y: Math.round(i.transform[5]) }));

  console.log(`bestand    : ${BESTAND}`);
  console.log(`paginamaat : ${Math.round(viewport.width)} x ${Math.round(viewport.height)} punten\n`);

  // regels groeperen op y, van boven naar beneden
  const regels = new Map();
  for (const i of items) {
    const sleutel = Math.round(i.y / 4) * 4;
    if (!regels.has(sleutel)) regels.set(sleutel, []);
    regels.get(sleutel).push(i);
  }

  const gesorteerd = [...regels.entries()].sort((a, b) => b[0] - a[0]);
  const bovenrand = viewport.height;

  console.log("KOPBLOK (bovenste kwart van de pagina), van boven naar beneden:\n");
  for (const [y, rij] of gesorteerd) {
    if (y < bovenrand * 0.75) break;
    const tekst = rij.sort((a, b) => a.x - b.x).map((i) => i.t).join("   ");
    const vanBoven = Math.round(bovenrand - y);
    const merk = /Deliverydate|Invoice date/i.test(tekst) ? "  <<<< HIER" : "";
    console.log(`  ${String(vanBoven).padStart(3)} pt van boven | ${tekst}${merk}`);
  }
})().catch((e) => { console.error("FOUT: " + e.message); process.exit(1); });
