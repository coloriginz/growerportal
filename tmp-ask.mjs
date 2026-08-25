import fs from "node:fs";
const url = /^PA_WEBHOOK_ASK_URL="?([^"\n\r]+)"?/m.exec(fs.readFileSync(".env","utf8"))[1];
const ask = async (label, q) => {
  const res = await fetch(url, { method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ env:"test", query:q }), signal: AbortSignal.timeout(90000) });
  const t = await res.text();
  console.log(`\n== ${label} (${res.status})`);
  if (res.status === 200) console.table(JSON.parse(t)); else console.log(t.slice(0,150));
};
await ask("is_inclusief x is_doorboek, juli-aug",
 `SELECT c.is_inclusief, l.is_doorboek, COUNT(DISTINCT c.parthdr_id) AS leveringen,
         COUNT(*) AS regels, SUM(c.salesheet_amount) AS bedrag
  FROM marts.fct_salesheets_costs c JOIN marts.dim_levering l ON l.parthdr_id = c.parthdr_id
  WHERE c._datum_key_levering >= '2026-07-01' AND c._datum_key_levering < '2026-08-25'
  GROUP BY c.is_inclusief, l.is_doorboek`);
await ask("wie zijn die inclusief-leveringen (leverancier)",
 `SELECT p.rel_id_leverancier, COUNT(DISTINCT c.parthdr_id) AS leveringen, SUM(c.salesheet_amount) AS bedrag
  FROM marts.fct_salesheets_costs c
  JOIN marts.fct_partijen p ON p.parthdr_id = c.parthdr_id
  WHERE c._datum_key_levering >= '2026-07-01' AND c._datum_key_levering < '2026-08-25' AND c.is_inclusief = 1
  GROUP BY p.rel_id_leverancier ORDER BY COUNT(DISTINCT c.parthdr_id) DESC`);
