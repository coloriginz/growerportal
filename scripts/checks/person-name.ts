import { composeName, splitPersonName } from "../../src/lib/person-name";

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) console.log(`PASS ${label}`);
  else { failures++; console.log(`FAIL ${label}${detail ? " — " + detail : ""}`); }
}
const split = (s: string) => {
  const p = splitPersonName(s);
  return [p.firstName, p.middleName, p.lastName].join("|");
};

// Samenstellen: lege delen laten geen dubbele spatie achter.
check("naam zonder tussenvoegsel", composeName({ firstName: "Jan", lastName: "Jansen" }) === "Jan Jansen");
check("naam met tussenvoegsel", composeName({ firstName: "Jan", middleName: "van", lastName: "Jansen" }) === "Jan van Jansen");
check("leeg tussenvoegsel geeft geen dubbele spatie", composeName({ firstName: "Jan", middleName: "", lastName: "Jansen" }) === "Jan Jansen");
check("null telt als leeg", composeName({ firstName: "Jan", middleName: null, lastName: null }) === "Jan");
check("spaties eromheen verdwijnen", composeName({ firstName: " Jan ", lastName: " Jansen " }) === "Jan Jansen");
check("niets in, niets uit", composeName({}) === "");

// Splitsen van bestaande namen.
check("twee woorden", split("Jan Jansen") === "Jan||Jansen");
check("enkel tussenvoegsel", split("Jan de Vries") === "Jan|de|Vries");
check("tussenvoegsel van twee woorden", split("Jan van der Berg") === "Jan|van der|Berg");
check("langste tussenvoegsel wint van het kortste", split("Henk van den Heuvel") === "Henk|van den|Heuvel");
check("hoofdletter in het tussenvoegsel", split("Jan Van Der Berg") === "Jan|Van Der|Berg");
check("dubbele achternaam blijft heel", split("Maria de la Cruz Gomez") === "Maria|de la|Cruz Gomez");
check("achternaam van meerdere woorden zonder tussenvoegsel", split("Flora United Protea Farms") === "Flora||United Protea Farms");

// Randgevallen waar de heuristiek zichtbaar niets verzint.
check("een woord blijft een voornaam", split("Admin") === "Admin||");
check("lege naam levert lege delen", split("") === "||");
check("dubbele spaties tellen als een", split("Jan  van   Dijk") === "Jan|van|Dijk");
// "Jan de" is iemand die "de" heet, geen tussenvoegsel zonder achternaam.
check("tussenvoegsel zonder achternaam is een achternaam", split("Jan de") === "Jan||de");

// Heen en terug: splitsen en weer samenstellen levert de oorspronkelijke naam.
for (const name of ["Jan Jansen", "Jan van der Berg", "Maria de la Cruz Gomez", "Admin", "Henk Pieter den Boer"]) {
  check(`heen en terug: ${name}`, composeName(splitPersonName(name)) === name);
}

if (failures > 0) { console.error(`\n${failures} controle(s) mislukt`); process.exit(1); }
console.log("\nAlle controles geslaagd");
