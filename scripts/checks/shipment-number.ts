import { resolveShipmentNumber, PLAATSHOUDERS } from "../../src/lib/sync/shipment-number";

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) console.log(`PASS ${label}`);
  else { failures++; console.log(`FAIL ${label}${detail ? " — " + detail : ""}`); }
}
const vrij = () => false;
const bezet = () => true;

// ─── nieuwe levering ───────────────────────────────────────

{
  const b = resolveShipmentNumber({ bron: "10582", opgeslagen: null, parthdrId: 2472390, bezet: vrij });
  check("een nieuwe levering krijgt het bronnummer", b.nummer === "10582" && b.reden === "nieuw");
}
{
  const b = resolveShipmentNumber({ bron: "  10582  ", opgeslagen: null, parthdrId: 1, bezet: vrij });
  check("spaties eromheen gaan eraf", b.nummer === "10582");
}
for (const p of PLAATSHOUDERS) {
  const b = resolveShipmentNumber({ bron: p, opgeslagen: null, parthdrId: 77, bezet: vrij });
  check(`plaatshouder ${JSON.stringify(p)} wordt FABRIC-77`, b.nummer === "FABRIC-77");
}
{
  const b = resolveShipmentNumber({ bron: "VOLGT", opgeslagen: null, parthdrId: 77, bezet: vrij });
  check("een plaatshouder in hoofdletters telt ook", b.nummer === "FABRIC-77");
}
{
  const b = resolveShipmentNumber({ bron: "10582", opgeslagen: null, parthdrId: 5, bezet: bezet });
  check("een bezet nummer krijgt het parthdr_id erachter",
    b.nummer === "10582-5" && b.reden === "botsing-achtervoegsel");
}

// ─── bestaande levering ────────────────────────────────────

/*
 * De aanleiding: levering 2472390 kwam binnen als "21120 10582" en de bron
 * schoonde dat op naar "10582". De update-tak schreef het nummer niet, dus
 * productie draagt het oude nummer nog terwijl de rij die dag nog is
 * bijgewerkt — en de sales sheet met referentie "10582" koppelt daar nooit aan.
 */
{
  const b = resolveShipmentNumber({
    bron: "10582", opgeslagen: "21120 10582", parthdrId: 2472390, bezet: vrij,
  });
  check("een opgeschoond bronnummer wordt overgenomen",
    b.nummer === "10582" && b.reden === "bijgewerkt");
}
{
  const b = resolveShipmentNumber({ bron: "10582", opgeslagen: "10582", parthdrId: 1, bezet: vrij });
  check("gelijk blijft gelijk, geen schrijfactie", b.nummer === null && b.reden === "ongewijzigd");
}
{
  // Staat het al in de ontdubbelde vorm, dan is dat de juiste vorm en niet een verschil.
  const b = resolveShipmentNumber({ bron: "C065 Blomkloof", opgeslagen: "C065 Blomkloof-2472589", parthdrId: 2472589, bezet: bezet });
  check("de ontdubbelde vorm telt als ongewijzigd", b.nummer === null && b.reden === "ongewijzigd");
}
{
  const b = resolveShipmentNumber({ bron: "10582", opgeslagen: "21120 10582", parthdrId: 9, bezet: bezet });
  check("botst het nieuwe nummer, dan met achtervoegsel bijwerken", b.nummer === "10582-9");
}
{
  // Het geval dat data kost als je het verkeerd doet.
  const b = resolveShipmentNumber({ bron: "", opgeslagen: "10582", parthdrId: 1, bezet: vrij });
  check("een lege bron wist een goed nummer niet", b.nummer === null && b.reden === "bron-leeg");
}
{
  const b = resolveShipmentNumber({ bron: "volgt", opgeslagen: "10582", parthdrId: 1, bezet: vrij });
  check("een plaatshouder wist een goed nummer evenmin", b.nummer === null && b.reden === "bron-leeg");
}
{
  const b = resolveShipmentNumber({ bron: "10582", opgeslagen: "FABRIC-1", parthdrId: 1, bezet: vrij });
  check("een echt nummer vervangt de FABRIC-plaatshouder",
    b.nummer === "10582" && b.reden === "bijgewerkt");
}

if (failures > 0) { console.error(`\n${failures} controle(s) mislukt`); process.exit(1); }
console.log("\nAlle controles geslaagd");
