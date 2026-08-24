# Verslag: salessheet-pdf's uit het lokale archief gekoppeld

> **Wanneer:** 20 en 21 augustus 2026, op de **testomgeving**.
> **Waarom dit verslag:** er zijn 1.369 documenten aan afrekeningen gehangen zonder dat iemand
> meekeek. Dit legt vast wat er gebeurd is, waar het bewijs staat, en hoe je het overdoet.
> **Het hulpmiddel zelf:** [salessheet-pdfs-koppelen.md](salessheet-pdfs-koppelen.md).

---

## Uitkomst

| | voor | na |
|---|---|---|
| afrekeningen met pdf | 2.498 | **3.867** |
| afrekeningen zonder pdf | 5.290 | 3.921 |
| documenten | 2.499 | 3.868 |

**1.369 nieuwe koppelingen. Nul bestaande koppelingen aangeraakt** — van de 2.498 die er stonden is er
geen enkele vervangen of verdwenen, geverifieerd tegen een momentopname die vóór de run is gemaakt
(`private_input/koppelingen-voor.json`).

Dat laatste was de grootste zorg vooraf. 206 bestanden hadden náást een vrije afrekening ook een
kandidaat die al een pdf droeg, en de route vervángt in dat geval. De datumcontrole heeft elke keer de
vrije kandidaat gekozen.

---

## Wat er is aangepast om dit mogelijk te maken

**De bestandsnaam-parser is verruimd** (`src/lib/salessheet-filename-parser.ts`). De portal kende twee
vormen: het rijke formaat uit de mail (`COLXIMA - 07_10_2026 09_30_00 - INT000086 - 406810.PDF`) en een
simpel formaat dat alléén cijfers en streepjes accepteerde. Het archief gebruikt een derde vorm —
`C002 Blom-371364.pdf`, `CL00125-371114.pdf` — met letters en spaties in de referentie, en die werden
categorisch geweigerd. De nieuwe regel: alles ná het laatste streepje is ons factuurnummer als het uit
minstens vier cijfers bestaat, alles ervóór is de referentie.

Daarmee werd 4.464 van de 4.630 bestanden leesbaar, tegen 2.727 daarvoor.

**Waarom dat veilig is.** De bestandsnaam is een aanwijzing, geen beslissing. Koppelen vereist een
treffer op `SalesSheet.invoiceNumber` én een exacte match op de leverdatum die in de pdf zelf staat.
Een te ruime naamregel levert dus hoogstens een bestand op dat nergens op past en als `no_match` in het
rapport belandt.

**`maxDuration = 300` op `/api/shipments/import-email`.** Die stond er niet, en pdf-parsen plus
blob-upload per bestand liep tegen de standaardlimiet.

---

## De weigeringen: 465, allemaal dezelfde reden

Alle geweigerde bestanden kregen `ambiguous_no_date`: de leverdatum was niet uit de pdf te lezen én er
waren meerdere afrekeningen met dezelfde referentie. De route weigert dan te kiezen.

Het gaat vrijwel uitsluitend om lage, hergebruikte referenties — `2`, `13`, `15`, `21`. Afrekeningnummers
recyclen per jaar terwijl `SalesSheet.invoiceNumber` uniek is, dus zo'n nummer wijst naar meerdere
afrekeningen en alleen de datum kan ze uit elkaar houden. Staat die niet leesbaar in de pdf, dan is er
geen manier om het goed te doen.

**Dit is de beveiliging die werkt, geen fout.** Deze bestanden liever niet gekoppeld dan bij de verkeerde
leverancier.

---

## Wat er niet gekoppeld is, en waarom

Van de 4.630 bestanden in `private_input/salessheets`:

| | aantal | wat het is |
|---|---|---|
| al gekoppeld vóór deze actie | 2.074 | eerder via de e-mailstroom binnengekomen |
| **nu gekoppeld** | **1.369** | |
| geweigerd, `ambiguous_no_date` | ~223 | hergebruikte referentie zonder leesbare datum |
| geen afrekening gevonden | 798 | leverancier staat niet in de portal, of buiten de periode |
| naam onleesbaar | 166 | duurzaamheidsrapportages en kale nummerbestanden — géén salessheets |

Die 166 zijn nagekeken: het zijn bestanden uit een `DuurzaamheidsRapportage`-submap plus losse
`<nummer>.pdf`. Daar gaat dus niets verloren.

**Er blijven 3.921 afrekeningen zonder pdf.** Die zitten simpelweg niet in dit archief. Een deel hoort bij
leveranciers die nog niet in de portal staan; dat aantal daalt vanzelf naarmate er meer worden aangezet
en gebackfilled.

---

## Wat hier níét mee opgelost is

**De e-mailstroom van vóór half augustus is verloren.** Als een pdf destijds niet matchte, gooide de
route hem weg — alleen de naam en de reden bleven in `SalesSheetIngestion` staan. In totaal zijn er
**2.437 pdf's afgeketst op `no_match`**, veelal omdat de leverancier nog niet in de portal stond.

Imani (`COLXIMA`) is daar het schoolvoorbeeld van: tien pdf's aangeboden tussen 27 juli en 17 augustus,
allemaal geweigerd, en de afrekeningen waar ze bij horen (`INT000086` t/m `INT000112`) bestaan sinds de
backfill wél. Die tien bestanden zitten niet in dit archief en komen alleen terug als ze opnieuw
worden aangeboden.

Overweging voor later: de route zou een niet-matchende pdf kunnen bewaren in plaats van weggooien, zodat
een latere backfill hem alsnog kan koppelen. Dat is een eigen wijziging en staat hier los van.

---

## Het bewijs

- `private_input/koppelingen-voor.json` — de 2.498 koppelingen zoals ze vóór de run stonden
- `private_input/link-salessheet-pdfs-2026-08-*.json` — drie rapporten, per bestand wat ermee gebeurd is
  en waarom, inclusief de precieze weigeringsreden
- `private_input/link-run.log` — de terminaluitvoer van de eerste run
- `SalesSheetIngestion` in de database — per verzoek een regel, met dezelfde redenen

Alles in `private_input/` is gitignored en blijft lokaal.

---

## Overdoen na een flush

Het script is idempotent: het verwerkt alleen afrekeningen zonder pdf. Draai je het nu opnieuw, dan
gebeurt er niets. Na een volledige flush van de datatabellen en een verse sync staat alles weer open en
begint het vanzelf overnieuw. Zie [salessheet-pdfs-koppelen.md](salessheet-pdfs-koppelen.md).

Eén detail dat daarbij hoort: filteren op "afrekening zonder pdf" alleen is niet genoeg. Bij een
hergebruikte referentie ziet `13-370932.pdf` altijd nog vrije `13-*`-afrekeningen staan en zou hij elke
run opnieuw meegaan. Het script kijkt daarom óók of er al een document met exact die bestandsnaam hangt.
Na een echte flush is die administratie eveneens weg, dus dan is er niets dat de herstart in de weg zit.

---

## Nog te doen op productie

Deze actie is **alleen op test** uitgevoerd. Op productie moet hij opnieuw, ná de sync en ná de
backfills — anders zijn de afrekeningen er nog niet om aan te koppelen. Zie
[productie-checklist.md](productie-checklist.md).
