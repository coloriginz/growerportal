import { costsQuery } from "../../src/lib/sync/queries/costs";

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`PASS ${label}`);
  } else {
    failures++;
    console.log(`FAIL ${label}${detail ? " — " + detail : ""}`);
  }
}

const window = { from: new Date("2026-07-01T00:00:00Z"), to: new Date("2026-08-01T00:00:00Z") };

const plain = costsQuery(window);
check("bevat de brontabel", plain.includes("marts.fct_salesheets_costs"));
check("venster begint inclusief", plain.includes("levering_datum >= '2026-07-01'"));
check("venster eindigt exclusief", plain.includes("levering_datum <  '2026-08-01'"));
check("geen leveranciersfilter zonder id", !plain.includes("rel_id_leverancier"));

const filtered = costsQuery({ ...window, supplierFabricId: 12345 });
check("filtert op leverancier", filtered.includes("rel_id_leverancier = 12345"));

// Een id dat geen getal is mag nooit als tekst in de query belanden.
const injected = costsQuery({
  ...window,
  supplierFabricId: "1 OR 1=1" as unknown as number,
});
check("weert niet-numerieke id", !injected.includes("OR 1=1"), injected);

process.exit(failures ? 1 : 0);
