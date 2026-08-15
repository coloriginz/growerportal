import { costsQuery } from "../../src/lib/sync/queries/costs";
import { supplierClause } from "../../src/lib/sync/queries/helpers";

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`PASS ${label}`);
  } else {
    failures++;
    console.log(`FAIL ${label}${detail ? " — " + detail : ""}`);
  }
}

const sampleWindow = { from: new Date("2026-07-01T00:00:00Z"), to: new Date("2026-08-01T00:00:00Z") };

const plain = costsQuery(sampleWindow);
check("bevat de brontabel", plain.includes("marts.fct_salesheets_costs"));
check("venster begint inclusief", /levering_datum\s*>=\s*'2026-07-01'/.test(plain));
check("venster eindigt exclusief", /levering_datum\s*<\s*'2026-08-01'/.test(plain));
check(
  "geen leveranciersfilter zonder id",
  !/AND\s+rel_id_leverancier\s*=/.test(plain)
);

const filtered = costsQuery({ ...sampleWindow, supplierFabricId: 12345 });
check("filtert op leverancier", /AND\s+rel_id_leverancier\s*=\s*12345/.test(filtered));

// Eigenschap: voor elke invoer levert supplierClause óf een lege string, óf exact
// "AND <kolom> = <geheel getal>" op. Nooit iets daartussenin — dat zou betekenen dat
// willekeurige tekst tussen de kolom en de rest van de query terecht kan komen.
const CLAUSE_PATTERN = /^(|AND c = -?\d+)$/;
const hostileInputs: [string, unknown][] = [
  ["numerieke string", "12345"],
  ["sql-injectie via tekst", "1 OR 1=1"],
  ["exponentnotatie", 1e21],
  ["hex string", "0x1A"],
  ["Infinity", Infinity],
  ["-Infinity", -Infinity],
  ["NaN", NaN],
  ["null", null],
  ["undefined", undefined],
  ["float", 1.5],
  ["boven MAX_SAFE_INTEGER", Number.MAX_SAFE_INTEGER + 10],
  ["object met valueOf", { valueOf: () => "5 OR 1=1" }],
  ["array", ["1 OR 1=1"]],
  ["lege string", ""],
  ["string met newline", "1\nOR 1=1"],
];

for (const [label, input] of hostileInputs) {
  const result = supplierClause("c", input as unknown as number);
  check(`supplierClause weert of accepteert veilig: ${label}`, CLAUSE_PATTERN.test(result), result);
}

process.exit(failures ? 1 : 0);
