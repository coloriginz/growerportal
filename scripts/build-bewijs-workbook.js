/*
 * Bouwt een presenteerbaar Excel-document uit de ruwe query-export.
 * Bron : private_input/output queries.xlsx   (4 tabbladen, kop op rij 2, data vanaf rij 3)
 * Doel : private_input/Rijvermenigvuldiging KBT - bewijsvoering.xlsx
 */
const ExcelJS = require("exceljs");

const SRC = "private_input/output queries.xlsx";
const DST = "private_input/Rijvermenigvuldiging KBT - bewijsvoering.xlsx";

const CASUS = { ordreg: 14149196, part: 4879469 };
const CONTRAST = { ordreg: 14117583 };

const QUERIES = {
  q1: {
    titel: "Query 1 — bronrij uit de KBT landing zone",
    tabel: "lh_landing.kbtpro.verd",
    sql: `SELECT * FROM lh_landing.kbtpro.verd\nWHERE ordreg_id = ${CASUS.ordreg} AND part_id = ${CASUS.part};`,
    duiding: "De bron. Eén verdeelregel: deze orderregel wordt uit deze partij gevuld, eenmalig.",
  },
  q2: {
    titel: "Query 2 — dezelfde combinatie in de transformatielaag",
    tabel: "intermediate.int_order_totaal",
    sql: `SELECT * FROM intermediate.int_order_totaal\nWHERE ordreg_id = ${CASUS.ordreg} AND part_id = ${CASUS.part};`,
    duiding: "Dezelfde ene verdeelregel, nu als 64 regels. Zie tabblad Analyse voor wat er varieert.",
  },
  q3: {
    titel: "Query 3 — dezelfde combinatie in de gold layer",
    tabel: "marts.fct_orders",
    sql: `SELECT * FROM marts.fct_orders\nWHERE ordreg_id = ${CASUS.ordreg} AND part_id = ${CASUS.part};`,
    duiding: "De 64 regels gaan ongewijzigd door naar marts. De kolom verd_id is hier niet meer aanwezig.",
  },
  q4: {
    titel: "Query 4 — contrastcasus: legitieme herkomsttracering",
    tabel: "intermediate.int_order_totaal",
    sql: `SELECT * FROM intermediate.int_order_totaal\nWHERE ordreg_id = ${CONTRAST.ordreg};`,
    duiding:
      "Een orderregel die uit veel verschillende partijen wordt gevuld. Hier hoort een regel per herkomst, en dat gebeurt ook. Dit is GEEN probleem.",
  },
};

/* ---------- kleuren en stijlen ---------- */
const C = {
  donker: "FF1F3864",
  accent: "FF2E75B6",
  groen: "FFC6EFCE",
  groenTxt: "FF006100",
  amber: "FFFFEB9C",
  amberTxt: "FF9C6500",
  grijs: "FFF2F2F2",
  rand: "FFBFBFBF",
};

const titelStijl = (cell, size = 16) => {
  cell.font = { bold: true, size, color: { argb: C.donker } };
};
const kopStijl = (row) => {
  row.eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.accent } };
    c.alignment = { vertical: "middle", wrapText: false };
    c.border = { bottom: { style: "thin", color: { argb: C.rand } } };
  });
  row.height = 20;
};

const leesCel = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === "object") {
    if (v.result !== undefined) return v.result;
    if (v.text !== undefined) return v.text;
    if (v instanceof Date) return v;
    return String(v);
  }
  return v;
};

const alsTekst = (v) => {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 19).replace("T", " ");
  return String(v);
};

/* ---------- inlezen ---------- */
async function leesBron() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(SRC);
  const uit = {};
  wb.worksheets.forEach((ws, i) => {
    const kop = ws.getRow(2).values.slice(1).map((v) => alsTekst(leesCel(v)));
    const rijen = [];
    for (let r = 3; r <= ws.rowCount; r++) {
      const vals = ws.getRow(r).values.slice(1);
      if (vals.every((v) => v === null || v === undefined || v === "")) continue;
      rijen.push(kop.map((_, k) => leesCel(vals[k])));
    }
    uit["q" + (i + 1)] = { kop, rijen };
  });
  return uit;
}

