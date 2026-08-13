/*
 * Bouwt het reconciliatierapport als Excel-werkboek, zodat er gefilterd en
 * gesorteerd kan worden. Bron: de JSON-bestanden uit stap 1 t/m 8.
 */
const fs = require("fs");
const ExcelJS = require("exceljs");

const UIT = "private_input/Reconciliatie PCFUP en COLBFL.xlsx";

const drieweg = JSON.parse(fs.readFileSync("private_input/recon-drieweg.json", "utf8"));
const diagnose = JSON.parse(fs.readFileSync("private_input/recon-diagnose.json", "utf8"));
const schoon = JSON.parse(fs.readFileSync("private_input/recon-schoon.json", "utf8"));
const regel = JSON.parse(fs.readFileSync("private_input/recon-regelniveau.json", "utf8"));
const pdfs = JSON.parse(fs.readFileSync("private_input/recon-pdf-data.json", "utf8")).filter((p) => !p.fout);
const werk = JSON.parse(fs.readFileSync("private_input/recon-werklijst.json", "utf8"));

const C = { donker: "FF1F3864", accent: "FF2E75B6", groen: "FFC6EFCE", groenT: "FF006100",
            rood: "FFFFC7CE", roodT: "FF9C0006", amber: "FFFFEB9C", amberT: "FF9C6500", grijs: "FFF2F2F2" };
const n = (v) => (v === null || v === undefined || v === "" ? 0 : Number(v));
const nl = (s) => { const m = String(s || "").match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})/); if (!m) return null;
  let y = +m[3]; if (y < 100) y += 2000; return `${y}-${String(+m[2]).padStart(2, "0")}-${String(+m[1]).padStart(2, "0")}`; };

const wb = new ExcelJS.Workbook();
wb.creator = "Grower Portal"; wb.created = new Date();

function tabel(ws, kolommen, rijen, opties = {}) {
  const start = opties.startRij || 1;
  const kop = ws.getRow(start);
  kop.values = kolommen.map((k) => k.kop);
  kop.eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.accent } };
    c.alignment = { vertical: "middle", wrapText: true };
  });
  kop.height = 28;
  rijen.forEach((r, i) => {
    const row = ws.getRow(start + 1 + i);
    row.values = kolommen.map((k) => (typeof k.waarde === "function" ? k.waarde(r) : r[k.veld]));
    kolommen.forEach((k, ci) => {
      const cel = row.getCell(ci + 1);
      if (k.formaat) cel.numFmt = k.formaat;
      if (k.kleur) { const kl = k.kleur(r); if (kl) { cel.fill = { type: "pattern", pattern: "solid", fgColor: { argb: kl.vul } }; cel.font = { color: { argb: kl.tekst }, bold: true }; } }
    });
    if (i % 2 === 1) row.eachCell((c) => { if (!c.fill || c.fill.type !== "pattern") c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.grijs } }; });
  });
  kolommen.forEach((k, i) => { ws.getColumn(i + 1).width = k.breedte || 14; });
  ws.autoFilter = { from: { row: start, column: 1 }, to: { row: start + rijen.length, column: kolommen.length } };
  ws.views = [{ state: "frozen", ySplit: start, xSplit: opties.xSplit || 0 }];
}

const EUR = '#,##0.00';
const verschilKleur = (veld, tol = 0.5) => (r) => {
  const v = Math.abs(n(r[veld]));
  if (v < tol) return { vul: C.groen, tekst: C.groenT };
  if (v < 50) return { vul: C.amber, tekst: C.amberT };
  return { vul: C.rood, tekst: C.roodT };
};

