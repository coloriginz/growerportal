# Wat productie nog nodig heeft

> Bijgewerkt: 20 augustus 2026. Dit is de losse lijst van dingen die op **test** staan en op
> **productie** nog moeten gebeuren. Instellingen en schemawijzigingen reizen niet mee met een deploy;
> alleen code doet dat. Streep af wat gedaan is en verwijder dit bestand zodra het leeg is.

## 1. Schemawijzigingen — GEDAAN op 24 augustus 2026

Uitgevoerd via de Neon HTTP-driver tegen `.env.production`. Het bleken er meer dan de twee die hier
stonden: `lastImportBatchId` ontbrak op vijf tabellen, niet op één.

> Dat het met de hand ging was overigens niet nodig: poort 5432 blijkt per netwerk te verschillen en
> stond op dat moment gewoon open, dus `prisma db push` had gekund. Meet het eerst — zie de
> ontwikkelnotities in `CLAUDE.md`.

```sql
ALTER TABLE "Grower"         ADD COLUMN "lastImportBatchId" TEXT;
ALTER TABLE "Lot"            ADD COLUMN "lastImportBatchId" TEXT;
ALTER TABLE "LotCorrection"  ADD COLUMN "lastImportBatchId" TEXT;
ALTER TABLE "SalesSheetCost" ADD COLUMN "lastImportBatchId" TEXT;
ALTER TABLE "Transaction"    ADD COLUMN "lastImportBatchId" TEXT;
ALTER TABLE "SyncJob" ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0;
-- plus een index per lastImportBatchId-kolom,
-- SyncJob_status_createdAt_idx vervangen door SyncJob_status_priority_createdAt_idx
```

Geen handwerk meer nodig om te weten wát er mist: lees `prisma/schema.prisma`, vraag
`information_schema.columns` op tegen de productiedatabase en vergelijk de twee. Dat vond hier vier
kolommen die niemand had opgeschreven.

## 2. Omgevingsvariabelen

- **`NEXT_PUBLIC_APP_ENV=production`** — zonder deze variabele antwoordt `/api/sync/tick` met
  `{"dryRun":true,"reason":"development"}` en gebeurt er niets. De sync staat dan stil zonder dat er
  ergens een fout verschijnt.
- **`CRON_SECRET`** — staat er al.
- **`IMPORT_API_KEY_PREVIOUS`** — mag eruit zodra alle Power Automate-flows op de nieuwe sleutel
  draaien. Zolang hij er staat wordt de oude sleutel nog geaccepteerd.

## 3. Power Automate

Beide flows hebben hun eigen SQL-verbinding, en die moeten allebei naar het huidige Fabric-endpoint
wijzen:

```
gxj6wkn4weouxoe35jxcon4hmi-bd7jcf6wfpgurdnlardqqbs62m.datawarehouse.fabric.microsoft.com
```

Op 19 augustus is `wh_transform` gesloopt en opnieuw aangemaakt door een dbt-teardown. Het endpoint hangt
aan het warehouse-**item**, niet aan de workspace: wordt dat item opnieuw aangemaakt, dan verandert het
achtervoegsel en blijft het oude adres antwoorden op een leeg omhulsel. `SELECT 1` werkt dan nog, alles
met `marts.` faalt. **Dit gaat nog eens gebeuren** — herken het aan een keten die vastloopt op
`suppliers`, de kleinste query die we hebben.

De ophaal-flow was op 20 augustus nog niet omgezet terwijl de vraag-flow dat wel was; controleer ze dus
allebei.

## 4. Instellingen die per omgeving gezet moeten worden

- **De twee `SyncSchedule`-rijen.** Op test staat `intraday` op elke 6 uur met een venster van 2 dagen,
  en `nightly` op 03:00 met 7 dagen en `windowOverrides: {"costs": 28}`. Kosten hebben een breder
  venster nodig omdat afrekenen weken achterloopt op leveren.
  **Zet ze op productie pas aan als de rest klopt** — een ronde die draait terwijl het schema niet
  compleet is trekt gaten.
- **De basisdatum voor backfills** (`Setting`-sleutel `sync.backfillStartDate`). Op test `2024-01-01`.
  Zonder deze instelling weigert een backfill met een leesbare melding; hij gokt niet.

## 4b. Salessheet-pdf's koppelen

Na de sync en na de backfills — anders bestaan de afrekeningen nog niet om aan te koppelen. Op test
leverde dit 1.369 koppelingen op; zie [salessheet-pdfs-gekoppeld-2026-08-21.md](salessheet-pdfs-gekoppeld-2026-08-21.md)
voor wat er precies gebeurde en [salessheet-pdfs-koppelen.md](salessheet-pdfs-koppelen.md) voor het commando.

Draai eerst zonder `--apply`: dat is de standaard en toont wat hij zou doen.

---

## 5. Volgorde

1. ~~SQL uit §1 tegen de productiedatabase~~ — gedaan 24 augustus 2026
2. `NEXT_PUBLIC_APP_ENV` zetten
3. Beide Power Automate-verbindingen controleren
4. ~~Merge naar `main` en laten deployen~~ — gedaan 24 augustus 2026 (`1d05752`)
5. Eén ronde met de hand aftikken en de aantallen nalopen vóór je het schema aanzet
6. Schedules aanzetten, basisdatum zetten
7. Backfills draaien voor de leveranciers die je wilt
8. Salessheet-pdf's koppelen (§4b)

## 6. Waar je op moet letten bij die eerste ronde

- **Het ordersvenster.** Sinds het consignatie-filter aan de bronkant zit haalt een ronde over acht
  dagen 7.009 rijen op in plaats van 15.229. Power Automate kwam niet terug bij 15.229 en net wel bij
  11.128, dus het venster van 7 dagen houdt stand — maar de dichtheid groeit, dus dit is geen
  instelling die je één keer goed zet.
- **De overgeslagen leveranciers.** Na de eerste ronde staat er een lijst met relaties die geen
  leverancier in de portal hebben. Op test zijn dat er 19, allemaal echte consignatie-kwekers. Zet er
  alleen aan wat je bewust wilt: aanzetten haalt zijn historie op, en dat is uren werk.
- **Niet-consignatie.** `SELECT COUNT(*) FROM "Lot" WHERE "purchaseType" <> 'CONS'` hoort nul te zijn
  en te blijven. Staat er iets, dan is het filter niet meegekomen.

## 7. Later, geen blokkade: sleutel per omgeving

Test en productie delen sinds 24 augustus 2026 dezelfde `IMPORT_API_KEY`, omdat de haal-flow één
vaste `Authorization`-header meestuurt en productie daardoor met 401 antwoordde. Dat werkt, maar het
betekent dat een lek aan de testkant ook schrijftoegang tot de productie-imports geeft.

De flow weet al in welke omgeving hij post — daar hangt de `BaseUrl`-compose van af. Een tweede
compose ernaast maakt de sleutels weer los van elkaar:

```
ImportKey = if(equals(triggerBody()?['env'], 'production'), '<productiesleutel>', '<testsleutel>')
Authorization: Bearer @{outputs('ImportKey')}
```

Twee dingen die daarbij horen:

- **Secure inputs aan** op de HTTP-actie, en secure outputs op die compose. Nu staat de sleutel
  leesbaar in de inputs van elke run in de flowgeschiedenis.
- **De huidige sleutel vervangen** bij die gelegenheid; hij is in een screenshot terechtgekomen.
  Roteren kan zonder onderbreking: nieuwe als `IMPORT_API_KEY`, huidige als
  `IMPORT_API_KEY_PREVIOUS`, flow omzetten, `PREVIOUS` weghalen.
