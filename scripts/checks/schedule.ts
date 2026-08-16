import { isDue, windowFor } from "../../src/lib/sync/schedule";

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) console.log(`PASS ${label}`);
  else {
    failures++;
    console.log(`FAIL ${label}${detail ? " — " + detail : ""}`);
  }
}

const short = { name: "short", enabled: true, intervalMin: 60, atTime: null, windowDays: 45 };

check(
  "korte ronde: nooit gedraaid is due",
  isDue({ ...short, lastRunAt: null }, new Date("2026-08-15T10:00:00Z"))
);
check(
  "korte ronde: 59 minuten geleden is niet due",
  !isDue(
    { ...short, lastRunAt: new Date("2026-08-15T09:01:00Z") },
    new Date("2026-08-15T10:00:00Z")
  )
);
check(
  "korte ronde: 61 minuten geleden is due",
  isDue(
    { ...short, lastRunAt: new Date("2026-08-15T08:59:00Z") },
    new Date("2026-08-15T10:00:00Z")
  )
);
check("uitgezet is nooit due", !isDue({ ...short, enabled: false, lastRunAt: null }, new Date()));

const nightly = { name: "nightly", enabled: true, intervalMin: null, atTime: "03:00", windowDays: 45 };

// Zomertijd: 03:00 in Amsterdam is 01:00 UTC.
check(
  "nachtronde: net na 03:00 lokaal is due",
  isDue({ ...nightly, lastRunAt: new Date("2026-08-14T01:05:00Z") }, new Date("2026-08-15T01:05:00Z"))
);
check(
  "nachtronde: om 02:00 lokaal nog niet",
  !isDue({ ...nightly, lastRunAt: new Date("2026-08-14T01:05:00Z") }, new Date("2026-08-15T00:00:00Z"))
);
check(
  "nachtronde: vandaag al gedraaid is niet nogmaals due",
  !isDue({ ...nightly, lastRunAt: new Date("2026-08-15T01:05:00Z") }, new Date("2026-08-15T09:00:00Z"))
);

// Wintertijd: 03:00 in Amsterdam is 02:00 UTC.
check(
  "nachtronde: klopt ook in wintertijd",
  isDue({ ...nightly, lastRunAt: new Date("2026-01-14T02:05:00Z") }, new Date("2026-01-15T02:05:00Z"))
);

// Een onleesbare atTime mag niet stilzwijgend in "elke dag zo vroeg mogelijk"
// veranderen: dan draait de nachtronde midden in de handelsdag.
check(
  "nachtronde: onleesbare atTime is nooit due",
  !isDue(
    { ...nightly, atTime: "kwart over drie", lastRunAt: null },
    new Date("2026-08-15T09:00:00Z")
  )
);
check(
  "nachtronde: lege atTime is nooit due",
  !isDue({ ...nightly, atTime: "", lastRunAt: null }, new Date("2026-08-15T09:00:00Z"))
);

const w = windowFor(45, new Date("2026-08-15T10:00:00Z"));
check("venster eindigt in de toekomst", w.to > new Date("2026-08-15T10:00:00Z"));
check(
  "venster kijkt 45 dagen terug",
  w.from.toISOString().slice(0, 10) === "2026-07-01",
  w.from.toISOString()
);

process.exit(failures ? 1 : 0);
