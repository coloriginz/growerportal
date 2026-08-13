/*
 * Stap 6: drieweg-vergelijking op salessheetniveau.
 * PDF is leidend — dat is wat de kweker heeft ontvangen.
 */
const fs = require("fs");

const [parthdr, part, verd, ordreg, ordhdr] = JSON.parse(fs.readFileSync("private_input/recon-bron.json", "utf8"));
const werk = JSON.parse(fs.readFileSync("private_input/recon-werklijst.json", "utf8"));
const pdfs = JSON.parse(fs.readFileSync("private_input/recon-pdf-data.json", "utf8")).filter((p) => !p.fout);

const n = (v) => (v === null || v === undefined || v === "" ? 0 : Number(v));
const oR = new Map(ordreg.map((o) => [String(o.ordreg_id), o]));
const oH = new Map(ordhdr.map((h) => [String(h.ordhdr_id), h]));
const partsOf = new Map(); for (const p of part) { const k = String(p.parthdr_id); if (!partsOf.has(k)) partsOf.set(k, []); partsOf.get(k).push(p); }
const verdOf = new Map(); for (const v of verd) { const k = String(v.part_id); if (!verdOf.has(k)) verdOf.set(k, []); verdOf.get(k).push(v); }
const werkOf = new Map(werk.filter((w) => w.parthdr_id).map((w) => [String(w.parthdr_id), w]));

/* omzet uit de bron, gesplitst naar ordertype en met twee prijsvelden */
function bronOmzet(ph) {
  const uit = { perType: {}, afreken: 0, verk: 0, stelen: 0, regels: 0 };
  for (const p of partsOf.get(String(ph)) || []) {
    for (const v of verdOf.get(String(p.part_id)) || []) {
      const o = oR.get(String(v.ordreg_id)); if (!o) continue;
      const h = oH.get(String(o.ordhdr_id));
      const t = h ? h.ordertype : "(geen)";
      const a = n(v.aantalst) * n(o.afrekenprijs);
      uit.perType[t] = (uit.perType[t] || 0) + a;
      uit.afreken += a;
      uit.verk += n(v.aantalst) * n(o.verk);
      uit.stelen += n(v.aantalst);
      uit.regels++;
    }
  }
  return uit;
}

const rijen = [];
for (const pdf of pdfs) {
  const key = String(pdf.parthdr_id);
  const w = werkOf.get(key); if (!w) continue;
  const b = bronOmzet(key);
  rijen.push({
    lev: pdf.leverancier,
    parthdr: pdf.parthdr_id,
    factnum: pdf.factnum,
    pdf_direct: pdf.direct_sales,
    pdf_veiling: pdf.turnover_auction,
    pdf_productie: pdf.used_in_production,
    pdf_omzet: pdf.total_turnover,
    pdf_kosten: pdf.total_costs,
    pdf_netto: pdf.to_be_received,
    portal_omzet: w.portal_omzet,
    portal_kosten: w.portal_kosten,
    portal_netto: w.portal_netto,
    bron_VO: +(b.perType.VO || 0).toFixed(2),
    bron_AO: +(b.perType.AO || 0).toFixed(2),
    bron_MO: +(b.perType.MO || 0).toFixed(2),
    bron_omzet_afreken: +b.afreken.toFixed(2),
    bron_omzet_verk: +b.verk.toFixed(2),
    bron_regels: b.regels,
    pdf_tx: pdf.transacties.length,
  });
}

const gelijk = (a, b, tol = 0.5) => a !== null && b !== null && Math.abs(a - b) < tol;
const telGelijk = (r, f1, f2, tol = 0.5) => r.filter((x) => gelijk(x[f1], x[f2], tol)).length;

console.log("=".repeat(80));
console.log("DRIEWEG-VERGELIJKING — PDF is leidend");
console.log("=".repeat(80));

