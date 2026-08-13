/*
 * Stap 8: reconciliatie op transactieniveau.
 * PDF-transactieregels tegenover de verdeelregels uit KBT, per partij.
 */
const fs = require("fs");

const [parthdr, part, verd, ordreg, ordhdr] = JSON.parse(fs.readFileSync("private_input/recon-bron.json", "utf8"));
const pdfs = JSON.parse(fs.readFileSync("private_input/recon-pdf-data.json", "utf8")).filter((p) => !p.fout);
const schoon = new Set(JSON.parse(fs.readFileSync("private_input/recon-schoon.json", "utf8")).map((x) => String(x.parthdr)));

const n = (v) => (v === null || v === undefined || v === "" ? 0 : Number(v));
const oR = new Map(ordreg.map((o) => [String(o.ordreg_id), o]));
const oH = new Map(ordhdr.map((h) => [String(h.ordhdr_id), h]));
const partsOf = new Map(); for (const p of part) { const k = String(p.parthdr_id); if (!partsOf.has(k)) partsOf.set(k, []); partsOf.get(k).push(p); }
const verdOf = new Map(); for (const v of verd) { const k = String(v.part_id); if (!verdOf.has(k)) verdOf.set(k, []); verdOf.get(k).push(v); }

/* ---- 1. sluit het partijnummer op de PDF aan op part.partnum? ---- */
let lotGevonden = 0, lotGemist = 0;
const gemisteLots = [];
for (const pdf of pdfs) {
  if (!schoon.has(String(pdf.parthdr_id))) continue;
  const bronNums = new Set((partsOf.get(String(pdf.parthdr_id)) || []).map((p) => String(p.partnum)));
  for (const lot of new Set(pdf.transacties.map((t) => t.lotnummer))) {
    if (bronNums.has(String(lot))) lotGevonden++;
    else { lotGemist++; if (gemisteLots.length < 5) gemisteLots.push({ parthdr: pdf.parthdr_id, pdf_lot: lot, bron_voorbeeld: [...bronNums].slice(0, 3).join(", ") }); }
  }
}
console.log("=".repeat(78));
console.log("1. KOPPELING PARTIJNUMMER  (PDF 'Lot' tegenover part.partnum)");
console.log("=".repeat(78));
console.log(`  gevonden in de bron : ${lotGevonden}`);
console.log(`  niet gevonden       : ${lotGemist}`);
if (gemisteLots.length) console.table(gemisteLots);

/* ---- 2. per partij: PDF-regels tegenover verdeelregels ---- */
const perPartij = [];
for (const pdf of pdfs) {
  if (!schoon.has(String(pdf.parthdr_id))) continue;
  const lots = partsOf.get(String(pdf.parthdr_id)) || [];
  const perNum = new Map(lots.map((p) => [String(p.partnum), p]));

  const pdfPerLot = new Map();
  for (const t of pdf.transacties) {
    const k = String(t.lotnummer);
    if (!pdfPerLot.has(k)) pdfPerLot.set(k, []);
    pdfPerLot.get(k).push(t);
  }

  for (const [num, txs] of pdfPerLot) {
    const p = perNum.get(num);
    if (!p) continue;
    const vs = verdOf.get(String(p.part_id)) || [];
    let bronBedrag = 0, bronStelen = 0;
    const perType = {};
    for (const v of vs) {
      const o = oR.get(String(v.ordreg_id)); if (!o) continue;
      const h = oH.get(String(o.ordhdr_id));
      const t = h ? h.ordertype : "(geen)";
      const a = n(v.aantalst) * n(o.afrekenprijs);
      bronBedrag += a; bronStelen += n(v.aantalst);
      perType[t] = (perType[t] || 0) + a;
    }
    // de PDF toont per partij ook een subtotaalregel; die telt dubbel.
    // Regels met kanaal (Direct sales / VBA / ...) zijn de echte transacties.
    const echte = txs.filter((t) => t.kanaal && !/^\d/.test(t.kanaal));
    const pdfBedrag = echte.reduce((s, t) => s + n(t.bedrag), 0);
    const pdfStelen = echte.reduce((s, t) => s + n(t.stelen), 0);

    perPartij.push({
      parthdr: pdf.parthdr_id, lev: pdf.leverancier, partnum: num, part_id: p.part_id,
      pdf_regels: echte.length, bron_regels: vs.length,
      pdf_stelen: pdfStelen, bron_stelen: Math.round(bronStelen),
      pdf_bedrag: +pdfBedrag.toFixed(2), bron_bedrag: +bronBedrag.toFixed(2),
      verschil: +(pdfBedrag - bronBedrag).toFixed(2),
      MO: +(perType.MO || 0).toFixed(2),
    });
  }
}

console.log(`\n${"=".repeat(78)}\n2. PER PARTIJ — PDF tegenover bron\n${"=".repeat(78)}`);
const tol = (t) => perPartij.filter((x) => Math.abs(x.verschil) < t).length;
console.log(`  vergeleken partijen : ${perPartij.length}`);
console.log(`  bedrag exact (<0,05): ${tol(0.05)}  (${(tol(0.05) / perPartij.length * 100).toFixed(1)}%)`);
console.log(`  binnen 0,50         : ${tol(0.5)}`);
console.log(`  binnen 5,00         : ${tol(5)}`);
console.log(`  stelen gelijk       : ${perPartij.filter((x) => x.pdf_stelen === x.bron_stelen).length}`);
console.log(`  regelaantal gelijk  : ${perPartij.filter((x) => x.pdf_regels === x.bron_regels).length}`);

const afwijkend = perPartij.filter((x) => Math.abs(x.verschil) >= 0.5);
console.log(`\n  afwijkende partijen : ${afwijkend.length}`);
const metMO = afwijkend.filter((x) => x.MO > 0);
console.log(`  waarvan met productieomzet: ${metMO.length}`);
console.table(afwijkend.sort((a, b) => Math.abs(b.verschil) - Math.abs(a.verschil)).slice(0, 10)
  .map((x) => ({ lev: x.lev, parthdr: x.parthdr, partnum: x.partnum,
    regels: `${x.pdf_regels}/${x.bron_regels}`, stelen: `${x.pdf_stelen}/${x.bron_stelen}`,
    pdf: x.pdf_bedrag, bron: x.bron_bedrag, verschil: x.verschil, MO: x.MO })));

/* ---- 3. kanalen op de PDF ---- */
const kanalen = {};
for (const pdf of pdfs) {
  if (!schoon.has(String(pdf.parthdr_id))) continue;
  for (const t of pdf.transacties) {
    if (!t.kanaal || /^\d/.test(t.kanaal)) continue;
    if (!kanalen[t.kanaal]) kanalen[t.kanaal] = { regels: 0, bedrag: 0 };
    kanalen[t.kanaal].regels++; kanalen[t.kanaal].bedrag += n(t.bedrag);
  }
}
console.log(`\n${"=".repeat(78)}\n3. VERKOOPKANALEN OP DE SALESSHEET\n${"=".repeat(78)}`);
console.table(Object.entries(kanalen).sort((a, b) => b[1].bedrag - a[1].bedrag)
  .map(([k, v]) => ({ kanaal: k, regels: v.regels, bedrag: +v.bedrag.toFixed(2) })));

fs.writeFileSync("private_input/recon-regelniveau.json", JSON.stringify(perPartij, null, 1), "utf8");
console.log("\nDetail -> private_input/recon-regelniveau.json");
