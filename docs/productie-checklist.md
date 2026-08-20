# Wat productie nog nodig heeft

> Bijgewerkt: 20 augustus 2026. Dit is de losse lijst van dingen die op **test** staan en op
> **productie** nog moeten gebeuren. Instellingen en schemawijzigingen reizen niet mee met een deploy;
> alleen code doet dat. Streep af wat gedaan is en verwijder dit bestand zodra het leeg is.

## 1. Schemawijzigingen

Twee kolommen zijn op test met de hand gezet, omdat `prisma db push` op het werkstation niet kan
verbinden (poort 5432 is dicht op het werknetwerk). Op productie moet dezelfde SQL draaien, tegen de
productiedatabase, **vóór** de code daar deployt — anders schrijven de imports naar een kolom die er
niet is.

```sql
-- herkomst per correctie (taak van 19 augustus)
ALTER TABLE "LotCorrection" ADD COLUMN "lastImportBatchId" TEXT;
CREATE INDEX "LotCorrection_lastImportBatchId_idx" ON "LotCorrection"("lastImportBatchId");

-- voorrang in de sync-wachtrij (backfill, 20 augustus)
ALTER TABLE "SyncJob" ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0;
DROP INDEX IF EXISTS "SyncJob_status_createdAt_idx";
CREATE INDEX "SyncJob_status_priority_createdAt_idx" ON "SyncJob"("status", "priority", "createdAt");
```

`.env.production` wijst naar de productiedatabase. Uitvoeren kan via de Neon HTTP-driver, net als op
test.

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

## 5. Volgorde

1. SQL uit §1 tegen de productiedatabase
2. `NEXT_PUBLIC_APP_ENV` zetten
3. Beide Power Automate-verbindingen controleren
4. Merge naar `main` en laten deployen
5. Eén ronde met de hand aftikken en de aantallen nalopen vóór je het schema aanzet
6. Schedules aanzetten, basisdatum zetten

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
