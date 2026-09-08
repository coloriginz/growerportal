import { parseFabricDate } from "../../src/lib/sync/fabric-date";

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) console.log(`PASS ${label}`);
  else { failures++; console.log(`FAIL ${label}${detail ? " — " + detail : ""}`); }
}
const iso = (s: string) => parseFabricDate(s).toISOString();

// De vorm die Fabric levert: datum en tijd zonder tijdzone. Dit is het hele punt
// van deze functie — `new Date()` leest hem als lokale tijd en schuift daarmee
// buiten UTC elke levering een dag terug.
check("datum met tijd zonder zone telt als UTC", iso("2025-07-14T00:00:00") === "2025-07-14T00:00:00.000Z");
check("ook met een tijd erin", iso("2026-08-17T11:15:00") === "2026-08-17T11:15:00.000Z");
check("ook met een spatie in plaats van T", iso("2025-06-25 08:48:00") === "2025-06-25T08:48:00.000Z");

// Een reeds gezonede waarde blijft wat hij is.
check("Z blijft Z", iso("2025-07-14T00:00:00Z") === "2025-07-14T00:00:00.000Z");
check("een offset wordt gerespecteerd", iso("2025-07-14T02:00:00+02:00") === "2025-07-14T00:00:00.000Z");
check("een offset zonder dubbele punt ook", iso("2025-07-14T02:00:00+0200") === "2025-07-14T00:00:00.000Z");

// Een kale datum leest JavaScript al als UTC; er "Z" achter plakken zou hem
// juist ongeldig maken.
check("een datum zonder tijd blijft geldig", iso("2025-07-14") === "2025-07-14T00:00:00.000Z");

check("spaties eromheen storen niet", iso("  2025-07-14T00:00:00  ") === "2025-07-14T00:00:00.000Z");
check("onleesbare invoer geeft een ongeldige datum", isNaN(parseFabricDate("geen datum").getTime()));

if (failures > 0) { console.error(`\n${failures} controle(s) mislukt`); process.exit(1); }
console.log("\nAlle controles geslaagd");
