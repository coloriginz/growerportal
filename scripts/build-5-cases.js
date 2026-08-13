/*
 * Voegt de vijf extra cases toe aan het bestaande bewijsdocument.
 * Bron: private_input/5-cases.json (rechtstreeks uit Fabric, dus correcte types)
 */
const fs = require("fs");
const ExcelJS = require("exceljs");

const JSON_IN = "private_input/5-cases.json";
const XLSX = "private_input/Rijvermenigvuldiging KBT - cases.xlsx";

const C = { donker: "FF1F3864", accent: "FF2E75B6", groen: "FFC6EFCE", groenTxt: "FF006100",
            amber: "FFFFEB9C", amberTxt: "FF9C6500", grijs: "FFF2F2F2", rand: "FFBFBFBF" };

const titel = (c, s = 14) => { c.font = { bold: true, size: s, color: { argb: C.donker } }; };
const kopStijl = (row) => {
  row.eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.accent } };
    c.border = { bottom: { style: "thin", color: { argb: C.rand } } };
  });
  row.height = 20;
};
const zetTabel = (ws, startRij, kolommen, rijen, markeer = []) => {
  const kop = ws.getRow(startRij);
  kop.values = kolommen;
  kopStijl(kop);
  rijen.forEach((r, i) => {
    const row = ws.getRow(startRij + 1 + i);
    row.values = kolommen.map((k) => r[k]);
    if (i % 2 === 1) row.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.grijs } }; });
    markeer.forEach((m) => {
      const ci = kolommen.indexOf(m.kolom) + 1;
      if (ci > 0 && m.test(r)) {
        row.getCell(ci).fill = { type: "pattern", pattern: "solid", fgColor: { argb: m.kleur } };
        row.getCell(ci).font = { bold: true, color: { argb: m.tekst } };
      }
    });
  });
  kolommen.forEach((k, i) => { ws.getColumn(i + 1).width = Math.min(Math.max(String(k).length + 4, 13), 30); });
  return startRij + 1 + rijen.length;
};

