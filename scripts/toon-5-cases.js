const fs = require("fs");
const sets = JSON.parse(fs.readFileSync("private_input/5-cases.json", "utf8"));
const [bron, samenvatting, productie, omvang, iot, fct] = sets;

const tab = (rows) => { console.table(rows); };

console.log("\n########## 1. BRON (kbtpro.verd) ##########");
tab(bron);

console.log("\n########## 2. SAMENVATTING PER CASE (int_order_totaal) ##########");
tab(samenvatting);

console.log("\n########## 3. PRODUCTIEORDER-TOETS ##########");
tab(productie);

console.log("\n########## 4. OMVANG ##########");
tab(omvang);

console.log("\n########## 5. VERGELIJKING PER CASE ##########");
const groepeer = (rows, key) => rows.reduce((m, r) => { (m[r[key]] ||= []).push(r); return m; }, {});
const gI = groepeer(iot, "ordreg_id");
const gF = groepeer(fct, "ordreg_id");
const gB = groepeer(bron, "ordreg_id");

const verschilKolommen = (rows) => {
  if (!rows.length) return [];
  return Object.keys(rows[0]).filter((k) => new Set(rows.map((r) => String(r[k]))).size > 1);
};

const vergelijk = Object.keys(gI).map((ord) => {
  const i = gI[ord], f = gF[ord] || [], b = gB[ord] || [];
  const somB = b.reduce((s, r) => s + Number(r.aantalst || 0), 0);
  const somI = i.reduce((s, r) => s + Number(r.vor_aantal || 0), 0);
  const somF = f.reduce((s, r) => s + Number(r.vor_aantal || 0), 0);
  const varI = verschilKolommen(i);
  return {
    ordreg_id: ord,
    bron_regels: b.length,
    bron_aantal: Number(somB.toFixed(3)),
    iot_regels: i.length,
    iot_som: Number(somI.toFixed(3)),
    fct_regels: f.length,
    fct_som: Number(somF.toFixed(3)),
    partijen: new Set(i.map((r) => r.part_id)).size,
    verd: new Set(i.map((r) => r.verd_id)).size,
    kol_varieert: varI.length,
    som_klopt: Math.abs(somB - somI) < 0.01 ? "ja" : "NEE",
  };
});
tab(vergelijk);

console.log("\n########## 6. WELKE KOLOMMEN VARIEREN PER CASE (int_order_totaal) ##########");
Object.keys(gI).forEach((ord) => {
  const v = verschilKolommen(gI[ord]);
  console.log(`  ${ord} (${gI[ord].length} regels, ${Object.keys(gI[ord][0]).length} kolommen): ${v.length} variëren`);
  console.log(`     ${v.join(", ")}`);
});

console.log("\n########## 7. WAAROM HEEFT fct_orders MEER REGELS? ##########");
Object.keys(gF).forEach((ord) => {
  const f = gF[ord];
  const perBron = f.reduce((m, r) => { const k = r.bronfeit_extra || "(leeg)"; m[k] = (m[k] || 0) + 1; return m; }, {});
  console.log(`  ${ord}: ${f.length} regels — ${Object.entries(perBron).map(([k, v]) => `${k}=${v}`).join(", ")}`);
});
