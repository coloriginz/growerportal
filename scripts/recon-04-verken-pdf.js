/*
 * Verkent de structuur van een complete salessheet: alle pagina's,
 * zodat we zien hoe de detailregels zijn opgebouwd.
 */
const fs = require("fs");

const werk = JSON.parse(fs.readFileSync("private_input/recon-werklijst.json", "utf8"));
const kandidaat = process.argv[2]
  || werk.filter((w) => w.pdf && w.lots >= 8 && w.lots <= 20).sort((a, b) => b.lots - a.lots)[0].pdf;

(async () => {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await getDocument({
    data: new Uint8Array(fs.readFileSync(kandidaat)), useSystemFonts: true, verbosity: 0,
  }).promise;

  const meta = werk.find((w) => w.pdf === kandidaat);
  console.log(`bestand : ${kandidaat}`);
  console.log(`portal  : parthdr ${meta?.parthdr_id}, ${meta?.lots} lots, omzet ${meta?.portal_omzet}, kosten ${meta?.portal_kosten}`);
  console.log(`pagina's: ${doc.numPages}\n`);

  for (let pg = 1; pg <= doc.numPages; pg++) {
    const page = await doc.getPage(pg);
    const c = await page.getTextContent();
    const items = c.items.filter((i) => i.str.trim())
      .map((i) => ({ t: i.str.trim(), x: Math.round(i.transform[4]), y: Math.round(i.transform[5]) }));

    // groepeer op regel
    const regels = new Map();
    for (const i of items) {
      const k = Math.round(i.y / 3) * 3;
      if (!regels.has(k)) regels.set(k, []);
      regels.get(k).push(i);
    }
    const gesorteerd = [...regels.entries()].sort((a, b) => b[0] - a[0]);

    console.log("#".repeat(76));
    console.log(`PAGINA ${pg} van ${doc.numPages}  (${gesorteerd.length} regels)`);
    console.log("#".repeat(76));
    const toon = pg === 1 ? gesorteerd.length : Math.min(gesorteerd.length, 30);
    gesorteerd.slice(0, toon).forEach(([, rij]) => {
      const tekst = rij.sort((a, b) => a.x - b.x)
        .map((i) => `${i.t}@${i.x}`).join("  ");
      console.log("  " + tekst.slice(0, 200));
    });
    if (gesorteerd.length > toon) console.log(`  ... (${gesorteerd.length - toon} regels niet getoond)`);
    console.log();
  }
  await doc.destroy();
})().catch((e) => { console.error("FOUT: " + e.message); process.exit(1); });