(async () => {
  const [bron, samenvatting, , omvang, iot, fct] = JSON.parse(fs.readFileSync(JSON_IN, "utf8"));

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(XLSX);
  ["Vijf cases", "Vijf cases - analyse", "Vijf cases - ruwe data", "Omvang"].forEach((n) => {
    const b = wb.getWorksheet(n); if (b) wb.removeWorksheet(b.id);
  });

  const groepeer = (rows, k) => rows.reduce((m, r) => { (m[r[k]] ||= []).push(r); return m; }, {});
  const gI = groepeer(iot, "ordreg_id"), gF = groepeer(fct, "ordreg_id"), gB = groepeer(bron, "ordreg_id");
  const varieert = (rows) => Object.keys(rows[0]).filter((k) => new Set(rows.map((r) => String(r[k]))).size > 1);

  const cases = Object.keys(gI).sort().map((ord) => {
    const i = gI[ord], f = gF[ord] || [], b = gB[ord] || [];
    const somB = b.reduce((s, r) => s + Number(r.aantalst || 0), 0);
    const somI = i.reduce((s, r) => s + Number(r.vor_aantal || 0), 0);
    return {
      ordreg_id: ord,
      part_id: i[0].part_id,
      bron_regels: b.length,
      bron_stelen: Number(somB.toFixed(3)),
      uitvoer_regels: i.length,
      uitvoer_stelen: Number(somI.toFixed(3)),
      factor: Number((i.length / Math.max(b.length, 1)).toFixed(0)),
      partijen: new Set(i.map((r) => r.part_id)).size,
      verdeelregels: new Set(i.map((r) => r.verd_id)).size,
      kolommen: Object.keys(i[0]).length,
      varieren: varieert(i).length,
      constant: Object.keys(i[0]).length - varieert(i).length,
      productie_input: Number(i.reduce((s, r) => s + Number(r.productie_input_aantal || 0), 0).toFixed(2)),
      order_type: i[0].order_type,
      som_klopt: Math.abs(somB - somI) < 0.01 ? "ja" : "NEE",
      fct_regels: f.length,
    };
  });

  /* ---- Tabblad: Vijf cases ---- */
  const s1 = wb.addWorksheet("Vijf cases", { views: [{ showGridLines: false }] });
  titel(s1.getCell(1, 1), 16);
  s1.getCell(1, 1).value = "Vijf extra cases — allemaal één partij, één verdeelregel";
  s1.getCell(2, 1).value = "Rechtstreeks uit Fabric opgehaald op 3 augustus 2026. Geen export via Excel, dus geen conversieverlies.";
  s1.getCell(2, 1).font = { italic: true, size: 10 };
  s1.getCell(4, 1).value = "In alle vijf gevallen staat er één verdeelregel in de bron. De transformatielaag maakt daar 57 tot 63 regels van. De som blijft steeds exact gelijk.";
  s1.getCell(4, 1).font = { size: 10 };

  const kol = ["ordreg_id", "part_id", "bron_regels", "bron_stelen", "uitvoer_regels", "uitvoer_stelen",
               "factor", "partijen", "verdeelregels", "kolommen", "varieren", "constant",
               "productie_input", "order_type", "som_klopt"];
  zetTabel(s1, 6, kol, cases, [
    { kolom: "uitvoer_regels", kleur: C.amber, tekst: C.amberTxt, test: () => true },
    { kolom: "factor", kleur: C.amber, tekst: C.amberTxt, test: () => true },
    { kolom: "som_klopt", kleur: C.groen, tekst: C.groenTxt, test: (r) => r.som_klopt === "ja" },
    { kolom: "bron_regels", kleur: C.groen, tekst: C.groenTxt, test: () => true },
  ]);

  let r = 6 + cases.length + 3;
  s1.getCell(r, 1).value = "Waarom dit relevant is";
  s1.getCell(r, 1).font = { bold: true, size: 11, color: { argb: C.donker } };
  s1.getCell(r + 1, 1).value =
    "Alle vijf zijn verkooporders (order_type VO) zonder enige productie-input. De verklaring dat de vermenigvuldiging " +
    "voortkomt uit het terugleiden van productieorders naar oorspronkelijke partijen gaat hier dus niet op: er is niets " +
    "te herleiden. Eén partij, één verdeelregel, en toch tientallen regels waarvan alleen de bedragen verschillen.";
  s1.getCell(r + 1, 1).alignment = { wrapText: true, vertical: "top" };
  s1.mergeCells(r + 1, 1, r + 4, 12);

  /* ---- Tabblad: analyse ---- */
  const s2 = wb.addWorksheet("Vijf cases - analyse");
  titel(s2.getCell(1, 1), 14);
  s2.getCell(1, 1).value = "Welke kolommen variëren per case";
  s2.getCell(2, 1).value = "Van de 122 kolommen variëren er per case 14 of 15. Het zijn steeds dezelfde, en het zijn allemaal bedragen.";
  s2.getCell(2, 1).font = { italic: true, size: 10 };

  const alle = [...new Set(cases.flatMap((c) => varieert(gI[c.ordreg_id])))].sort();
  const kop2 = ["kolom", ...cases.map((c) => c.ordreg_id), "in aantal cases"];
  const rijen2 = alle.map((k) => {
    const o = { kolom: k };
    let n = 0;
    cases.forEach((c) => { const v = varieert(gI[c.ordreg_id]).includes(k); o[c.ordreg_id] = v ? "varieert" : "constant"; if (v) n++; });
    o["in aantal cases"] = n;
    return o;
  });
  zetTabel(s2, 4, kop2, rijen2, cases.map((c) => ({
    kolom: c.ordreg_id, kleur: C.amber, tekst: C.amberTxt, test: (row) => row[c.ordreg_id] === "varieert",
  })));

  /* ---- Tabblad: omvang ---- */
  const s3 = wb.addWorksheet("Omvang", { views: [{ showGridLines: false }] });
  titel(s3.getCell(1, 1), 14);
  s3.getCell(1, 1).value = "Hoe vaak komt dit voor in de hele tabel";
  s3.getCell(2, 1).value = "Verdeling van het aantal regels per combinatie van orderregel en partij, over int_order_totaal in zijn geheel.";
  s3.getCell(2, 1).font = { italic: true, size: 10 };
  const omv = omvang.map((o) => ({ ...o, aandeel: "" }));
  const totComb = omv.reduce((s, o) => s + Number(o.combinaties), 0);
  omv.forEach((o) => { o.aandeel = (Number(o.combinaties) / totComb * 100).toFixed(2) + "%"; });
  let r3 = zetTabel(s3, 4, ["aantal_regels", "combinaties", "totaal_rijen", "aandeel"], omv);
  r3 += 2;
  s3.getCell(r3, 1).value = "Duiding";
  s3.getCell(r3, 1).font = { bold: true, size: 11, color: { argb: C.donker } };
  const meer = omv.filter((o) => o.aantal_regels !== "1 regel");
  const combMeer = meer.reduce((s, o) => s + Number(o.combinaties), 0);
  const rijenMeer = meer.reduce((s, o) => s + Number(o.totaal_rijen), 0);
  s3.getCell(r3 + 1, 1).value =
    `Verreweg de meeste combinaties zijn in orde: ${(totComb - combMeer).toLocaleString("nl-NL")} van de ${totComb.toLocaleString("nl-NL")} leveren precies één regel op. ` +
    `De vermenigvuldiging treft ${combMeer.toLocaleString("nl-NL")} combinaties (${(combMeer / totComb * 100).toFixed(1)}%), die samen ${rijenMeer.toLocaleString("nl-NL")} regels opleveren waar er ` +
    `${combMeer.toLocaleString("nl-NL")} zouden volstaan — ruim ${(rijenMeer - combMeer).toLocaleString("nl-NL")} regels te veel.\n\n` +
    "Het gaat dus niet om het hele model, maar om een minderheid van de gevallen. Voor de portal is dat niettemin blokkerend, omdat juist die gevallen niet te sleutelen zijn.";
  s3.getCell(r3 + 1, 1).alignment = { wrapText: true, vertical: "top" };
  s3.mergeCells(r3 + 1, 1, r3 + 6, 8);

  /* ---- Tabblad: ruwe data ---- */
  const s4 = wb.addWorksheet("Vijf cases - ruwe data", { views: [{ state: "frozen", ySplit: 3 }] });
  titel(s4.getCell(1, 1), 14);
  s4.getCell(1, 1).value = "Volledige uitvoer int_order_totaal — 5 cases, 122 kolommen";
  s4.getCell(2, 1).value = "Variërende kolommen zijn gemarkeerd. Alle overige zijn binnen een case identiek.";
  s4.getCell(2, 1).font = { italic: true, size: 10 };
  const kolIot = Object.keys(iot[0]);
  const varAlle = new Set(alle);
  zetTabel(s4, 3, kolIot, iot);
  kolIot.forEach((k, ci) => {
    if (!varAlle.has(k)) return;
    for (let i = 0; i <= iot.length; i++) {
      const cell = s4.getRow(3 + i).getCell(ci + 1);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.amber } };
      if (i === 0) cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    }
  });

  await wb.xlsx.writeFile(XLSX);
  console.log("Bijgewerkt: " + XLSX);
  console.table(cases.map((c) => ({ ordreg: c.ordreg_id, bron: c.bron_regels, uit: c.uitvoer_regels,
    factor: c.factor, varieren: c.varieren, constant: c.constant, prod: c.productie_input, som: c.som_klopt })));
})().catch((e) => { console.error("FOUT: " + e.stack); process.exit(1); });