/* ===== 1. Toelichting ===== */
const s0 = wb.addWorksheet("Toelichting", { views: [{ showGridLines: false }] });
s0.columns = [{ width: 3 }, { width: 42 }, { width: 100 }];
let r = 2;
const titel = (t) => { const c = s0.getCell(r, 2); c.value = t; c.font = { bold: true, size: 15, color: { argb: C.donker } }; s0.mergeCells(r, 2, r, 3); r += 2; };
const regelUit = (label, tekst, kleur) => {
  s0.getCell(r, 2).value = label; s0.getCell(r, 2).font = { bold: true, size: 10, color: { argb: C.donker } };
  s0.getCell(r, 2).alignment = { vertical: "top" };
  const t = s0.getCell(r, 3); t.value = tekst; t.alignment = { wrapText: true, vertical: "top" };
  if (kleur) t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: kleur } };
  s0.getRow(r).height = Math.max(16, Math.ceil(String(tekst).length / 110) * 14 + 4);
  r += 1;
};
titel("Reconciliatie PCFUP en COLBFL — bron, portal en salessheet");
regelUit("Uitgevoerd", "3–4 augustus 2026");
regelUit("Methode", "Drieweg-vergelijking. De salessheet-PDF is leidend: dat is het document dat de kweker daadwerkelijk ontvangt.");
regelUit("Omvang", `${werk.length} salessheets in de portal, ${pdfs.length} met PDF, ${schoon.length} na uitsluiting van verkeerd gekoppelde PDF's. ${regel.length} partijen op regelniveau vergeleken.`);
r += 1;
regelUit("HOOFDBEVINDING", "De portal importeert geen productieomzet (ordertype MO, op de salessheet 'Used in production'). Bij 100 van de 234 salessheets scheelt dat EUR 22.932. De kweker ziet een lager netto resultaat dan op zijn eigen salessheet staat.", C.rood);
r += 1;
regelUit("Bron volgt de PDF beter", "De bron staat in 131 gevallen dichter bij de salessheet, de portal in 23. Op partijniveau komt de bron in 93,0% exact overeen. Dat is het inhoudelijke argument voor de migratie.", C.groen);
regelUit("Kosten kloppen", "COLBFL: PDF EUR 316.010 tegen portal EUR 315.410 (0,2%). Let op: shkost.bedrag is een PERCENTAGE wanneer percok = true. Die berekening moet niet zelf gereproduceerd worden — vandaar de eis om de ssh_-tabellen te leveren.", C.groen);
regelUit("Geen cut-off-probleem", "Afwijkingen zitten niet bij recente leveringen; de laatste 30 dagen kloppen juist het best. Ook geen ontbrekende partijen — aantallen komen exact overeen.");
r += 1;
regelUit("Tabbladen",
  "Per salessheet — alle 242, met verschillen en verklaring\n" +
  "Productieomzet gemist — de 100 gevallen\n" +
  "Onverklaard — de 17 die nog uitzoekwerk vragen\n" +
  "Verkeerde PDF — 8 koppelfouten in de portal\n" +
  "Per partij — 5.453 partijen, bron tegenover PDF\n" +
  "Verkoopkanalen — opbouw van de omzet\n" +
  "Kostenregels — alle kostensoorten uit de PDF's");
s0.getRow(r - 1).height = 105;

