/*
 * Meet over een steekproef salessheet-PDF's het verschil tussen de leverdatum
 * (datum 1, notatie dd-mm-jjjj) en de afrekendatum (datum 2, notatie d-m-jj).
 * Volledig lokaal; geen database of Fabric nodig.
 */
const fs = require("fs");
const path = require("path");

const MAP = "private_input/salessheets/COL";
const AANTAL = Number(process.argv[2] || 200);

function verzamel(dir, uit = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) verzamel(p, uit);
    else if (/\.pdf$/i.test(e.name)) uit.push(p);
  }
  return uit;
}

const parseNL = (s) => {
  const m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/);
  if (!m) return null;
  let [, d, mo, y] = m;
  y = Number(y);
  if (y < 100) y += 2000;
  return new Date(Date.UTC(y, Number(mo) - 1, Number(d)));
};

(async () => {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const alle = verzamel(MAP);
  const stap = Math.max(1, Math.floor(alle.length / AANTAL));
  const keuze = [];
  for (let i = 0; i < alle.length && keuze.length < AANTAL; i += stap) keuze.push(alle[i]);

  const resultaten = [];
  let mislukt = 0;

  for (const f of keuze) {
    try {
      const doc = await getDocument({
        data: new Uint8Array(fs.readFileSync(f)), useSystemFonts: true, verbosity: 0,
      }).promise;
      const c = await doc.getPage(1).then((p) => p.getTextContent());
      const tekst = c.items.map((i) => i.str).join(" ");

      const d1 = (tekst.match(/\b\d{2}-\d{2}-\d{4}\b/) || [])[0];
      const d2 = (tekst.match(/\b\d{1,2}-\d{1,2}-\d{2}(?!\d)/g) || [])
        .filter((x) => !/^\d{2}-\d{2}-\d{4}$/.test(x)).pop();
      await doc.destroy();

      const a = d1 ? parseNL(d1) : null;
      const b = d2 ? parseNL(d2) : null;
      if (!a || !b) { mislukt++; continue; }
      resultaten.push({
        bestand: path.basename(f),
        lever: d1,
        afreken: d2,
        dagen: Math.round((b - a) / 86400000),
      });
    } catch { mislukt++; }
  }

  const n = resultaten.length;
  const gelijk = resultaten.filter((r) => r.dagen === 0).length;
  const dagen = resultaten.map((r) => r.dagen).sort((x, y) => x - y);
  const som = dagen.reduce((s, d) => s + d, 0);
  const mediaan = dagen[Math.floor(n / 2)];

  const buckets = { "0 dagen": 0, "1-7": 0, "8-14": 0, "15-30": 0, "31-60": 0, "60+": 0, "negatief": 0 };
  dagen.forEach((d) => {
    if (d < 0) buckets["negatief"]++;
    else if (d === 0) buckets["0 dagen"]++;
    else if (d <= 7) buckets["1-7"]++;
    else if (d <= 14) buckets["8-14"]++;
    else if (d <= 30) buckets["15-30"]++;
    else if (d <= 60) buckets["31-60"]++;
    else buckets["60+"]++;
  });

  console.log(`${alle.length} PDF's beschikbaar, ${keuze.length} onderzocht, ${n} bruikbaar (${mislukt} onleesbaar)\n`);
  console.log(`identieke datums : ${gelijk} van ${n}  (${(gelijk / n * 100).toFixed(1)}%)`);
  console.log(`gemiddeld verschil: ${(som / n).toFixed(1)} dagen`);
  console.log(`mediaan          : ${mediaan} dagen`);
  console.log(`bereik           : ${dagen[0]} t/m ${dagen[n - 1]} dagen\n`);
  console.table(Object.entries(buckets).map(([k, v]) => ({
    verschil: k, aantal: v, aandeel: (v / n * 100).toFixed(1) + "%",
  })));

  const maandgrens = resultaten.filter((r) => {
    const a = parseNL(r.lever), b = parseNL(r.afreken);
    return a.getUTCMonth() !== b.getUTCMonth() || a.getUTCFullYear() !== b.getUTCFullYear();
  });
  console.log(`\nAfrekening valt in een ANDERE maand dan de levering: ${maandgrens.length} van ${n} (${(maandgrens.length / n * 100).toFixed(1)}%)`);
})().catch((e) => { console.error("FOUT: " + e.message); process.exit(1); });
