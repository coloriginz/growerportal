import {
  CONSIGNMENT_PURCHASE_TYPES,
  EMPTY_PURCHASE_TYPE_KEY,
  isConsignment,
  purchaseTypeKey,
} from "../../src/lib/sync/purchase-type";

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) console.log(`PASS ${label}`);
  else {
    failures++;
    console.log(`FAIL ${label}${detail ? " — " + detail : ""}`);
  }
}

check("CONS is consignatie", isConsignment("CONS"));
check("hoofdletters en spaties doen er niet toe", isConsignment(" cons "),
  "Fabric-tekstkolommen dragen regelmatig spaties mee");
check("FOB is koop", !isConsignment("FOB"));
check("CIF is koop", !isConsignment("CIF"));

check("leeg is geen consignatie", !isConsignment("") && !isConsignment("   "));
check("null en undefined zijn geen consignatie", !isConsignment(null) && !isConsignment(undefined),
  "geen code betekent: niet aantoonbaar consignatie, dus niet importeren");

check("een onbekende code is geen consignatie", !isConsignment("XYZ"),
  "de verzameling is een witte lijst; alles daarbuiten valt weg en wordt geteld");

check("lege codes vallen onder één telsleutel",
  purchaseTypeKey(null) === EMPTY_PURCHASE_TYPE_KEY &&
    purchaseTypeKey(" ") === EMPTY_PURCHASE_TYPE_KEY);
check("de telsleutel is genormaliseerd", purchaseTypeKey(" cif ") === "CIF",
  "anders staan CIF, cif en 'cif ' als drie codes in de telling");

check("elke code in de verzameling telt als consignatie",
  [...CONSIGNMENT_PURCHASE_TYPES].every((code) => isConsignment(code)),
  "de sleutel is genormaliseerd, dus de verzameling moet dat ook zijn");

process.exit(failures ? 1 : 0);
