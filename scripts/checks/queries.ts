import { costsQuery } from "../../src/lib/sync/queries/costs";
import { growersQuery } from "../../src/lib/sync/queries/growers";
import { lotsQuery } from "../../src/lib/sync/queries/lots";
import { ordersQuery } from "../../src/lib/sync/queries/orders";
import { suppliersQuery } from "../../src/lib/sync/queries/suppliers";
import {
  growerViaPartijenClause,
  supplierClause,
  supplierViaPartijenClause,
} from "../../src/lib/sync/queries/helpers";

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

// --- costs ---

const plain = costsQuery(sampleWindow);
check("costs: bevat de brontabel", plain.includes("marts.fct_salesheets_costs"));
// De kostennamen staan sinds 21-08-2026 in dim_kost; zonder deze join komen
// description en costTypeCode leeg binnen en dan valt de fout pas op in de UI.
check("costs: haalt de namen uit dim_kost", /LEFT JOIN marts\.dim_kost/.test(plain));
check("costs: gebruikt de nieuwe datumkolom", /c\._datum_key_levering\s*>=\s*'2026-07-01'/.test(plain));
check("costs: venster eindigt exclusief", /c\._datum_key_levering\s*<\s*'2026-08-01'/.test(plain));
check("costs: de oude kolomnaam is weg", !/[^_]levering_datum/.test(plain));
check(
  "costs: geen leveranciersfilter zonder id",
  !/AND\s+parthdr_id\s+IN\s*\(SELECT\s+parthdr_id\s+FROM\s+marts\.fct_partijen/.test(plain)
);

const filtered = costsQuery({ ...sampleWindow, supplierFabricId: 12345 });
check(
  "costs: filtert op leverancier via de partijen-subquery, niet de platte vorm",
  /AND\s+parthdr_id\s+IN\s*\(SELECT\s+parthdr_id\s+FROM\s+marts\.fct_partijen\s+WHERE\s+rel_id_leverancier\s*=\s*12345\)/.test(
    filtered
  )
);

// --- suppliers ---

const suppliersPlain = suppliersQuery(sampleWindow);
check("suppliers: bevat de brontabel", suppliersPlain.includes("marts.dim_leverancier"));
check(
  "suppliers: venster komt niet voor (stamdata)",
  !/2026-07-01/.test(suppliersPlain) && !/2026-08-01/.test(suppliersPlain)
);
check(
  "suppliers: gebruikt leverancier_verantwoordelijke, niet contact_inkoper",
  /leverancier_verantwoordelijke\b/.test(suppliersPlain) &&
    !/leverancier_contact_inkoper/.test(suppliersPlain)
);
check(
  "suppliers: geen leveranciersfilter zonder id",
  !/AND\s+rel_id_leverancier\s*=/.test(suppliersPlain)
);

const suppliersFiltered = suppliersQuery({ ...sampleWindow, supplierFabricId: 12345 });
check(
  "suppliers: filtert op leverancier met id",
  /AND\s+rel_id_leverancier\s*=\s*12345/.test(suppliersFiltered)
);

// --- growers ---

const growersPlain = growersQuery(sampleWindow);
check("growers: bevat de brontabel", growersPlain.includes("marts.dim_kweker"));
check(
  "growers: venster komt niet voor (stamdata)",
  !/2026-07-01/.test(growersPlain) && !/2026-08-01/.test(growersPlain)
);
check(
  "growers: geen leveranciersfilter zonder id",
  !/AND\s+rel_id_kweker\s+IN\s*\(SELECT\s+rel_id_kweker\s+FROM\s+marts\.fct_partijen/.test(growersPlain)
);

const growersFiltered = growersQuery({ ...sampleWindow, supplierFabricId: 12345 });
check(
  "growers: filtert op leverancier via de partijen-subquery op rel_id_kweker",
  /AND\s+rel_id_kweker\s+IN\s*\(SELECT\s+rel_id_kweker\s+FROM\s+marts\.fct_partijen\s+WHERE\s+rel_id_leverancier\s*=\s*12345\)/.test(
    growersFiltered
  )
);

// --- lots ---

const lotsPlain = lotsQuery(sampleWindow);
check("lots: bevat de brontabel", lotsPlain.includes("marts.fct_partijen"));
check("lots: joint dim_artikel", /LEFT JOIN\s+marts\.dim_artikel/.test(lotsPlain));
check("lots: venster begint inclusief op p.leverdatum", /p\.leverdatum\s*>=\s*'2026-07-01'/.test(lotsPlain));
check("lots: venster eindigt exclusief op p.leverdatum", /p\.leverdatum\s*<\s*'2026-08-01'/.test(lotsPlain));
check(
  "lots: geen leveranciersfilter zonder id",
  !/AND\s+p\.rel_id_leverancier\s*=/.test(lotsPlain)
);

const lotsFiltered = lotsQuery({ ...sampleWindow, supplierFabricId: 12345 });
check(
  "lots: filtert op leverancier met p.-prefix",
  /AND\s+p\.rel_id_leverancier\s*=\s*12345/.test(lotsFiltered)
);

// --- orders ---

const ordersPlain = ordersQuery(sampleWindow);
check("orders: bevat de brontabel", ordersPlain.includes("marts.fct_orders"));
check(
  "orders: weert regels zonder partij",
  /part_id IS NOT NULL/.test(ordersPlain) &&
    /parthdr_id IS NOT NULL/.test(ordersPlain) &&
    /rel_id_kweker IS NOT NULL/.test(ordersPlain) &&
    /rel_id_leverancier IS NOT NULL/.test(ordersPlain)
);
check(
  "orders: venster begint inclusief op _datum_key_vertrek",
  /_datum_key_vertrek\s*>=\s*'2026-07-01'/.test(ordersPlain)
);
check(
  "orders: venster eindigt exclusief op _datum_key_vertrek",
  /_datum_key_vertrek\s*<\s*'2026-08-01'/.test(ordersPlain)
);
check("orders: geen leveranciersfilter zonder id", !/AND\s+rel_id_leverancier\s*=/.test(ordersPlain));
check("orders: gebruikt vor_omzet niet", !/vor_omzet/.test(ordersPlain));
check(
  "orders: berekent Afrekenomzet met afrekenprijs_per_steel",
  /vor_aantal\s*\*\s*afrekenprijs_per_steel/.test(ordersPlain)
);

const ordersFiltered = ordersQuery({ ...sampleWindow, supplierFabricId: 12345 });
check(
  "orders: filtert op leverancier met id",
  /AND\s+rel_id_leverancier\s*=\s*12345/.test(ordersFiltered)
);

// Eigenschap: voor elke invoer levert supplierClause óf een lege string, óf exact
// "AND <kolom> = <geheel getal>" op. Nooit iets daartussenin — dat zou betekenen dat
// willekeurige tekst tussen de kolom en de rest van de query terecht kan komen.
const CLAUSE_PATTERN = /^(|AND c = -?\d+)$/;

// Eigenschap voor de partijen-subquery-vorm: óf leeg, óf exact de volledige
// subquery met een geheel getal erin. Niets ertussenin.
const VIA_PARTIJEN_PATTERN =
  /^(|AND parthdr_id IN \(SELECT parthdr_id FROM marts\.fct_partijen WHERE rel_id_leverancier = -?\d+\))$/;

// Eigenschap voor de kweker-partijen-subquery-vorm: óf leeg, óf exact de
// volledige subquery via rel_id_kweker met een geheel getal erin.
const GROWER_VIA_PARTIJEN_PATTERN =
  /^(|AND rel_id_kweker IN \(SELECT rel_id_kweker FROM marts\.fct_partijen WHERE rel_id_leverancier = -?\d+\))$/;

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

for (const [label, input] of hostileInputs) {
  const result = supplierViaPartijenClause(input as unknown as number);
  check(
    `supplierViaPartijenClause weert of accepteert veilig: ${label}`,
    VIA_PARTIJEN_PATTERN.test(result),
    result
  );
}

for (const [label, input] of hostileInputs) {
  const result = growerViaPartijenClause(input as unknown as number);
  check(
    `growerViaPartijenClause weert of accepteert veilig: ${label}`,
    GROWER_VIA_PARTIJEN_PATTERN.test(result),
    result
  );
}

process.exit(failures ? 1 : 0);
