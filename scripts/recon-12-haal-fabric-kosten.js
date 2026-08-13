/*
 * Stap 12: haal de BEREKENDE kosten uit de transformlaag van Fabric.
 *
 * marts.fct_salesheets_costs bevat per shkost_id het uitgerekende bedrag
 * (salesheet_amount) — dus niet de rauwe shkost.bedrag die voor percentageregels
 * nog met een grondslag vermenigvuldigd moet worden.
 */
const fs = require("fs");
const { execFileSync } = require("child_process");

const schoon = JSON.parse(fs.readFileSync("private_input/recon-schoon.json", "utf8"));
const ids = [...new Set(schoon.map((s) => s.parthdr))];
console.log(`${ids.length} salessheets`);

const sql = `
SELECT parthdr_id, shkost_id, kost_id, kost_naam, kost_type_code, kost_type_naam,
       salesheet_amount, salesheet_type, salesheet_referentienummer, levering_datum,
       totaal_omzet, totaal_verkoop_aantal, is_doorboek
FROM   marts.fct_salesheets_costs
WHERE  parthdr_id IN (${ids.join(",")});
`.trim();

fs.writeFileSync("scripts/sql/recon-fabric-kosten.sql", sql, "utf8");
execFileSync(process.execPath, ["scripts/fabric-query.js", "--file", "scripts/sql/recon-fabric-kosten.sql", "--out", "private_input/recon-fabric-kosten.json"], {
  stdio: "inherit",
  env: { ...process.env, FABRIC_DB: "wh_transform" },
});
