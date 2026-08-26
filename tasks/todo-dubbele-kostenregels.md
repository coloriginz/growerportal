# Dubbele kostenregels: de import ruimt ingetrokken regels niet op

> **Kern:** Fabric geeft de kostenregels van een levering soms opnieuw uit onder nieuwe
> `shkost_id`'s. `POST /api/import/costs` doet uitsluitend upsert op die sleutel en verwijdert
> nooit, dus de oude regels blijven staan naast de nieuwe. `SalesSheet.totalCosts` telt ze allemaal
> op en `netResult` is navenant te laag — en dat is het getal dat de kweker ziet.
>
> **Status:** open, gemeten op 26-08-2026. Niet veroorzaakt door de reparatieruns; die maakten het
> zichtbaar.

---

## Omvang

- **470 van de 7.879 leveringen** (6%) hebben meer dan één kostenregel met dezelfde omschrijving.
- Samen **1.109 overtollige regels**.
- De zwaarste gevallen zijn recent en geconcentreerd:

| levering | leverancier | leverdatum | kostenregels | totalCosts |
|---|---|---|---|---|
| C043 Blomkloof | PCFFARCO | 03-07-2026 | 182 | 1.531,57 |
| C045 Intaba Sa | COLBFL | 10-07-2026 | 154 | 295,26 |
| C047 Intaba Sa | COLBFL | 17-07-2026 | 140 | 214,20 |
| C041 Blomkloof | PCFFARCO | 26-06-2026 | 68 | 1.801,01 |

C045 Intaba Sa is elf omschrijvingen maal veertien rijen. Dertien van die veertien hebben geen
`costCode` — ze dateren van vóór de martwijziging van augustus 2026 — en hun `shkost_id`'s bestaan
niet meer in Fabric. Dezelfde `parthdr_id` heeft daar nu 21 rijen met andere id's en dezelfde
leverdatum.

## Waarom een dubbele omschrijving hier wél bewijs is

Een levering mág twee regels met dezelfde naam hebben (ander `kost_id`, andere grondslag). Veertien
identieke omschrijvingen op één levering is dat niet. De harde controle is de `shkost_id`: staat hij
niet meer in `marts.fct_salesheets_costs`, dan is de regel ingetrokken.

## De reparatie

De costs-import moet per levering verzoenen in plaats van alleen upserten: voor elke `parthdr_id`
die in de payload voorkomt, de kostenregels verwijderen waarvan de `shkost_id` niet in die payload
zit.

**Dat mag, en dat is gemeten, niet aangenomen:** geen enkele levering in
`marts.fct_salesheets_costs` heeft kostenregels met meer dan één `_datum_key_levering`
(`COUNT(DISTINCT …) > 1` levert nul leveringen op). Een vensterophaling geeft dus altijd de
complete actuele kostenset van elke levering die het venster raakt — er kan geen regel buiten het
venster vallen die wél nog geldig is.

- [ ] Verzoening per `parthdr_id` inbouwen in `src/app/api/import/costs/route.ts`, naast de
      bestaande upsert. Alleen voor leveringen die in de payload zitten; leveringen die het venster
      niet raakt blijven ongemoeid.
- [ ] Het aantal verwijderde regels terugmelden in het importresultaat en op het importscherm,
      anders is een opruiming net zo stil als het probleem.
- [ ] `scripts/repair-costs.ts` daarna opnieuw over alle 244 rondes draaien; dan verdwijnen de
      1.109 overtollige regels en kloppen `totalCosts` en `netResult` weer.
- [x] **`/api/import/orders` heeft hetzelfde mankement, maar het weegt niet zwaar.** Die route
      verwijdert wél, maar alleen de `(lotId, fabricOrdregId)`-paren die in de payload zitten, dus
      een ingetrokken orderregel blijft net zo goed staan. Gemeten over COLBFL 2026 Q2 (1.511
      Fabric-rijen, 1.277 unieke ordregs, 1.408 portaltransacties): **één** transactie draagt een
      ordreg die Fabric niet meer kent — 5 stelen, EUR 17,07. Tegenover 1.109 overtollige
      kostenregels is dat een andere orde van grootte. Verzoening per partij is daar dus wel de
      juiste vorm, maar geen haast. Eén venster is geen portalbrede meting; die kost 244
      Fabric-vragen en is de moeite pas waard als er een aanleiding bijkomt.

## Randgevallen

- [ ] Een levering waarvan Fabric álle kostenregels heeft ingetrokken komt niet in de payload voor
      en wordt door de verzoening dus niet geraakt. Bewust: een leeg antwoord mag nooit een
      afrekening leegvegen. Zie de leegte-controle in `scripts/repair-costs.ts`.
- [ ] `SalesSheetCost` heeft `lastImportBatchId`; verwijderde regels verdwijnen daarmee uit de
      herkomstlijst van hun oorspronkelijke run. Aanvaardbaar, maar het importscherm moet niet
      omvallen op een run waarvan de regels later zijn opgeruimd.

## Niet doen

- Niet opruimen op "dubbele omschrijving". Dat is het symptoom; `shkost_id` is het bewijs.
