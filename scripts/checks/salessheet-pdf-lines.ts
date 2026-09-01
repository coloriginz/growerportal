import { parseSalesSheetLots } from "../../src/lib/salessheet-pdf-lines";

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  if (condition) console.log(`PASS ${label}`);
  else {
    failures++;
    console.log(`FAIL ${label}${detail ? " — " + detail : ""}`);
  }
}

/*
 * Letterlijke tekst uit `099-22-371804.pdf`, zoals pdfjs hem uitrolt. Twee partijen
 * met verschillende vormen: de eerste heeft een correctieregel van EUR 0,00 en twee
 * verkopen, de tweede alleen een verkoop. Verzin hier niets bij — als een
 * verwachting niet uitkomt zit de fout in de parser.
 */
const ECHT =
  "Transaction details Stems Price S1 S3 S2 Amount " +
  "Lot 3582078 2 X 400 Dianthus Br Amazon Neon Purple 55 0,154 800 COLANTAL 23 " +
  "50 25-01-2025 Handling: less in box 0,000 0,00 " +
  "300 27-01-2025 Direct sales 0,185 55,50 " +
  "450 31-01-2025 Direct sales 0,150 67,50 123,00 800 0,154 " +
  "Lot 3582081 1 X 250 Solidago Golden Glory 70 20 0,147 250 COLANTAL 23 " +
  "250 27-01-2025 VBA 0,147 36,75 36,75 250 0,147 " +
  "Delivery total 33 11.250 € 1.831 Total stems sold 11.100 -150 Corrections";

const lots = parseSalesSheetLots(ECHT);

check("beide partijen gevonden", lots.length === 2, `kreeg ${lots.length}`);
check("partijnummers", lots[0]?.lotNumber === "3582078" && lots[1]?.lotNumber === "3582081");
check(
  "de kwekercode staat in de kopregel",
  lots[0]?.growerCode === "COLANTAL",
  "die code is wat een levering terugvindbaar maakt voor wie ernaar zoekt"
);
check("colli en stelen per collo", lots[0]?.colli === 2 && lots[0]?.stemsPerColli === 400);
check("aangevoerd aantal", lots[0]?.deliveredStems === 800, `kreeg ${lots[0]?.deliveredStems}`);
check("gemiddelde prijs", lots[0]?.averagePrice === 0.154);
check(
  "de omschrijving houdt de sorteringen erbij",
  lots[0]?.description === "Dianthus Br Amazon Neon Purple 55",
  "de sorteringen staan als losse getallen achter de naam en zijn er niet van te " +
    "scheiden zonder te gokken hoeveel het er zijn"
);

check("drie regels onder de eerste partij", lots[0]?.lines.length === 3, `kreeg ${lots[0]?.lines.length}`);
check(
  "de correctieregel wordt gelezen, ook al is het bedrag nul",
  lots[0]?.lines[0]?.channel === "Handling: less in box" &&
    lots[0]?.lines[0]?.stems === 50 &&
    lots[0]?.lines[0]?.amount === 0
);
check(
  "datum omgezet naar ISO",
  lots[0]?.lines[1]?.date === "2025-01-27",
  `kreeg ${lots[0]?.lines[1]?.date}`
);
check(
  "stelen, prijs en bedrag van een verkoopregel",
  lots[0]?.lines[1]?.stems === 300 &&
    lots[0]?.lines[1]?.price === 0.185 &&
    lots[0]?.lines[1]?.amount === 55.5
);
check(
  "de regels tellen op tot het aangevoerde aantal",
  lots[0]!.lines.reduce((s, l) => s + l.stems, 0) === 800
);
check(
  "de totaalregel van de partij wordt niet als verkoopregel gelezen",
  lots[0]!.lines.every((l) => l.channel !== ""),
  "achter de laatste regel staat '123,00 800 0,154' zonder datum; zonder de " +
    "datumeis zou dat een vierde regel opleveren"
);

check("tweede partij: één regel", lots[1]?.lines.length === 1);
check("tweede partij: kanaal VBA", lots[1]?.lines[0]?.channel === "VBA");

check(
  "de voettekst van de levering levert geen partij op",
  lots.every((l) => l.lotNumber !== "33" && l.lotNumber !== "11250"),
  "'Delivery total 33 11.250' lijkt op een kopregel maar begint niet met 'Lot'"
);

check("lege tekst levert niets op", parseSalesSheetLots("").length === 0);

