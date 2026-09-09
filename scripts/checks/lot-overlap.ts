import { resolveLotOverlap } from "../../src/lib/salessheet-pdf-lines";

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) console.log(`PASS ${label}`);
  else { failures++; console.log(`FAIL ${label}${detail ? " — " + detail : ""}`); }
}

check("één gemeenschappelijke partij is genoeg",
  resolveLotOverlap(["3718393", "3718394"], ["3718393", "3718395"]) === "match");
check("alle partijen gemeenschappelijk telt ook als match",
  resolveLotOverlap(["3718393"], ["3718393"]) === "match");

// De twee gevallen die door de datumcontrole heen kwamen.
check("het document van een andere leverancier valt af",
  resolveLotOverlap(["3989341"], ["3989348", "3989345", "3989346"]) === "mismatch",
  "COLXROOD kreeg de afrekening van COLXBAK");
check("een referentie van één teken koppelt niet meer aan een vreemde levering",
  resolveLotOverlap(["3619975", "3619976"], ["3620158", "3620157"]) === "mismatch",
  "MPOIACOM kreeg de afrekening van COLXSHA");

// Onbekend is geen ongelijk.
check("geen partijtabel gelezen blijft onbeslist",
  resolveLotOverlap([], ["3659565"]) === "unknown",
  "anders maakt een layout die wij niet lezen een goede koppeling los");
check("een levering zonder partijen blijft onbeslist",
  resolveLotOverlap(["3659565"], []) === "unknown");
check("allebei leeg blijft onbeslist", resolveLotOverlap([], []) === "unknown");

if (failures > 0) { console.error(`\n${failures} controle(s) mislukt`); process.exit(1); }
console.log("\nAlle controles geslaagd");
