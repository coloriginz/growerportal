import { classificeerOvergeslagen } from "../../src/lib/sync/skipped";

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) console.log(`PASS ${label}`);
  else {
    failures++;
    console.log(`FAIL ${label}${detail ? " — " + detail : ""}`);
  }
}

const codes = (r: { relId: number }[]) => r.map((x) => x.relId).sort((a, b) => a - b);

const gemengd = classificeerOvergeslagen({
  "16699": { partijen: 172, productie: 0 },
  "8623": { partijen: 14, productie: 14 },
  "13397": { partijen: 53, productie: 2 },
});

check("een relatie zonder productie is een kweker", codes(gemengd.kwekers).includes(16699));
check("een relatie met alleen productie is een interne boeking",
  codes(gemengd.interneBoekingen).includes(8623));
check("een gemengde relatie telt als kweker", codes(gemengd.kwekers).includes(13397),
  "wie ook gewone partijen levert is een kweker, ongeacht de productieboekingen");
check("elke relatie komt in precies één groep",
  gemengd.kwekers.length + gemengd.interneBoekingen.length === 3);

const oud = classificeerOvergeslagen({ "16699": 172 });
check("de oude vorm telt als kweker", codes(oud.kwekers).includes(16699),
  "een getal betekent: productie onbekend, dus niet als intern wegzetten");

const leeg = classificeerOvergeslagen(null);
check("niets levert twee lege lijsten", leeg.kwekers.length === 0 && leeg.interneBoekingen.length === 0);

const rommel = classificeerOvergeslagen({ "abc": { partijen: 1, productie: 1 }, "16699": "veel" });
check("onzin wordt genegeerd zonder te gooien", codes(rommel.kwekers).length + codes(rommel.interneBoekingen).length <= 1);

const gesorteerd = classificeerOvergeslagen({
  "1": { partijen: 5, productie: 0 },
  "2": { partijen: 50, productie: 0 },
});
check("de drukste staat vooraan", gesorteerd.kwekers[0].relId === 2);

process.exit(failures ? 1 : 0);