/* Een levering waarvan de tabel over twee pagina's loopt: de kop van de eerste
 * partij staat op blad 2, de laatste partij op blad 3. Aaneengeplakt hoort dat
 * gewoon door te lopen. */
const OVER_TWEE_BLADEN =
  "Lot 3582084 4 X 200 Solidago Golden Glory 70 30 0,162 800 COLANTAL 23 " +
  "50 25-01-2025 Handling: less in box 0,000 0,00 " +
  "750 27-01-2025 VBA 0,173 129,75 129,75 800 0,162 " +
  "\n2 of 3 Page Serviceaccount t.b.v. reorganiseren e.d.\n" +
  "Lot 3582085 14 X 400 Dianthus Br Mix 45 0,140 5.600 COLANTAL 23 " +
  "-100 25-01-2025 Handling: more in box 0,000 0,00 " +
  "5.700 27-01-2025 Direct sales 0,137 783,60 783,60 5.600 0,140";
const twee = parseSalesSheetLots(OVER_TWEE_BLADEN);
check("een tabel over meerdere bladen levert beide partijen", twee.length === 2);
check(
  "een negatief aantal wordt gelezen",
  twee[1]?.lines[0]?.stems === -100,
  "'more in box' is een correctie de andere kant op en komt als negatief aantal binnen"
);
check("duizendtallen met een punt", twee[1]?.lines[1]?.stems === 5700 && twee[1]?.deliveredStems === 5600);

/* Letterlijke tekst uit `102115-396161.pdf`. Partij 3858159 draait verlies: haar
 * gemiddelde prijs is negatief en het bedrag staat tussen haakjes. Zonder dat
 * minteken in de kop schuift de parser door naar de prijs van 3858160 en versmelten
 * de twee partijen tot één. */
const NEGATIEVE_PRIJS =
  "Lot   3858159   1 X   1200   Aster Casarosa   60   15   -0,022 1.200 RUNDOG   12  " +
  "75 26-01-2026   Handling: less in box   0,000   0,00 " +
  "1.125 28-01-2026   Direct sales   0,000   (26,85)  (26,85) 1.200   -0,022 " +
  "Lot   3858160   4 X   600   Aster Casarosa   70   30   0,072 2.400 RUNDOG   12  " +
  "800 02-02-2026   FHN   0,078   62,35 800 02-02-2026   FHR   0,045   35,86 " +
  "800 02-02-2026   VBA   0,095   75,71  173,91 2.400   0,072";
const verlies = parseSalesSheetLots(NEGATIEVE_PRIJS);
check("een partij met een negatieve gemiddelde prijs blijft een eigen partij", verlies.length === 2, `kreeg ${verlies.length}`);
check(
  "die partij houdt haar eigen aangevoerde aantal",
  verlies[0]?.deliveredStems === 1200 && verlies[0]?.averagePrice === -0.022,
  `kreeg ${verlies[0]?.deliveredStems} / ${verlies[0]?.averagePrice}`
);
check("en haar eigen regels", verlies[0]?.lines.length === 2 && verlies[1]?.lines.length === 3);
check("een bedrag tussen haakjes is negatief", verlies[0]?.lines[1]?.amount === -26.85);

/* Een levering over meerdere bladen herhaalt de factuurkop boven aan elk blad. Die
 * kop draagt een datum en staat vol nummers; hij mag geen regel opleveren en mag
 * de eerste échte regel eronder niet opslokken. */
const MET_PAGINAKOP = `Lot 3894278 5 X 500 Rosa Athena 60 0,015 2.500 ZIMFLX 23 2.525 25-03-2026 Direct sales 0,021 53,21
20-03-2026  1-4-26 22:03 AWB number P.O.Box 170 Zimflex - CONS 07159587183 Supplier OZ Import BV The Netherlands 102258 400169 Harare Airport ZIMBABWE VAT# NL 0080.50.831.B01
1.000 26-03-2026 FHN 0,060 60,26`;
const kop = parseSalesSheetLots(MET_PAGINAKOP);
check("de paginakop levert zelf geen regel op", kop[0]?.lines.length === 2, `kreeg ${kop[0]?.lines.length}`);
check(
  "en slokt de regel eronder niet op",
  kop[0]?.lines[1]?.stems === 1000 && kop[0]?.lines[1]?.channel === "FHN",
  `kreeg ${kop[0]?.lines[1]?.stems} ${kop[0]?.lines[1]?.channel}`
);

console.log(failures === 0 ? "\nalle checks geslaagd" : `\n${failures} check(s) gefaald`);
process.exit(failures === 0 ? 0 : 1);
