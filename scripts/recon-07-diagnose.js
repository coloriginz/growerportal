/*
 * Stap 7: ontleed de resterende verschillen tussen PDF en portal.
 * Doel: elk verschil aan een oorzaak toewijzen in plaats van het als ruis te laten staan.
 */
const fs = require("fs");
const r = JSON.parse(fs.readFileSync("private_input/recon-drieweg.json", "utf8"));
const werk = JSON.parse(fs.readFileSync("private_input/recon-werklijst.json", "utf8"));
const datum = new Map(werk.filter((w) => w.parthdr_id).map((w) => [String(w.parthdr_id), w.portal_leverdatum]));

const n = (v) => (v === null || v === undefined ? 0 : Number(v));
const bijna = (a, b, tol = 0.5) => Math.abs(n(a) - n(b)) < tol;

const rijen = r.map((x) => ({
  ...x,
  leverdatum: datum.get(String(x.parthdr)) || null,
  d_omzet: +(n(x.portal_omzet) - n(x.pdf_omzet)).toFixed(2),
  d_kosten: +(n(x.portal_kosten) - n(x.pdf_kosten)).toFixed(2),
  d_netto: +(n(x.portal_netto) - n(x.pdf_netto)).toFixed(2),
  pdf_zonder_prod: +(n(x.pdf_omzet) - n(x.pdf_productie)).toFixed(2),
}));

/* ---------- 1. verklaring per salessheet ---------- */
function verklaar(x) {
  if (bijna(x.portal_omzet, x.pdf_omzet)) return "omzet klopt";
  if (x.pdf_productie && bijna(x.portal_omzet, x.pdf_zonder_prod)) return "portal mist productieomzet";
  if (x.pdf_productie) return "productie aanwezig, maar verschil niet exact verklaard";
  return "onverklaard verschil zonder productie";
}
const groepen = {};
for (const x of rijen) { const k = verklaar(x); (groepen[k] ||= []).push(x); }

console.log("=".repeat(80));
console.log("VERKLARING VAN DE OMZETVERSCHILLEN (portal tegenover PDF)");
console.log("=".repeat(80));
console.table(Object.entries(groepen).sort((a, b) => b[1].length - a[1].length).map(([k, v]) => ({
  verklaring: k,
  salessheets: v.length,
  aandeel: (v.length / rijen.length * 100).toFixed(1) + "%",
  totaal_verschil: +v.reduce((s, x) => s + x.d_omzet, 0).toFixed(2),
})));

/* ---------- 2. de onverklaarde gevallen ---------- */
const onverklaard = [...(groepen["onverklaard verschil zonder productie"] || []),
                     ...(groepen["productie aanwezig, maar verschil niet exact verklaard"] || [])];
console.log(`\n${"=".repeat(80)}\nONVERKLAARDE GEVALLEN — ${onverklaard.length} stuks\n${"=".repeat(80)}`);
console.table(onverklaard.sort((a, b) => Math.abs(b.d_omzet) - Math.abs(a.d_omzet)).slice(0, 12).map((x) => ({
  lev: x.lev, parthdr: x.parthdr, leverdatum: x.leverdatum,
  pdf: x.pdf_omzet, portal: x.portal_omzet, bron: x.bron_omzet_afreken,
  verschil: x.d_omzet,
  prod: x.pdf_productie || 0,
  regels: `${x.pdf_tx}/${x.bron_regels}`,
})));

/* ---------- 3. wie staat dichter bij de PDF: portal of bron ---------- */
console.log(`\n${"=".repeat(80)}\nWIE VOLGT DE PDF HET BEST?\n${"=".repeat(80)}`);
let portalBeter = 0, bronBeter = 0, gelijkspel = 0;
for (const x of rijen) {
  const dp = Math.abs(n(x.portal_omzet) - n(x.pdf_omzet));
  const db = Math.abs(n(x.bron_omzet_afreken) - n(x.pdf_omzet));
  if (Math.abs(dp - db) < 0.01) gelijkspel++;
  else if (dp < db) portalBeter++;
  else bronBeter++;
}
console.table([{ portal_dichterbij: portalBeter, bron_dichterbij: bronBeter, gelijk: gelijkspel, totaal: rijen.length }]);

/* ---------- 4. bron tegenover PDF, gecorrigeerd voor productie ---------- */
const bronVsPdf = rijen.map((x) => +(n(x.bron_omzet_afreken) - n(x.pdf_omzet)).toFixed(2));
const binnen = (t) => bronVsPdf.filter((d) => Math.abs(d) < t).length;
console.log(`\nbron(afrekenprijs) tegenover PDF:`);
console.log(`  exact (<0,50)  : ${binnen(0.5)}/${rijen.length}`);
console.log(`  binnen 5 euro  : ${binnen(5)}/${rijen.length}`);
console.log(`  binnen 50 euro : ${binnen(50)}/${rijen.length}`);
console.log(`  totaal verschil: ${bronVsPdf.reduce((s, d) => s + d, 0).toFixed(2)}`);

/* ---------- 5. netto ---------- */
console.log(`\n${"=".repeat(80)}\nNETTO RESULTAAT (wat de kweker ontvangt)\n${"=".repeat(80)}`);
const nettoBinnen = (t) => rijen.filter((x) => Math.abs(x.d_netto) < t).length;
console.log(`  portal = PDF exact (<0,50) : ${nettoBinnen(0.5)}/${rijen.length}`);
console.log(`  binnen 5 euro              : ${nettoBinnen(5)}/${rijen.length}`);
console.log(`  binnen 50 euro             : ${nettoBinnen(50)}/${rijen.length}`);
const somNetto = rijen.reduce((s, x) => s + x.d_netto, 0);
console.log(`  totaal verschil            : ${somNetto.toFixed(2)} over ${rijen.length} salessheets`);
console.log(`  gemiddeld per salessheet   : ${(somNetto / rijen.length).toFixed(2)}`);

/* ---------- 6. per jaar ---------- */
console.log(`\n${"=".repeat(80)}\nPER JAAR\n${"=".repeat(80)}`);
const perJaar = {};
for (const x of rijen) {
  const j = x.leverdatum ? x.leverdatum.slice(0, 4) : "?";
  (perJaar[j] ||= []).push(x);
}
console.table(Object.entries(perJaar).sort().map(([j, v]) => ({
  jaar: j, salessheets: v.length,
  omzet_klopt: v.filter((x) => bijna(x.portal_omzet, x.pdf_omzet)).length,
  netto_klopt: v.filter((x) => Math.abs(x.d_netto) < 0.5).length,
  verschil_netto: +v.reduce((s, x) => s + x.d_netto, 0).toFixed(0),
})));

fs.writeFileSync("private_input/recon-diagnose.json", JSON.stringify(rijen, null, 1), "utf8");
console.log("\nDetail -> private_input/recon-diagnose.json");
