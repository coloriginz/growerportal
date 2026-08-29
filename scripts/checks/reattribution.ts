import {
  planReattributionRemoval,
  REATTRIBUTION_REMOVAL_CAP,
} from "../../src/lib/sync/reattribution";

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) console.log(`PASS ${label}`);
  else {
    failures++;
    console.log(`FAIL ${label}${detail ? " — " + detail : ""}`);
  }
}

const sheet = (n: number) => ({
  id: `ss-${n}`,
  parthdrId: 2458982 + n,
  supplierCode: "COLXAFRI",
  relId: 29778,
});

check(
  "zonder herbestemmingen valt er niets te verwijderen",
  planReattributionRemoval({ sheets: [] }).mode === "report"
);

const een = planReattributionRemoval({ sheets: [sheet(0)] });
check(
  "één herbestemde levering wordt verwijderd",
  een.mode === "remove" && een.sheets.length === 1,
  "dit is het gemeten geval: INT000072 stond onder Africalla terwijl Fabric hem aan Ole Engai geeft"
);

check(
  "precies op de grens wordt nog verwijderd",
  planReattributionRemoval({
    sheets: Array.from({ length: REATTRIBUTION_REMOVAL_CAP }, (_, i) => sheet(i)),
  }).mode === "remove"
);

const teveel = planReattributionRemoval({
  sheets: Array.from({ length: REATTRIBUTION_REMOVAL_CAP + 1 }, (_, i) => sheet(i)),
});
check(
  "één boven de grens verwijdert niets",
  teveel.mode === "report",
  "een ronde die ineens tientallen leveringen herbestemt wijst op een fout in de ronde, " +
    "niet op een correctie in de bron — dan is niet verwijderen het veilige antwoord"
);
check(
  "en zegt waarom",
  teveel.mode === "report" && teveel.reason.includes(String(REATTRIBUTION_REMOVAL_CAP))
);

check(
  "een eigen grens wordt gerespecteerd",
  planReattributionRemoval({ sheets: [sheet(0), sheet(1)], cap: 1 }).mode === "report"
);

check(
  "de lijst wordt gekopieerd, niet doorgegeven",
  (() => {
    const invoer = [sheet(0)];
    const plan = planReattributionRemoval({ sheets: invoer });
    return plan.mode === "remove" && plan.sheets !== invoer;
  })(),
  "de aanroeper mag de invoer daarna nog aanpassen zonder het plan te veranderen"
);

console.log(failures === 0 ? "\nalle checks geslaagd" : `\n${failures} check(s) gefaald`);
process.exit(failures === 0 ? 0 : 1);
