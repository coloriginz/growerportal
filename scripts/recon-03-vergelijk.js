/*
 * Stap 3: bron uit KBT naast de portal leggen.
 *
 * Omzet uit de bron = som over verdeelregels van aantalst x ordreg.afrekenprijs.
 * Kosten uit de bron = som van shkost.bedrag per levering.
 * Netto = omzet - kosten. Dat is dezelfde formule die de portal hanteert.
 */
const fs = require("fs");

const [parthdr, part, verd, ordreg, ordhdr, partcor, shkost, prodpartijen, kost, reden] =
  JSON.parse(fs.readFileSync("private_input/recon-bron.json", "utf8"));
const werk = JSON.parse(fs.readFileSync("private_input/recon-werklijst.json", "utf8"));

const n = (v) => (v === null || v === undefined || v === "" ? 0 : Number(v));
const idx = (rows, key) => {
  const m = new Map();
  for (const r of rows) {
    const k = String(r[key]);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
};

const ordregById = new Map(ordreg.map((o) => [String(o.ordreg_id), o]));
const ordhdrById = new Map(ordhdr.map((h) => [String(h.ordhdr_id), h]));
const partPerLevering = idx(part, "parthdr_id");
const verdPerPart = idx(verd, "part_id");
const kostPerLevering = idx(shkost, "parthdr_id");
const corPerPart = idx(partcor, "part_id");
const werkPerLevering = new Map(werk.filter((w) => w.parthdr_id).map((w) => [String(w.parthdr_id), w]));

console.log("=".repeat(78));
console.log("RECONCILIATIE  —  bron (KBT) tegenover portal");
console.log("=".repeat(78));

const rijen = [];
for (const ph of parthdr) {
  const key = String(ph.parthdr_id);
  const w = werkPerLevering.get(key);
  if (!w) continue;

  const lots = partPerLevering.get(key) || [];
  let omzet = 0, stelen = 0, verdRegels = 0;
  for (const p of lots) {
    for (const v of verdPerPart.get(String(p.part_id)) || []) {
      const o = ordregById.get(String(v.ordreg_id));
      if (!o) continue;
      omzet += n(v.aantalst) * n(o.afrekenprijs);
      stelen += n(v.aantalst);
      verdRegels++;
    }
  }
  const kosten = (kostPerLevering.get(key) || []).reduce((s, k) => s + n(k.bedrag), 0);

  rijen.push({
    leverancier: w.leverancier,
    parthdr_id: ph.parthdr_id,
    factnum: ph.factnum,
    lots_bron: lots.length,
    lots_portal: w.lots,
    verdeelregels: verdRegels,
    stelen_bron: Math.round(stelen),
    omzet_bron: +omzet.toFixed(2),
    omzet_portal: +w.portal_omzet.toFixed(2),
    kosten_bron: +kosten.toFixed(2),
    kosten_portal: +w.portal_kosten.toFixed(2),
    netto_bron: +(omzet - kosten).toFixed(2),
    netto_portal: +w.portal_netto.toFixed(2),
    kostenregels_bron: (kostPerLevering.get(key) || []).length,
    kostenregels_portal: w.kostenregels,
  });
}

const afw = (a, b) => (Math.abs(a) < 0.01 && Math.abs(b) < 0.01 ? 0 : Math.abs(a - b));
const pct = (a, b) => (Math.abs(b) < 0.01 ? (Math.abs(a) < 0.01 ? 0 : 100) : Math.abs((a - b) / b) * 100);

for (const lev of ["PCFUP", "COLBFL"]) {
  const r = rijen.filter((x) => x.leverancier === lev);
  if (!r.length) continue;
  const som = (f) => r.reduce((s, x) => s + f(x), 0);

  console.log(`\n${"-".repeat(78)}\n${lev}  —  ${r.length} leveringen\n${"-".repeat(78)}`);
  console.table([
    { grootheid: "aantal lots", bron: som((x) => x.lots_bron), portal: som((x) => x.lots_portal) },
    { grootheid: "kostenregels", bron: som((x) => x.kostenregels_bron), portal: som((x) => x.kostenregels_portal) },
    { grootheid: "omzet", bron: +som((x) => x.omzet_bron).toFixed(2), portal: +som((x) => x.omzet_portal).toFixed(2) },
    { grootheid: "kosten", bron: +som((x) => x.kosten_bron).toFixed(2), portal: +som((x) => x.kosten_portal).toFixed(2) },
    { grootheid: "netto", bron: +som((x) => x.netto_bron).toFixed(2), portal: +som((x) => x.netto_portal).toFixed(2) },
  ]);

  const tel = (veld, veld2) => {
    const gelijk = r.filter((x) => afw(x[veld], x[veld2]) < 0.5).length;
    const groot = r.filter((x) => pct(x[veld], x[veld2]) > 5).length;
    return { gelijk, groot, van: r.length };
  };
  const o = tel("omzet_bron", "omzet_portal");
  const k = tel("kosten_bron", "kosten_portal");
  const nt = tel("netto_bron", "netto_portal");
  console.log(`  omzet  gelijk in ${o.gelijk}/${o.van} leveringen, >5% afwijking in ${o.groot}`);
  console.log(`  kosten gelijk in ${k.gelijk}/${k.van} leveringen, >5% afwijking in ${k.groot}`);
  console.log(`  netto  gelijk in ${nt.gelijk}/${nt.van} leveringen, >5% afwijking in ${nt.groot}`);
}

console.log(`\n${"=".repeat(78)}\nGROOTSTE AFWIJKINGEN OP OMZET\n${"=".repeat(78)}`);
console.table([...rijen].sort((a, b) => afw(b.omzet_bron, b.omzet_portal) - afw(a.omzet_bron, a.omzet_portal))
  .slice(0, 8).map((x) => ({
    lev: x.leverancier, parthdr: x.parthdr_id, factnum: x.factnum,
    lots: `${x.lots_bron}/${x.lots_portal}`,
    omzet_bron: x.omzet_bron, omzet_portal: x.omzet_portal,
    verschil: +(x.omzet_bron - x.omzet_portal).toFixed(2),
  })));

console.log(`\n${"=".repeat(78)}\nGROOTSTE AFWIJKINGEN OP KOSTEN\n${"=".repeat(78)}`);
console.table([...rijen].sort((a, b) => afw(b.kosten_bron, b.kosten_portal) - afw(a.kosten_bron, a.kosten_portal))
  .slice(0, 8).map((x) => ({
    lev: x.leverancier, parthdr: x.parthdr_id, factnum: x.factnum,
    regels: `${x.kostenregels_bron}/${x.kostenregels_portal}`,
    kosten_bron: x.kosten_bron, kosten_portal: x.kosten_portal,
    verschil: +(x.kosten_bron - x.kosten_portal).toFixed(2),
  })));

// ---- productiecontrole ----
console.log(`\n${"=".repeat(78)}\nPRODUCTIECONTROLE\n${"=".repeat(78)}`);
console.log(`partijen met een eigen ordhdr_id (productieorder): ${prodpartijen.length}`);
const perType = {};
for (const h of ordhdr) { const t = h.ordertype || "(leeg)"; perType[t] = (perType[t] || 0) + 1; }
console.log("ordertypes van de orders waar deze partijen in terechtkomen:");
console.table(Object.entries(perType).sort((a, b) => b[1] - a[1]).map(([type, aantal]) => ({ ordertype: type, orders: aantal })));

const zonderVerd = part.filter((p) => !(verdPerPart.get(String(p.part_id)) || []).length);
console.log(`partijen zonder enige verdeelregel (nergens in de orderdata terug te vinden): ${zonderVerd.length} van ${part.length}`);

fs.writeFileSync("private_input/recon-vergelijking.json", JSON.stringify(rijen, null, 1), "utf8");
console.log(`\nDetail per levering weggeschreven naar private_input/recon-vergelijking.json`);