/* ===== 2. Per salessheet ===== */
const pdfDatum = new Map(pdfs.map((p) => [String(p.parthdr_id), nl(p.pdf_leverdatum)]));
const perSheet = diagnose.map((x) => ({
  ...x,
  correct_gekoppeld: pdfDatum.get(String(x.parthdr)) === x.leverdatum ? "ja" : "NEE",
  verklaring: Math.abs(n(x.portal_omzet) - n(x.pdf_omzet)) < 0.5 ? "omzet klopt"
    : (x.pdf_productie && Math.abs(n(x.portal_omzet) - n(x.pdf_zonder_prod)) < 0.5) ? "portal mist productieomzet"
    : "onverklaard",
}));
const s1 = wb.addWorksheet("Per salessheet");
tabel(s1, [
  { kop: "leverancier", veld: "lev", breedte: 11 },
  { kop: "parthdr_id", veld: "parthdr", breedte: 12 },
  { kop: "factuurnr", veld: "factnum", breedte: 18 },
  { kop: "leverdatum", veld: "leverdatum", breedte: 12 },
  { kop: "PDF correct gekoppeld", veld: "correct_gekoppeld", breedte: 12,
    kleur: (r) => (r.correct_gekoppeld === "ja" ? { vul: C.groen, tekst: C.groenT } : { vul: C.rood, tekst: C.roodT }) },
  { kop: "verklaring", veld: "verklaring", breedte: 26,
    kleur: (r) => (r.verklaring === "omzet klopt" ? { vul: C.groen, tekst: C.groenT }
      : r.verklaring === "portal mist productieomzet" ? { vul: C.amber, tekst: C.amberT } : { vul: C.rood, tekst: C.roodT }) },
  { kop: "PDF omzet", veld: "pdf_omzet", formaat: EUR, breedte: 13 },
  { kop: "portal omzet", veld: "portal_omzet", formaat: EUR, breedte: 13 },
  { kop: "bron omzet", veld: "bron_omzet_afreken", formaat: EUR, breedte: 13 },
  { kop: "verschil portal-PDF", veld: "d_omzet", formaat: EUR, breedte: 13, kleur: verschilKleur("d_omzet") },
  { kop: "PDF direct", veld: "pdf_direct", formaat: EUR, breedte: 12 },
  { kop: "PDF veiling", veld: "pdf_veiling", formaat: EUR, breedte: 12 },
  { kop: "PDF productie", veld: "pdf_productie", formaat: EUR, breedte: 12,
    kleur: (r) => (n(r.pdf_productie) > 0 ? { vul: C.amber, tekst: C.amberT } : null) },
  { kop: "bron VO", veld: "bron_VO", formaat: EUR, breedte: 12 },
  { kop: "bron AO", veld: "bron_AO", formaat: EUR, breedte: 12 },
  { kop: "bron MO", veld: "bron_MO", formaat: EUR, breedte: 12 },
  { kop: "PDF kosten", veld: "pdf_kosten", formaat: EUR, breedte: 12 },
  { kop: "portal kosten", veld: "portal_kosten", formaat: EUR, breedte: 12 },
  { kop: "verschil kosten", veld: "d_kosten", formaat: EUR, breedte: 12, kleur: verschilKleur("d_kosten") },
  { kop: "PDF netto", veld: "pdf_netto", formaat: EUR, breedte: 13 },
  { kop: "portal netto", veld: "portal_netto", formaat: EUR, breedte: 13 },
  { kop: "verschil netto", veld: "d_netto", formaat: EUR, breedte: 13, kleur: verschilKleur("d_netto") },
  { kop: "PDF regels", veld: "pdf_tx", breedte: 9 },
  { kop: "bron regels", veld: "bron_regels", breedte: 9 },
], perSheet, { xSplit: 3 });

/* ===== 3. Productieomzet gemist ===== */
const gemist = perSheet.filter((x) => x.verklaring === "portal mist productieomzet");
const s2 = wb.addWorksheet("Productieomzet gemist");
tabel(s2, [
  { kop: "leverancier", veld: "lev", breedte: 11 },
  { kop: "parthdr_id", veld: "parthdr", breedte: 12 },
  { kop: "factuurnr", veld: "factnum", breedte: 18 },
  { kop: "leverdatum", veld: "leverdatum", breedte: 12 },
  { kop: "PDF omzet totaal", veld: "pdf_omzet", formaat: EUR, breedte: 14 },
  { kop: "waarvan productie", veld: "pdf_productie", formaat: EUR, breedte: 14, kleur: () => ({ vul: C.amber, tekst: C.amberT }) },
  { kop: "portal omzet", veld: "portal_omzet", formaat: EUR, breedte: 14 },
  { kop: "PDF minus productie", veld: "pdf_zonder_prod", formaat: EUR, breedte: 15 },
  { kop: "bron MO", veld: "bron_MO", formaat: EUR, breedte: 12 },
  { kop: "gemiste omzet", veld: "pdf_productie", formaat: EUR, breedte: 13, kleur: () => ({ vul: C.rood, tekst: C.roodT }) },
], gemist.sort((a, b) => n(b.pdf_productie) - n(a.pdf_productie)));

