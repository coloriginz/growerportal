/*
 * Toont de tekst rondom beide datums op een salessheet, zodat we zien
 * welk label erbij hoort in plaats van te gokken op basis van notatie.
 */
const fs = require("fs");
const path = require("path");

const MAP = "private_input/salessheets/COL";

function verzamel(dir, uit = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) verzamel(p, uit);
    else if (/\.pdf$/i.test(e.name)) uit.push(p);
  }
  return uit;
}

(async () => {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const alle = verzamel(MAP);
  const keuze = [alle[0], alle[Math.floor(alle.length / 3)], alle[Math.floor(alle.length / 2)]];

  for (const f of keuze) {
    const doc = await getDocument({
      data: new Uint8Array(fs.readFileSync(f)), useSystemFonts: true, verbosity: 0,
    }).promise;
    const page = await doc.getPage(1);
    const c = await page.getTextContent();

    // items met positie, zodat we kunnen zien wat er links van / boven een datum staat
    const items = c.items
      .filter((i) => i.str.trim())
      .map((i) => ({ tekst: i.str.trim(), x: Math.round(i.transform[4]), y: Math.round(i.transform[5]) }));

    console.log("=".repeat(72));
    console.log(path.basename(f));
    console.log("=".repeat(72));

    const datumItems = items.filter((i) => /\d{1,2}-\d{1,2}-\d{2,4}/.test(i.tekst));
    for (const d of datumItems) {
      // alles op ongeveer dezelfde hoogte, gesorteerd van links naar rechts
      const zelfdeRegel = items
        .filter((i) => Math.abs(i.y - d.y) <= 4)
        .sort((a, b) => a.x - b.x)
        .map((i) => i.tekst)
        .join("  ");
      // regel erboven, vaak staat daar de kop
      const boven = items
        .filter((i) => i.y > d.y && i.y - d.y <= 14 && Math.abs(i.x - d.x) < 120)
        .sort((a, b) => a.x - b.x)
        .map((i) => i.tekst)
        .join("  ");
      console.log(`\n  datum "${d.tekst}"  (x=${d.x}, y=${d.y})`);
      console.log(`    regel  : ${zelfdeRegel.slice(0, 150)}`);
      console.log(`    erboven: ${boven.slice(0, 150) || "(niets)"}`);
    }
    await doc.destroy();
  }
})().catch((e) => { console.error("FOUT: " + e.message); process.exit(1); });