for (const lev of ["PCFUP", "COLBFL"]) {
  const r = rijen.filter((x) => x.lev === lev); if (!r.length) continue;
  const som = (f) => +r.reduce((s, x) => s + n(x[f]), 0).toFixed(2);
  console.log(`\n${lev} — ${r.length} salessheets met PDF`);
  console.table([
    { grootheid: "omzet", PDF: som("pdf_omzet"), portal: som("portal_omzet"), bron_afrekenprijs: som("bron_omzet_afreken"), bron_verkprijs: som("bron_omzet_verk") },
    { grootheid: "kosten", PDF: som("pdf_kosten"), portal: som("portal_kosten"), bron_afrekenprijs: "-", bron_verkprijs: "-" },
    { grootheid: "netto", PDF: som("pdf_netto"), portal: som("portal_netto"), bron_afrekenprijs: "-", bron_verkprijs: "-" },
  ]);
  console.log(`  omzet PDF = portal        : ${telGelijk(r, "pdf_omzet", "portal_omzet")}/${r.length}`);
  console.log(`  omzet PDF = bron(afreken) : ${telGelijk(r, "pdf_omzet", "bron_omzet_afreken")}/${r.length}`);
  console.log(`  omzet PDF = bron(verk)    : ${telGelijk(r, "pdf_omzet", "bron_omzet_verk")}/${r.length}`);
  console.log(`  kosten PDF = portal       : ${telGelijk(r, "pdf_kosten", "portal_kosten")}/${r.length}  (tol 0,50)`);
  console.log(`  kosten PDF = portal       : ${telGelijk(r, "pdf_kosten", "portal_kosten", 5)}/${r.length}  (tol 5,00)`);
  console.log(`  netto  PDF = portal       : ${telGelijk(r, "pdf_netto", "portal_netto")}/${r.length}`);
}

/* ---- categorieën: PDF tegenover ordertype uit de bron ---- */
console.log(`\n${"=".repeat(80)}\nOMZETCATEGORIEEN — PDF tegenover ordertype in de bron\n${"=".repeat(80)}`);
const metProd = rijen.filter((x) => x.pdf_productie);
console.log(`salessheets met "Used in production": ${metProd.length} van ${rijen.length}`);
console.table([
  { categorie: "Direct sales / VO", PDF: +rijen.reduce((s, x) => s + n(x.pdf_direct), 0).toFixed(0), bron: +rijen.reduce((s, x) => s + x.bron_VO, 0).toFixed(0) },
  { categorie: "Turnover Auction / AO", PDF: +rijen.reduce((s, x) => s + n(x.pdf_veiling), 0).toFixed(0), bron: +rijen.reduce((s, x) => s + x.bron_AO, 0).toFixed(0) },
  { categorie: "Used in production / MO", PDF: +rijen.reduce((s, x) => s + n(x.pdf_productie), 0).toFixed(0), bron: +rijen.reduce((s, x) => s + x.bron_MO, 0).toFixed(0) },
]);

/* ---- mist de portal de productieomzet? ---- */
console.log(`\n${"=".repeat(80)}\nMIST DE PORTAL DE PRODUCTIEOMZET?\n${"=".repeat(80)}`);
const zonderProd = metProd.map((x) => ({
  ...x, pdf_zonder_prod: +(n(x.pdf_omzet) - n(x.pdf_productie)).toFixed(2),
}));
console.log(`  portal = PDF totaal           : ${telGelijk(zonderProd, "portal_omzet", "pdf_omzet")}/${zonderProd.length}`);
console.log(`  portal = PDF minus productie  : ${telGelijk(zonderProd, "portal_omzet", "pdf_zonder_prod")}/${zonderProd.length}`);
const zonder = rijen.filter((x) => !x.pdf_productie);
console.log(`  bij salessheets ZONDER productie: portal = PDF in ${telGelijk(zonder, "portal_omzet", "pdf_omzet")}/${zonder.length}`);

fs.writeFileSync("private_input/recon-drieweg.json", JSON.stringify(rijen, null, 1), "utf8");
console.log(`\nDetail -> private_input/recon-drieweg.json`);