/* ---------- analyse ---------- */
function analyseer(kop, rijen) {
  return kop.map((naam, k) => {
    const waarden = rijen.map((r) => alsTekst(r[k]));
    const uniek = [...new Set(waarden)];
    return {
      naam,
      uniek: uniek.length,
      constant: uniek.length <= 1,
      waarde: uniek.length === 1 ? uniek[0] : "",
      voorbeelden: uniek.slice(0, 6).join("  ·  "),
    };
  });
}

/* ---------- opbouw ---------- */
(async () => {
  const data = await leesBron();
  const wb = new ExcelJS.Workbook();
  wb.creator = "Grower Portal";
  wb.created = new Date();

  const a2 = analyseer(data.q2.kop, data.q2.rijen);
  const a3 = analyseer(data.q3.kop, data.q3.rijen);
  const a4 = analyseer(data.q4.kop, data.q4.rijen);

  const varieert2 = a2.filter((x) => !x.constant);
  const varieert3 = a3.filter((x) => !x.constant);
  const varieert4 = a4.filter((x) => !x.constant);

  const somQ1 = data.q1.rijen.reduce(
    (s, r) => s + (Number(r[data.q1.kop.indexOf("aantalst")]) || 0), 0);
  const somQ2 = data.q2.rijen.reduce(
    (s, r) => s + (Number(r[data.q2.kop.indexOf("vor_aantal")]) || 0), 0);
  const somQ3 = data.q3.rijen.reduce(
    (s, r) => s + (Number(r[data.q3.kop.indexOf("vor_aantal")]) || 0), 0);

  const partIdxQ4 = data.q4.kop.indexOf("part_id");
  const partijenQ4 = new Set(data.q4.rijen.map((r) => alsTekst(r[partIdxQ4]))).size;

  /* ===== 1. Toelichting ===== */
  const s1 = wb.addWorksheet("Toelichting", { views: [{ showGridLines: false }] });
  s1.columns = [{ width: 3 }, { width: 30 }, { width: 95 }];
  let r = 2;
  titelStijl(s1.getCell(r, 2), 18);
  s1.getCell(r, 2).value = "Rijvermenigvuldiging in de KBT-transformatielaag";
  s1.mergeCells(r, 2, r, 3);
  r += 2;

  const blok = (label, tekst, kleur) => {
    const c = s1.getCell(r, 2);
    c.value = label;
    c.font = { bold: true, size: 11, color: { argb: C.donker } };
    c.alignment = { vertical: "top" };
    const t = s1.getCell(r, 3);
    t.value = tekst;
    t.alignment = { wrapText: true, vertical: "top" };
    if (kleur) t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: kleur } };
    s1.getRow(r).height = Math.max(18, Math.ceil(tekst.length / 105) * 15 + 6);
    r += 1;
  };

  blok("Onderwerp", "Eén orderregel die in de bron door één verdeelregel uit één partij wordt gevuld, verschijnt in de transformatielaag als 64 regels.");
  blok("Casus", `ordreg_id = ${CASUS.ordreg}   ·   part_id = ${CASUS.part}`);
  blok("Datum meting", "31 juli 2026, omgeving DPL-COL-DEV");
  r += 1;

  blok("Waar we het over eens zijn",
    "Herkomsttracering over productiestappen is waardevol en willen we behouden. Een orderregel die uit tientallen partijen wordt gevuld, hoort tientallen regels op te leveren — één per herkomst. Tabblad 'Query 4' laat zo'n geval zien: " +
    `${partijenQ4} verschillende partijen, ${data.q4.rijen.length} regels. Daar is niets mis mee.`,
    C.groen);
  r += 1;

  blok("Wat wij signaleren",
    `Bij de casus hierboven is er maar één partij en één verdeelregel, en toch ${data.q2.rijen.length} regels. Er valt hier maar één herkomst te traceren. Van de ${a2.length} kolommen in int_order_totaal ` +
    `heeft er ${a2.length - varieert2.length} precies één waarde over alle ${data.q2.rijen.length} regels. Alleen ${varieert2.length} kolom(men) verschilt, en dat zijn uitsluitend bedragen — geen kenmerk dat de regels van elkaar onderscheidt.`,
    C.amber);
  r += 1;

  blok("Rekenkundig klopt het",
    `De som blijft gelijk: bron ${somQ1} stelen, int_order_totaal ${somQ2.toFixed(3)}, fct_orders ${somQ3.toFixed(3)}. Het aantal wordt niet gedupliceerd maar verdeeld. Elke gesommeerde measure in Power BI geeft dus het juiste antwoord — de rapportage is niet fout.`);
  r += 1;

  blok("Waarom het voor ons wél een probleem is",
    "De grower portal leest regels, geen aggregaten. Elke regel wordt een transactie die aan een kweker wordt getoond en die we bij een volgende import moeten terugvinden. Daarvoor is een stabiele sleutel per regel nodig. Bij 64 regels die op elke kolom identiek zijn bestaat die sleutel niet, dus kunnen we ze niet uit elkaar houden en niet bijwerken.");
  r += 1;

  blok("Onze vragen",
    "1. Is deze vermenigvuldiging bedoeld?\n" +
    "2. Zit er een kenmerk in dat wij over het hoofd zien? Als dat zo is, is ons signaal onterecht en horen we dat graag.\n" +
    "3. Kan verd_id meegeleverd worden in marts.fct_orders? Die staat wel in int_order_totaal maar valt weg in marts.");
  r += 2;

  blok("Leeswijzer",
    "Analyse       — per kolom het aantal unieke waarden over de 64 regels. Dit is de kern.\n" +
    "Getransponeerd — kolommen als rijen, de 64 regels naast elkaar. Hier zie je de herhaling.\n" +
    "Query 1 t/m 4 — de gedraaide queries met de volledige ruwe uitvoer eronder.");

  /* ===== 2. Analyse ===== */
  const s2 = wb.addWorksheet("Analyse", { views: [{ state: "frozen", ySplit: 8 }] });
  s2.columns = [{ width: 6 }, { width: 34 }, { width: 16 }, { width: 26 }, { width: 70 }];
  titelStijl(s2.getCell(1, 1), 14);
  s2.getCell(1, 1).value = `Analyse — int_order_totaal, ordreg_id ${CASUS.ordreg} / part_id ${CASUS.part}`;
  s2.getCell(2, 1).value = `${data.q2.rijen.length} regels · ${a2.length} kolommen · ${a2.length - varieert2.length} kolommen met één unieke waarde · ${varieert2.length} met meer dan één`;
  s2.getCell(2, 1).font = { size: 11, color: { argb: C.donker } };
  s2.getCell(4, 1).value = "Kolommen die variëren staan bovenaan. Alles daaronder is over alle 64 regels identiek.";
  s2.getCell(4, 1).font = { italic: true, size: 10 };
  s2.getCell(6, 1).value = `Somcontrole: bron ${somQ1} · int_order_totaal ${somQ2.toFixed(3)} · fct_orders ${somQ3.toFixed(3)}`;
  s2.getCell(6, 1).font = { bold: true, size: 10, color: { argb: C.groenTxt } };

  const kop2 = s2.getRow(8);
  kop2.values = ["#", "kolom", "unieke waarden", "oordeel", "waarde (indien constant) / voorbeelden"];
  kopStijl(kop2);

  const gesorteerd = [...a2].sort((x, y) => y.uniek - x.uniek || x.naam.localeCompare(y.naam));
  gesorteerd.forEach((k, i) => {
    const row = s2.getRow(9 + i);
    row.values = [
      i + 1,
      k.naam,
      k.uniek,
      k.constant ? "constant" : "VARIEERT",
      k.constant ? k.waarde : k.voorbeelden,
    ];
    const vul = k.constant ? C.groen : C.amber;
    const txt = k.constant ? C.groenTxt : C.amberTxt;
    [3, 4].forEach((c) => {
      row.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: vul } };
      row.getCell(c).font = { bold: !k.constant, color: { argb: txt } };
    });
    if (i % 2 === 1) {
      [1, 2, 5].forEach((c) => {
        row.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.grijs } };
      });
    }
  });
  s2.autoFilter = { from: { row: 8, column: 1 }, to: { row: 8 + gesorteerd.length, column: 5 } };

  /* ===== 3. Getransponeerd ===== */
  const s3 = wb.addWorksheet("Getransponeerd", { views: [{ state: "frozen", xSplit: 3, ySplit: 4 }] });
  titelStijl(s3.getCell(1, 1), 14);
  s3.getCell(1, 1).value = "Getransponeerd — elke kolom als rij, de 64 regels naast elkaar";
  s3.getCell(2, 1).value = "Loop een rij horizontaal af: op vrijwel elke rij staat 64 keer dezelfde waarde.";
  s3.getCell(2, 1).font = { italic: true, size: 10 };

  const kop3 = s3.getRow(4);
  kop3.values = ["kolom", "uniek", "oordeel", ...data.q2.rijen.map((_, i) => `regel ${i + 1}`)];
  kopStijl(kop3);
  s3.getColumn(1).width = 34;
  s3.getColumn(2).width = 8;
  s3.getColumn(3).width = 12;
  for (let c = 4; c <= 3 + data.q2.rijen.length; c++) s3.getColumn(c).width = 15;

  a2.forEach((k, i) => {
    const kIdx = data.q2.kop.indexOf(k.naam);
    const row = s3.getRow(5 + i);
    row.values = [
      k.naam,
      k.uniek,
      k.constant ? "constant" : "VARIEERT",
      ...data.q2.rijen.map((rr) => alsTekst(rr[kIdx])),
    ];
    const vul = k.constant ? C.groen : C.amber;
    const txt = k.constant ? C.groenTxt : C.amberTxt;
    [2, 3].forEach((c) => {
      row.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: vul } };
      row.getCell(c).font = { bold: !k.constant, color: { argb: txt } };
    });
    if (!k.constant) {
      for (let c = 4; c <= 3 + data.q2.rijen.length; c++) {
        row.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.amber } };
      }
    }
    row.getCell(1).font = { bold: !k.constant };
  });

  /* ===== 4. Ruwe data per query ===== */
  const analyses = { q2: a2, q3: a3, q4: a4 };
  ["q1", "q2", "q3", "q4"].forEach((key) => {
    const meta = QUERIES[key];
    const d = data[key];
    const ws = wb.addWorksheet(meta.titel.split(" — ")[0], {
      views: [{ state: "frozen", ySplit: 9 }],
    });
    titelStijl(ws.getCell(1, 1), 14);
    ws.getCell(1, 1).value = meta.titel;
    ws.getCell(2, 1).value = `Tabel: ${meta.tabel}`;
    ws.getCell(2, 1).font = { size: 10, color: { argb: C.donker } };
    ws.getCell(3, 1).value = meta.duiding;
    ws.getCell(3, 1).font = { italic: true, size: 10 };

    ws.getCell(5, 1).value = "Gedraaide query:";
    ws.getCell(5, 1).font = { bold: true, size: 10 };
    ws.getCell(6, 1).value = meta.sql;
    ws.getCell(6, 1).font = { name: "Consolas", size: 10 };
    ws.getCell(6, 1).alignment = { wrapText: true, vertical: "top" };
    ws.getRow(6).height = 34;

    ws.getCell(8, 1).value = `Resultaat: ${d.rijen.length} ${d.rijen.length === 1 ? "regel" : "regels"} · ${d.kop.length} kolommen`;
    ws.getCell(8, 1).font = { bold: true, size: 10 };

    const kop = ws.getRow(9);
    kop.values = d.kop;
    kopStijl(kop);
    d.rijen.forEach((rr, i) => {
      const row = ws.getRow(10 + i);
      row.values = rr.map((v) => (v instanceof Date ? alsTekst(v) : v));
      if (i % 2 === 1) {
        row.eachCell((c) => {
          c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.grijs } };
        });
      }
    });

    // markeer variërende kolommen
    const an = analyses[key];
    if (an) {
      an.forEach((k, ci) => {
        if (k.constant) return;
        for (let rIdx = 0; rIdx <= d.rijen.length; rIdx++) {
          const cell = ws.getRow(9 + rIdx).getCell(ci + 1);
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.amber } };
          if (rIdx === 0) cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        }
      });
    }

    d.kop.forEach((h, i) => {
      ws.getColumn(i + 1).width = Math.min(Math.max(String(h).length + 3, 12), 28);
    });
  });

  /* ===== 5. Contrast-analyse ===== */
  const s5 = wb.addWorksheet("Contrast", { views: [{ showGridLines: false }] });
  s5.columns = [{ width: 3 }, { width: 44 }, { width: 26 }, { width: 26 }];
  titelStijl(s5.getCell(2, 2), 14);
  s5.getCell(2, 2).value = "Contrast: legitieme tracering versus rijvermenigvuldiging";
  s5.mergeCells(2, 2, 2, 4);

  const kop5 = s5.getRow(4);
  kop5.values = ["", "", `Query 4 — ordreg ${CONTRAST.ordreg}`, `Query 2 — ordreg ${CASUS.ordreg}`];
  kopStijl(kop5);

  const cRows = [
    ["Aantal regels in de uitvoer", data.q4.rijen.length, data.q2.rijen.length],
    ["Aantal verschillende partijen (part_id)", partijenQ4, new Set(data.q2.rijen.map((rr) => alsTekst(rr[data.q2.kop.indexOf("part_id")]))).size],
    ["Aantal verschillende verdeelregels (verd_id)",
      new Set(data.q4.rijen.map((rr) => alsTekst(rr[data.q4.kop.indexOf("verd_id")]))).size,
      new Set(data.q2.rijen.map((rr) => alsTekst(rr[data.q2.kop.indexOf("verd_id")]))).size],
    ["Kolommen die variëren", varieert4.length, varieert2.length],
    ["Kolommen die constant zijn", a4.length - varieert4.length, a2.length - varieert2.length],
    ["Regels per partij", (data.q4.rijen.length / partijenQ4).toFixed(1), data.q2.rijen.length.toFixed(1)],
  ];
  cRows.forEach((rw, i) => {
    const row = s5.getRow(5 + i);
    row.values = ["", rw[0], rw[1], rw[2]];
    row.getCell(2).font = { bold: true, size: 10 };
    row.getCell(3).alignment = { horizontal: "center" };
    row.getCell(4).alignment = { horizontal: "center" };
    row.getCell(3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.groen } };
    row.getCell(4).fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.amber } };
  });

  const uitleg = s5.getCell(5 + cRows.length + 2, 2);
  uitleg.value =
    `Links: ${partijenQ4} verschillende partijen leveren ${data.q4.rijen.length} regels — ongeveer één per herkomst. Dat is precies wat herkomsttracering hoort te doen.\n\n` +
    `Rechts: één partij en één verdeelregel leveren ${data.q2.rijen.length} regels, waarvan er ${varieert2.length} van de ${a2.length} kolommen verschilt en die uitsluitend bedragen bevat. Er is geen tweede herkomst om te traceren.`;
  uitleg.alignment = { wrapText: true, vertical: "top" };
  s5.mergeCells(5 + cRows.length + 2, 2, 5 + cRows.length + 6, 4);

  await wb.xlsx.writeFile(DST);
  console.log("Geschreven: " + DST);
  console.log(`  Query 2: ${data.q2.rijen.length} regels, ${a2.length} kolommen, ${varieert2.length} variëren -> ${varieert2.map((v) => v.naam).join(", ")}`);
  console.log(`  Query 3: ${data.q3.rijen.length} regels, ${a3.length} kolommen, ${varieert3.length} variëren -> ${varieert3.map((v) => v.naam).join(", ")}`);
  console.log(`  Query 4: ${data.q4.rijen.length} regels, ${a4.length} kolommen, ${varieert4.length} variëren, ${partijenQ4} partijen`);
  console.log(`  Sommen: bron ${somQ1} | q2 ${somQ2} | q3 ${somQ3}`);
})().catch((e) => { console.error("FOUT:", e.stack); process.exit(1); });
