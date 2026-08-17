import { NextRequest } from "next/server";
import { requireImportAuth } from "../../src/lib/import-auth";

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) console.log(`PASS ${label}`);
  else {
    failures++;
    console.log(`FAIL ${label}${detail ? " — " + detail : ""}`);
  }
}

const HUIDIG = "grp_import_huidig_0123456789abcdef";
const VORIG = "grp_import_vorig_fedcba9876543210";

/** Bouwt een verzoek met de meegegeven Authorization-header, of zonder. */
function verzoek(header?: string): NextRequest {
  return new NextRequest("http://localhost/api/import/costs", {
    method: "POST",
    headers: header ? { authorization: header } : {},
  });
}

/** null betekent: toegang toegestaan. */
const toegestaan = (header?: string) => requireImportAuth(verzoek(header)) === null;
const status = (header?: string) => requireImportAuth(verzoek(header))?.status;

// --- alleen de huidige sleutel gezet ---
process.env.IMPORT_API_KEY = HUIDIG;
delete process.env.IMPORT_API_KEY_PREVIOUS;

check("huidige sleutel wordt geaccepteerd", toegestaan(`Bearer ${HUIDIG}`));
check("een verkeerde sleutel wordt geweigerd", !toegestaan("Bearer grp_import_fout"));
check("de vorige sleutel geldt niet als PREVIOUS leeg is", !toegestaan(`Bearer ${VORIG}`));
check("zonder header geen toegang", !toegestaan(undefined));
check("zonder header status 401", status(undefined) === 401);
check("lege bearer wordt geweigerd", !toegestaan("Bearer "));

// Zonder voorvoegsel wordt de sleutel ook geaccepteerd: het voorvoegsel wordt
// weggestreept en wat overblijft is de sleutel. Dat is toegeeflijk maar niet
// onveilig, en het staat hier zodat het een keuze is en geen verrassing.
check("sleutel zonder Bearer-voorvoegsel wordt ook geaccepteerd", toegestaan(HUIDIG));

// Hoofdletterongevoelig voorvoegsel, want Power Automate is daar niet consequent in.
check("bearer in kleine letters werkt", toegestaan(`bearer ${HUIDIG}`));

// --- tijdens een rotatie: beide gezet ---
process.env.IMPORT_API_KEY_PREVIOUS = VORIG;

check("tijdens rotatie werkt de nieuwe sleutel", toegestaan(`Bearer ${HUIDIG}`));
check("tijdens rotatie werkt de oude sleutel ook", toegestaan(`Bearer ${VORIG}`));
check("tijdens rotatie blijft een verkeerde sleutel geweigerd", !toegestaan("Bearer grp_import_fout"));

// --- na de rotatie: PREVIOUS weer weg ---
delete process.env.IMPORT_API_KEY_PREVIOUS;
check("na de rotatie is de oude sleutel ongeldig", !toegestaan(`Bearer ${VORIG}`));

// --- server zonder sleutel ---
delete process.env.IMPORT_API_KEY;
check("zonder IMPORT_API_KEY geeft de server 500", status(`Bearer ${HUIDIG}`) === 500);

process.exit(failures ? 1 : 0);
