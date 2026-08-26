/*
 * Query de Fabric SQL analytics endpoints vanaf de commandline.
 *
 * De verbinding en de authenticatie staan in scripts/lib/fabric-connection.js;
 * dit bestand is alleen de commandline eromheen. Bij de eerste run verschijnt
 * een device code die je in de browser invoert.
 *
 * Gebruik:
 *   node scripts/fabric-query.js "SELECT TOP 5 * FROM intermediate.int_order_totaal"
 *   node scripts/fabric-query.js --file query.sql --out resultaat.json
 */
const fs = require("fs");
const { queryFabric } = require("./lib/fabric-connection");

(async () => {
  const args = process.argv.slice(2);
  let sqlText = null;
  let out = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--file") sqlText = fs.readFileSync(args[++i], "utf8");
    else if (args[i] === "--out") out = args[++i];
    else if (!sqlText) sqlText = args[i];
  }
  if (!sqlText) { console.error("Geen query opgegeven."); process.exit(1); }

  const sets = await queryFabric(sqlText);
  if (out) {
    fs.writeFileSync(out, JSON.stringify(sets.length === 1 ? sets[0] : sets, null, 1), "utf8");
    console.error(`Weggeschreven naar ${out} (${sets.map((s) => s.length).join(" + ")} rijen)`);
  } else {
    sets.forEach((s, i) => {
      if (sets.length > 1) console.log(`--- resultaat ${i + 1} ---`);
      console.table(s.slice(0, 60));
      if (s.length > 60) console.log(`... (${s.length} rijen totaal)`);
    });
  }
})().catch((e) => { console.error("FOUT: " + e.message); process.exit(1); });
