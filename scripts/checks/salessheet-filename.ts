import {
  parseSalesSheetFilename,
  parseSalesSheetFilenameSimple,
  parseSalesSheetFilenameLoose,
} from "../../src/lib/salessheet-filename-parser";

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) console.log(`PASS ${label}`);
  else {
    failures++;
    console.log(`FAIL ${label}${detail ? " — " + detail : ""}`);
  }
}

/** Leest een bestandsnaam zoals de importroute dat doet: rijk, dan simpel, dan ruim. */
function readName(name: string): { reference: string; ourInvoiceNumber: string } | null {
  const rijk = parseSalesSheetFilename(name);
  if (rijk) return { reference: rijk.reference, ourInvoiceNumber: rijk.ourInvoiceNumber };
  return parseSalesSheetFilenameSimple(name) ?? parseSalesSheetFilenameLoose(name);
}

// --- het rijke formaat blijft doen wat het deed -----------------------------

const rijk = parseSalesSheetFilename("COLCICE - 04_23_2026 00_15_00 - 212-28 - 401546.PDF");
check("het rijke formaat leest leverancier, referentie en nummer",
  rijk?.supplierCode === "COLCICE" && rijk?.reference === "212-28" && rijk?.ourInvoiceNumber === "401546");
check("het rijke formaat leest de leverdatum maandeerst",
  rijk?.deliveryDate === "2026-04-23",
  "07_30_2026 kan alleen maandeerst kloppen");
check("een referentie met een spatie overleeft het rijke formaat",
  parseSalesSheetFilename("COLXTOG2 - 06_24_2026 00_15_00 - 20169 240626 - 405912.PDF")?.reference ===
    "20169 240626");
check("een onmogelijke datum levert geen datum op",
  parseSalesSheetFilename("COLCICE - 02_30_2026 00_15_00 - 212-28 - 401546.PDF")?.deliveryDate === null,
  "liever geen datum dan een verzonnen datum");
check("minder dan vier delen is geen rijk formaat",
  parseSalesSheetFilename("C705 - Gribholm-389381.pdf") === null);

// --- het simpele formaat blijft doen wat het deed ---------------------------

const simpel = parseSalesSheetFilenameSimple("135-23-380914.pdf");
check("het simpele formaat splitst op het laatste streepje",
  simpel?.reference === "135-23" && simpel?.ourInvoiceNumber === "380914");
check("het simpele formaat weigert letters", parseSalesSheetFilenameSimple("C002 Blom-371364.pdf") === null,
  "dat is precies waarom de ruime variant bestaat");
check("het simpele formaat weigert een naam zonder streepje",
  parseSalesSheetFilenameSimple("390725.pdf") === null);
check("het simpele formaat laat een korte staart toe",
  parseSalesSheetFilenameSimple("13-27.pdf")?.ourInvoiceNumber === "27",
  "de ruime variant weigert die; daarom staat het simpele formaat ervoor");

// --- de ruime variant leest de namen die eerder wegvielen -------------------

for (const [naam, referentie, nummer] of [
  ["C002 Blom-371364.pdf", "C002 Blom", "371364"],
  ["CL00125-371114.pdf", "CL00125", "371114"],
  ["OZ250072-378954.pdf", "OZ250072", "378954"],
  ["16872 TLLU6894182-392035.pdf", "16872 TLLU6894182", "392035"],
  ["OZ260060-61-400738.pdf", "OZ260060-61", "400738"],
  ["C134 WG DE Sun-393210.pdf", "C134 WG DE Sun", "393210"],
] as const) {
  const uit = readName(naam);
  check(`${naam} wordt gelezen`,
    uit?.reference === referentie && uit?.ourInvoiceNumber === nummer,
    `kreeg ${JSON.stringify(uit)}`);
}

check("de volgorde blijft: het simpele formaat wint van het ruime",
  readName("135-23-380914.pdf")?.reference === "135-23",
  "beide lezen deze naam hetzelfde; de test bewaakt dat er niets tussen valt");

// --- wat de ruime variant moet blijven weigeren -----------------------------

check("een naam zonder cijferstaart wordt niet gelezen",
  parseSalesSheetFilenameLoose("duurzaamheidsrapportage_390725.pdf") === null,
  "geen streepje, dus geen referentie — anders komen 83 rapportages de matching in");
check("een naam zonder streepje wordt niet gelezen",
  parseSalesSheetFilenameLoose("390725.pdf") === null);
check("een staart van minder dan vier cijfers wordt niet gelezen",
  parseSalesSheetFilenameLoose("cape-12.pdf") === null,
  "onze eigen factuurnummers lopen ruim boven de 300000");
check("een staart met letters wordt niet gelezen",
  parseSalesSheetFilenameLoose("C002 Blom-371364a.pdf") === null);
check("een lege referentie wordt niet gelezen",
  parseSalesSheetFilenameLoose("-371364.pdf") === null,
  "het streepje staat vooraan, dus er blijft niets over om op te zoeken");
check("spaties rond de delen worden weggepoetst",
  parseSalesSheetFilenameLoose("C002 Blom - 371364.pdf")?.ourInvoiceNumber === "371364",
  "anders zoekt de database op ' 371364'");

process.exit(failures ? 1 : 0);
