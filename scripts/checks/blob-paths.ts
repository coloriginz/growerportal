import { resolveBlobEnv, blobPath, isOwnBlob } from "../../src/lib/blob-paths";

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) console.log(`PASS ${label}`);
  else {
    failures++;
    console.log(`FAIL ${label}${detail ? " — " + detail : ""}`);
  }
}

// ─── welke map hoort bij welke omgeving ────────────────────

check("productie schrijft in prod/", resolveBlobEnv("production") === "prod");
check("test schrijft in test/", resolveBlobEnv("test") === "test");
check(
  "lokale ontwikkeling deelt de map met test",
  resolveBlobEnv("development") === "test",
  "ze delen ook de database, dus ze wijzen naar dezelfde Document-rijen"
);
check(
  "een onbekende waarde valt niet terug op test",
  resolveBlobEnv(undefined) === "unknown" && resolveBlobEnv("prod") === "unknown",
  "terugvallen op test zou productiebestanden in de testmap zetten en test ze " +
    "laten verwijderen — precies de fout die deze scheiding moet voorkomen"
);

// ─── het pad ───────────────────────────────────────────────

check(
  "het pad komt onder de omgevingsmap",
  blobPath("prod", "salessheets/123-x.pdf") === "prod/salessheets/123-x.pdf"
);
check(
  "een leidende slash levert geen dubbele op",
  blobPath("test", "/salessheets/x.pdf") === "test/salessheets/x.pdf"
);

// ─── wie mag verwijderen ───────────────────────────────────

const prodUrl = "https://tibdecxmel5sovbj.public.blob.vercel-storage.com/prod/salessheets/1-a.pdf";
const testUrl = "https://tibdecxmel5sovbj.public.blob.vercel-storage.com/test/salessheets/1-a.pdf";
const oudUrl = "https://tibdecxmel5sovbj.public.blob.vercel-storage.com/salessheets/1-a.pdf";

check("productie mag zijn eigen bestand weggooien", isOwnBlob("prod", prodUrl));
check(
  "test mag een productiebestand niet weggooien",
  !isOwnBlob("test", prodUrl),
  "dit is het geval dat we gemeten hebben: 38 vouchers stonden in beide databases"
);
check("productie mag een testbestand niet weggooien", !isOwnBlob("prod", testUrl));
check(
  "een bestand van vóór de scheiding is van niemand",
  !isOwnBlob("prod", oudUrl) && !isOwnBlob("test", oudUrl),
  "het kan door de andere omgeving in gebruik zijn; opruimen kan later met beide " +
    "databases ernaast, weggooien is niet terug te draaien"
);
check(
  "een omgeving zonder herkenbare naam blijft van de rest af",
  !isOwnBlob("unknown", prodUrl) && !isOwnBlob("unknown", testUrl)
);
check(
  "een pad dat alleen met de mapnaam begint telt niet mee",
  !isOwnBlob("test", "https://x.public.blob.vercel-storage.com/testing/salessheets/1.pdf"),
  "prefix-vergelijking zonder de slash zou 'testing/' voor 'test/' aanzien"
);
check("onleesbare URL is geen eigendom", !isOwnBlob("prod", "prod/salessheets/1.pdf"));

console.log(failures === 0 ? "\nAlle controles geslaagd" : `\n${failures} controle(s) gefaald`);
process.exit(failures === 0 ? 0 : 1);
