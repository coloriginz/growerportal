/*
 * Herstelt decimalen die bij het exporteren zijn verminkt.
 *
 * Oorzaak: Excel las de Nederlandse decimale komma als duizendtalscheiding.
 *   "19,896373" -> 19896373     (verminkt)
 *   "0,248704"  -> 0.248704     (correct, want geen cijfergroep voor de komma)
 *
 * Herstelregel: binnen een decimale kolom is een waarde verminkt als hij geheel is
 * en >= 1.000.000. Delen door 1.000.000 herstelt hem. Waarden met decimalen blijven
 * ongemoeid. Deze regel is zelfcorrigerend: een echte waarde van 2.000000 exporteert
 * als 2000000 en wordt terecht weer 2.
 *
 * De uitkomst wordt geverifieerd tegen vier kolommen die rechtstreeks in de database
 * zijn gemeten, plus tegen het brontotaal van 3840 stelen. Bij afwijking stopt het script.
 */
const ExcelJS = require("exceljs");

const BESTAND = "private_input/output queries.xlsx";
const DREMPEL = 1_000_000;

const isDecimaalKolom = (naam) =>
  /^vor_|prijs|kost|waarde|omzet|opslag|commissie|heffing|winst|marge|reserver|fraction|dekkings|per_steel|_ape$|voorzien/i.test(naam) &&
  !/_id$|_key$|datum|nummer|nr$|code/i.test(naam);

/*
 * De export leverde twee soorten cellen op binnen dezelfde kolom:
 *   - tekst met de juiste waarde ("0.248704")  -> alleen omzetten naar getal
 *   - getal dat verminkt is (1243523)          -> delen door een miljoen
 */
const herstel = (v) => {
  if (typeof v === "string") {
    const s = v.trim().replace(",", ".");
    if (s !== "" && !isNaN(Number(s))) return Number(s);
    return v;
  }
  if (typeof v !== "number") return v;
  if (!Number.isInteger(v)) return v;
  if (Math.abs(v) < DREMPEL) return v;
  return v / DREMPEL;
};

// Referentiewaarden, rechtstreeks in de database gemeten (casus ordreg 14149196 / part 4879469)
const REF = {
  vor_aantal: [19.896373, 39.792746, 59.689119, 79.585492, 99.481865, 119.378238, 139.274611, 159.170984, 179.067357],
  vor_colli: [0.248704, 0.497409, 0.746113, 0.994818, 1.243523, 1.492227, 1.740932, 1.989637, 2.238341],
  vor_omzet: [12.932642, 25.865285, 38.797927, 51.73057, 64.663212, 77.595855, 90.528497, 103.46114, 116.393782],
  vor_inkoopwaarde: [15.539067, 31.078135, 46.617202, 62.156269, 77.695337, 93.234404, 108.773471, 124.312539, 139.851606],
};
const BRON_TOTAAL = 3840;

(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(BESTAND);

  let aangepast = 0;
  const perTabblad = [];

  wb.worksheets.forEach((ws) => {
    const kop = ws.getRow(2).values.slice(1).map((v) => (v == null ? "" : String(v)));
    const kolommen = kop.map((n, i) => ({ naam: n, idx: i + 1, decimaal: isDecimaalKolom(n) }));
    let n = 0;
    kolommen.filter((k) => k.decimaal).forEach((k) => {
      for (let r = 3; r <= ws.rowCount; r++) {
        const cel = ws.getRow(r).getCell(k.idx);
        const nieuw = herstel(cel.value);
        if (nieuw !== cel.value) { cel.value = nieuw; n++; }
      }
    });
    aangepast += n;
    perTabblad.push({ naam: ws.name, kolommen: kolommen.filter((k) => k.decimaal).length, cellen: n });
  });

  // ---- verificatie ----
  const ws2 = wb.worksheets[1]; // Query 2
  const kop2 = ws2.getRow(2).values.slice(1).map(String);
  const fouten = [];

  for (const [naam, ref] of Object.entries(REF)) {
    const idx = kop2.indexOf(naam) + 1;
    const uniek = new Set();
    for (let r = 3; r <= ws2.rowCount; r++) {
      const v = ws2.getRow(r).getCell(idx).value;
      if (typeof v === "number") uniek.add(Number(v.toFixed(6)));
    }
    const lijst = [...uniek].sort((a, b) => a - b);
    const verwacht = [...ref].sort((a, b) => a - b).map((x) => Number(x.toFixed(6)));
    const gelijk = lijst.length === verwacht.length && lijst.every((v, i) => Math.abs(v - verwacht[i]) < 1e-6);
    if (!gelijk) fouten.push(`${naam}: kreeg [${lijst.join(", ")}] verwacht [${verwacht.join(", ")}]`);
    else console.log(`  OK  ${naam}: ${lijst.length} unieke waarden komen exact overeen met de database`);
  }

  const idxA = kop2.indexOf("vor_aantal") + 1;
  let som = 0;
  for (let r = 3; r <= ws2.rowCount; r++) {
    const v = ws2.getRow(r).getCell(idxA).value;
    if (typeof v === "number") som += v;
  }
  if (Math.abs(som - BRON_TOTAAL) > 0.001) fouten.push(`som vor_aantal = ${som}, verwacht ~${BRON_TOTAAL}`);
  else console.log(`  OK  som vor_aantal = ${som.toFixed(6)} tegenover brontotaal ${BRON_TOTAAL}`);

  if (fouten.length) {
    console.error("\nVERIFICATIE MISLUKT — bestand NIET aangepast:");
    fouten.forEach((f) => console.error("  - " + f));
    process.exit(1);
  }

  await wb.xlsx.writeFile(BESTAND);
  console.log(`\n${aangepast} cellen hersteld in ${BESTAND}`);
  perTabblad.forEach((t) => console.log(`  ${t.naam}: ${t.kolommen} decimale kolommen, ${t.cellen} cellen aangepast`));
})().catch((e) => { console.error("FOUT:", e.stack); process.exit(1); });
