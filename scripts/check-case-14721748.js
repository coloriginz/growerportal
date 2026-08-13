const fs = require("fs");
const [bron, , , , iot, fct] = JSON.parse(fs.readFileSync("private_input/5-cases.json", "utf8"));
const ORD = "14721748";

const f = fct.filter((r) => String(r.ordreg_id) === ORD);
const i = iot.filter((r) => String(r.ordreg_id) === ORD);
const b = bron.filter((r) => String(r.ordreg_id) === ORD);

console.log(`bron: ${b.length} regel, ${b[0].aantalst} stelen, part_id ${b[0].part_id}\n`);

const perBron = {};
f.forEach((r) => {
  const k = r.bronfeit_extra || "(leeg)";
  (perBron[k] ||= { regels: 0, som: 0, partijen: new Set(), redenen: new Set() });
  perBron[k].regels++;
  perBron[k].som += Number(r.vor_aantal || 0);
  perBron[k].partijen.add(String(r.part_id));
  if (r.reden_id != null) perBron[k].redenen.add(String(r.reden_id));
});

console.log("fct_orders opgesplitst naar bronfeit_extra:");
console.table(Object.entries(perBron).map(([k, v]) => ({
  bronfeit_extra: k,
  regels: v.regels,
  som_aantal: Number(v.som.toFixed(3)),
  partijen: v.partijen.size,
  redenen: [...v.redenen].join(", ") || "-",
})));

const totaal = f.reduce((s, r) => s + Number(r.vor_aantal || 0), 0);
console.log(`\ntotaal fct_orders : ${totaal.toFixed(3)}`);
console.log(`bron              : ${b[0].aantalst}`);
console.log(`verschil          : ${(Number(b[0].aantalst) - totaal).toFixed(3)}`);
console.log(`int_order_totaal  : ${i.reduce((s, r) => s + Number(r.vor_aantal || 0), 0).toFixed(3)} over ${i.length} regels`);

// waar zitten de correctieregels naartoe
console.log("\ncorrectieregels — welke partijen en verwerkingen:");
const corr = f.filter((r) => r.bronfeit_extra && r.bronfeit_extra !== "origineel");
const uniek = (k) => [...new Set(corr.map((r) => String(r[k])))];
["part_id", "parthdr_id", "verwerk_id_productie", "verwerk_id_verkoop", "reden_id", "verkooptype", "order_type"].forEach((k) => {
  const u = uniek(k);
  console.log(`  ${k.padEnd(22)}: ${u.length} uniek${u.length <= 6 ? "  -> " + u.join(", ") : ""}`);
});