/* ===== 4. Onverklaard ===== */
const onverklaard = perSheet.filter((x) => x.verklaring === "onverklaard");
const s3 = wb.addWorksheet("Onverklaard");
tabel(s3, [
  { kop: "leverancier", veld: "lev", breedte: 11 },
  { kop: "parthdr_id", veld: "parthdr", breedte: 12 },
  { kop: "factuurnr", veld: "factnum", breedte: 18 },
  { kop: "leverdatum", veld: "leverdatum", breedte: 12 },
  { kop: "PDF correct gekoppeld", veld: "correct_gekoppeld", breedte: 12,
    kleur: (r) => (r.correct_gekoppeld === "ja" ? { vul: C.groen, tekst: C.groenT } : { vul: C.rood, tekst: C.roodT }) },
  { kop: "PDF omzet", veld: "pdf_omzet", formaat: EUR, breedte: 13 },
  { kop: "portal omzet", veld: "portal_omzet", formaat: EUR, breedte: 13 },
  { kop: "bron omzet", veld: "bron_omzet_afreken", formaat: EUR, breedte: 13 },
  { kop: "verschil portal-PDF", veld: "d_omzet", formaat: EUR, breedte: 14, kleur: verschilKleur("d_omzet") },
  { kop: "bron = PDF?", waarde: (r) => (Math.abs(n(r.bron_omzet_afreken) - n(r.pdf_omzet)) < 0.5 ? "ja — portal wijkt af" : "nee"), breedte: 20,
    kleur: (r) => (Math.abs(n(r.bron_omzet_afreken) - n(r.pdf_omzet)) < 0.5 ? { vul: C.amber, tekst: C.amberT } : null) },
  { kop: "productie", veld: "pdf_productie", formaat: EUR, breedte: 11 },
  { kop: "PDF regels", veld: "pdf_tx", breedte: 10 },
  { kop: "bron regels", veld: "bron_regels", breedte: 10 },
], onverklaard.sort((a, b) => Math.abs(n(b.d_omzet)) - Math.abs(n(a.d_omzet))));

/* ===== 5. Verkeerde PDF ===== */
const fout = perSheet.filter((x) => x.correct_gekoppeld === "NEE").map((x) => ({
  ...x,
  pdf_leverdatum: pdfDatum.get(String(x.parthdr)),
  bestand: (werk.find((w) => String(w.parthdr_id) === String(x.parthdr))?.pdf || "").split("/").pop(),
  wijze: werk.find((w) => String(w.parthdr_id) === String(x.parthdr))?.pdf_match,
}));
const s4 = wb.addWorksheet("Verkeerde PDF");
s4.getCell(1, 1).value = "Deze salessheets hebben in de portal een PDF gekoppeld die bij een andere levering hoort. Alle acht zijn gelegd via SalesSheet.ourInvoiceNumber; koppelingen die ook op leverdatum zijn geverifieerd waren allemaal correct.";
s4.getCell(1, 1).font = { italic: true, size: 10 }; s4.mergeCells(1, 1, 1, 7);
tabel(s4, [
  { kop: "leverancier", veld: "lev", breedte: 11 },
  { kop: "parthdr_id", veld: "parthdr", breedte: 12 },
  { kop: "factuurnr portal", veld: "factnum", breedte: 16 },
  { kop: "leverdatum portal", veld: "leverdatum", breedte: 15 },
  { kop: "leverdatum op PDF", veld: "pdf_leverdatum", breedte: 15, kleur: () => ({ vul: C.rood, tekst: C.roodT }) },
  { kop: "gekoppeld bestand", veld: "bestand", breedte: 28 },
  { kop: "koppelwijze", veld: "wijze", breedte: 20 },
], fout, { startRij: 3 });

