import { interpolate } from "../../src/lib/interpolate";
import { getTranslation, languages, type Language } from "../../src/i18n";

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) console.log(`PASS ${label}`);
  else {
    failures++;
    console.log(`FAIL ${label}${detail ? " — " + detail : ""}`);
  }
}

const TALEN = Object.keys(languages) as Language[];

// ─── de invulling zelf ─────────────────────────────────────

check(
  "een plaatshouder wordt vervangen",
  interpolate("{from}-{to} van {total}", { from: "1", to: "50", total: "422" }) === "1-50 van 422"
);
check(
  "dezelfde plaatshouder mag meermaals voorkomen",
  interpolate("{n} van {n}", { n: "9" }) === "9 van 9"
);
check(
  "een waarde met accolades wordt niet opnieuw ingevuld",
  interpolate("{a}", { a: "{b}", b: "x" }) === "{b}",
  "anders zou een gebruikersnaam met accolades een andere plaatshouder kunnen kapen"
);

// ─── de vertalingen die de paginatievoet gebruikt ──────────

// Ontbreekt een sleutel, dan geeft getTranslation het pad terug en staat er
// "common.showingRange" op het scherm. Dat is precies de fout die niemand ziet
// tot een klant hem meldt, dus hij hoort hier gecontroleerd te worden.
for (const taal of TALEN) {
  for (const sleutel of ["common.pageOf", "common.showingRange", "common.previousPage",
                         "common.nextPage", "common.goToPage", "common.exportFailed"] as const) {
    check(
      `${taal}: ${sleutel} is vertaald`,
      getTranslation(taal, sleutel) !== sleutel
    );
  }
}

for (const taal of TALEN) {
  const bereik = interpolate(getTranslation(taal, "common.showingRange"), {
    from: "1",
    to: "50",
    total: "422",
  });
  check(
    `${taal}: de bereikregel houdt geen plaatshouder over`,
    !bereik.includes("{") && bereik.includes("422"),
    bereik
  );

  const pagina = interpolate(getTranslation(taal, "common.pageOf"), {
    page: "1",
    total: "9",
  });
  check(
    `${taal}: de paginakiezer houdt geen plaatshouder over`,
    !pagina.includes("{") && pagina.includes("9"),
    pagina
  );
}

if (failures > 0) {
  console.error(`\n${failures} controle(s) mislukt`);
  process.exit(1);
}
console.log("\nAlle controles geslaagd");
