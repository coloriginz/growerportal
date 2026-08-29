import {
  SHIPMENT_STATUSES,
  resolveShipmentStatus,
} from "../../src/lib/shipment-status";

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) console.log(`PASS ${label}`);
  else {
    failures++;
    console.log(`FAIL ${label}${detail ? " — " + detail : ""}`);
  }
}

check(
  "nog niet alles verkocht is Selling",
  resolveShipmentStatus({ deliveredStems: 10000, soldStems: 3750, costCount: 0 }) === "selling"
);
check(
  "niets verkocht is Selling",
  resolveShipmentStatus({ deliveredStems: 1500, soldStems: 0, costCount: 0 }) === "selling"
);
check(
  "alles verkocht zonder afrekening is Finalizing",
  resolveShipmentStatus({ deliveredStems: 8214, soldStems: 8214, costCount: 0 }) === "finalizing"
);
check(
  "alles verkocht mét afrekening is Completed",
  resolveShipmentStatus({ deliveredStems: 8214, soldStems: 8214, costCount: 15 }) === "completed"
);

check(
  "de afrekening wint van een stelenverschil",
  resolveShipmentStatus({ deliveredStems: 7260, soldStems: 6180, costCount: 5 }) === "completed",
  "139 oude leveringen zijn afgerekend terwijl de warehouse-restatement de aantallen nog niet had bijgewerkt; " +
    "zonder deze voorrang blijven die voor altijd op Selling staan"
);

check(
  "een levering zonder aangevoerde stelen is Selling, niet Finalizing",
  resolveShipmentStatus({ deliveredStems: 0, soldStems: 0, costCount: 0 }) === "selling",
  "0 >= 0 is waar; zonder ondergrens zou een levering waarvan de partijen nog niet binnen zijn als afgerond gelden"
);
check(
  "een levering zonder aangevoerde stelen mét afrekening is Completed",
  resolveShipmentStatus({ deliveredStems: 0, soldStems: 0, costCount: 3 }) === "completed"
);

check(
  "meer verkocht dan aangevoerd is Finalizing",
  resolveShipmentStatus({ deliveredStems: 100, soldStems: 120, costCount: 0 }) === "finalizing",
  "komt in de meting niet voor, maar mag nooit terugvallen op Selling"
);

check(
  "negatieve of ontbrekende aantallen leiden niet tot Finalizing",
  resolveShipmentStatus({ deliveredStems: -5, soldStems: 0, costCount: 0 }) === "selling"
);

check(
  "elke uitkomst staat in SHIPMENT_STATUSES",
  ([
    resolveShipmentStatus({ deliveredStems: 10, soldStems: 0, costCount: 0 }),
    resolveShipmentStatus({ deliveredStems: 10, soldStems: 10, costCount: 0 }),
    resolveShipmentStatus({ deliveredStems: 10, soldStems: 10, costCount: 1 }),
  ] as const).every((s) => (SHIPMENT_STATUSES as readonly string[]).includes(s)),
  "de filterlijst in het scherm wordt uit deze verzameling opgebouwd"
);

process.exit(failures ? 1 : 0);