/* ===== 6. Per partij ===== */
const s5 = wb.addWorksheet("Per partij");
tabel(s5, [
  { kop: "leverancier", veld: "lev", breedte: 11 },
  { kop: "parthdr_id", veld: "parthdr", breedte: 12 },
  { kop: "partijnummer", veld: "partnum", breedte: 13 },
  { kop: "part_id", veld: "part_id", breedte: 11 },
  { kop: "PDF regels", veld: "pdf_regels", breedte: 10 },
  { kop: "bron regels", veld: "bron_regels", breedte: 10 },
  { kop: "PDF stelen", veld: "pdf_stelen", breedte: 11 },
  { kop: "bron stelen", veld: "bron_stelen", breedte: 11 },
  { kop: "PDF bedrag", veld: "pdf_bedrag", formaat: EUR, breedte: 13 },
  { kop: "bron bedrag", veld: "bron_bedrag", formaat: EUR, breedte: 13 },
  { kop: "verschil", veld: "verschil", formaat: EUR, breedte: 12, kleur: verschilKleur("verschil", 0.05) },
  { kop: "waarvan productie", veld: "MO", formaat: EUR, breedte: 14,
    kleur: (r) => (n(r.MO) > 0 ? { vul: C.amber, tekst: C.amberT } : null) },
], regel.sort((a, b) => Math.abs(n(b.verschil)) - Math.abs(n(a.verschil))), { xSplit: 3 });

/* ===== 7. Verkoopkanalen ===== */
const schoonSet = new Set(schoon.map((x) => String(x.parthdr)));
const kanalen = {};
for (const p of pdfs) {
  if (!schoonSet.has(String(p.parthdr_id))) continue;
  for (const t of p.transacties) {
    if (!t.kanaal || /^\d/.test(t.kanaal)) continue;
    (kanalen[t.kanaal] ||= { kanaal: t.kanaal, regels: 0, stelen: 0, bedrag: 0 });
    kanalen[t.kanaal].regels++; kanalen[t.kanaal].stelen += n(t.stelen); kanalen[t.kanaal].bedrag += n(t.bedrag);
  }
}
const s6 = wb.addWorksheet("Verkoopkanalen");
tabel(s6, [
  { kop: "kanaal op de salessheet", veld: "kanaal", breedte: 26 },
  { kop: "transactieregels", veld: "regels", breedte: 15 },
  { kop: "stelen", veld: "stelen", formaat: "#,##0", breedte: 14 },
  { kop: "bedrag", veld: "bedrag", formaat: EUR, breedte: 16 },
], Object.values(kanalen).sort((a, b) => b.bedrag - a.bedrag));

/* ===== 8. Kostenregels ===== */
const kosten = {};
for (const p of pdfs) {
  if (!schoonSet.has(String(p.parthdr_id))) continue;
  for (const k of p.kostregels || []) {
    (kosten[k.omschrijving] ||= { omschrijving: k.omschrijving, voorkomens: 0, totaal: 0 });
    kosten[k.omschrijving].voorkomens++; kosten[k.omschrijving].totaal += n(k.bedrag);
  }
}
const s7 = wb.addWorksheet("Kostenregels");
tabel(s7, [
  { kop: "kostensoort op de salessheet", veld: "omschrijving", breedte: 40 },
  { kop: "aantal salessheets", veld: "voorkomens", breedte: 16 },
  { kop: "totaalbedrag", veld: "totaal", formaat: EUR, breedte: 16 },
], Object.values(kosten).sort((a, b) => b.totaal - a.totaal));

wb.xlsx.writeFile(UIT).then(() => {
  console.log("Geschreven: " + UIT);
  console.log(`  Per salessheet     : ${perSheet.length}`);
  console.log(`  Productieomzet gemist: ${gemist.length}`);
  console.log(`  Onverklaard        : ${onverklaard.length}`);
  console.log(`  Verkeerde PDF      : ${fout.length}`);
  console.log(`  Per partij         : ${regel.length}`);
  console.log(`  Verkoopkanalen     : ${Object.keys(kanalen).length}`);
  console.log(`  Kostensoorten      : ${Object.keys(kosten).length}`);
});
