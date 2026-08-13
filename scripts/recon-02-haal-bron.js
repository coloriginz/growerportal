/*
 * Stap 2: haal alle brondata uit KBT voor de salessheets uit de werklijst.
 * Eén keer breed ophalen naar JSON; alle analyse gebeurt daarna lokaal.
 */
const fs = require("fs");
const { execFileSync } = require("child_process");

const WERKLIJST = "private_input/recon-werklijst.json";
const SQL_UIT = "scripts/sql/recon-bron.sql";
const JSON_UIT = "private_input/recon-bron.json";

const w = JSON.parse(fs.readFileSync(WERKLIJST, "utf8"));
const ids = [...new Set(w.map((x) => x.parthdr_id).filter(Boolean))];
console.log(`${w.length} salessheets, ${ids.length} unieke parthdr_id's`);

const IN = ids.join(",");

const sql = `
-- Reconciliatie PCFUP + COLBFL — brondata uit KBT
-- ${ids.length} leveringen

-- 1. parthdr
SELECT parthdr_id, factnum, rel_id, levdatum, levdatumtijd, bdrf_id, zendhdr_id
FROM   kbtpro.parthdr WHERE parthdr_id IN (${IN});

-- 2. part
SELECT part_id, parthdr_id, rel_id, art_id, partnum, aantal, ape, s01, s02, s03,
       tijd, verdeeldst, ordhdr_id, verwerk_id, inkoop, klokprijs
FROM   kbtpro.part WHERE parthdr_id IN (${IN});

-- 3. verd
SELECT v.verd_id, v.part_id, v.ordreg_id, v.aantalst, v.inkwaarde, v.inhoud, v.aanmaakdatumtijd
FROM   kbtpro.verd v
WHERE  v.part_id IN (SELECT part_id FROM kbtpro.part WHERE parthdr_id IN (${IN}));

-- 4. ordreg
SELECT o.ordreg_id, o.ordhdr_id, o.art_id, o.aantal, o.ape, o.verk, o.afrekenprijs,
       o.inkwaarde, o.herkomst, o.ordregtype, o.bdrf_id
FROM   kbtpro.ordreg o
WHERE  o.ordreg_id IN (
         SELECT ordreg_id FROM kbtpro.verd
         WHERE part_id IN (SELECT part_id FROM kbtpro.part WHERE parthdr_id IN (${IN})));

-- 5. ordhdr
SELECT h.ordhdr_id, h.ordertype, h.vdatum, h.status, h.rel_id, h.referentie, h.afleverdatum
FROM   kbtpro.ordhdr h
WHERE  h.ordhdr_id IN (
         SELECT DISTINCT o.ordhdr_id FROM kbtpro.ordreg o
         WHERE o.ordreg_id IN (
           SELECT ordreg_id FROM kbtpro.verd
           WHERE part_id IN (SELECT part_id FROM kbtpro.part WHERE parthdr_id IN (${IN}))));

-- 6. partcor
SELECT c.partcor_id, c.part_id, c.reden_id, c.coraantalst, c.ape, c.cordatum, c.fust_id
FROM   kbtpro.partcor c
WHERE  c.part_id IN (SELECT part_id FROM kbtpro.part WHERE parthdr_id IN (${IN}));

-- 7. shkost
SELECT k.shkost_id, k.parthdr_id, k.kost_id, k.bedrag, k.type, k.grondslag_id, k.rel_id
FROM   kbtpro.shkost k WHERE k.parthdr_id IN (${IN});

-- 8. productieorders: partijen met een eigen ordhdr_id
SELECT p.part_id, p.parthdr_id, p.ordhdr_id, h.ordertype, h.vdatum, p.verwerk_id
FROM   kbtpro.part p
LEFT JOIN kbtpro.ordhdr h ON h.ordhdr_id = p.ordhdr_id
WHERE  p.parthdr_id IN (${IN}) AND p.ordhdr_id IS NOT NULL;

-- 9. lookups
SELECT kost_id, kode, oms FROM kbtpro.kost;
SELECT reden_id, kode, oms, redentype_id FROM kbtpro.reden;
SELECT art_id, kode, oms, agrp_id FROM kbtpro.art
WHERE art_id IN (SELECT DISTINCT art_id FROM kbtpro.part WHERE parthdr_id IN (${IN}));
`.trim();

fs.mkdirSync("scripts/sql", { recursive: true });
fs.writeFileSync(SQL_UIT, sql, "utf8");
console.log(`SQL weggeschreven naar ${SQL_UIT} (${(sql.length / 1024).toFixed(0)} KB)`);

console.log("Ophalen uit Fabric...");
execFileSync(process.execPath, ["scripts/fabric-query.js", "--file", SQL_UIT, "--out", JSON_UIT], {
  stdio: "inherit",
  env: { ...process.env, FABRIC_DB: "lh_landing" },
});
