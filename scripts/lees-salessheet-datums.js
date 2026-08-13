/*
 * Leest een steekproef salessheet-PDF's en haalt factuurnummer + datums eruit,
 * zodat we die kunnen vergelijken met parthdr in KBT.
 */
const fs = require("fs");
const path = require("path");

const MAP = "private_input/salessheets/COL";
const AANTAL = Number(process.argv[2] || 8);

function verzamelPdfs(dir, uit = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) verzamelPdfs(p, uit);
    else if (/\.pdf$/i.test(e.name)) uit.push(p);
  }
  return uit;
}

async function leesPdf(bestand) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(fs.readFileSync(bestand));
  const doc = await getDocument({ data, useSystemFonts: true, verbosity: 0 }).promise;
  const page = await doc.getPage(1);
  const content = await page.getTextContent();
  const items = content.items;
  const regels = [];
  let huidig = "";
  for (const it of items) {
    huidig += it.str;
    if (it.hasEOL) { regels.push(huidig.trim()); huidig = ""; }
  }
  if (huidig.trim()) regels.push(huidig.trim());
  return regels.filter((r) => r.length);
}

(async () => {
  const alle = verzamelPdfs(MAP);
  // spreiding over het bestand nemen in plaats van alleen de eerste
  const stap = Math.max(1, Math.floor(alle.length / AANTAL));
  const keuze = [];
  for (let i = 0; i < alle.length && keuze.length < AANTAL; i += stap) keuze.push(alle[i]);

  console.log(`${alle.length} PDF's gevonden, ${keuze.length} onderzocht\n`);

  for (const f of keuze) {
    const regels = await leesPdf(f);
    const tekst = regels.join(" · ");

    // datums in diverse notaties
    const datums = [...new Set(
      (tekst.match(/\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/g) || [])
    )];
    // getallen van 6-8 cijfers = kandidaat factuur-/referentienummers
    const nummers = [...new Set((tekst.match(/\b\d{6,8}\b/g) || []))];

    console.log("=".repeat(70));
    console.log("bestand : " + path.basename(f));
    console.log("datums  : " + (datums.join("  ") || "(geen)"));
    console.log("nummers : " + (nummers.slice(0, 10).join("  ") || "(geen)"));
    console.log("kop     : " + regels.slice(0, 6).join(" | ").slice(0, 220));
  }
})().catch((e) => { console.error("FOUT: " + e.message); process.exit(1); });
