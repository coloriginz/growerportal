# Schone start: van lege database naar volledige portal

> **Doel:** de volgorde vastleggen waarin een lege database gevuld wordt, zodat het één keer goed
> gaat en niet elke keer opnieuw uitgevonden hoeft te worden. Eerst op test beproeven, daarna op
> productie.
>
> **Aanleiding:** alle reparaties van deze week moeten in de basisroutes zitten, niet in de losse
> herstelscripts. Anders reproduceert de eerste backfill precies de fouten die we net hebben
> weggehaald.
>
> **Voor wie dit voor het eerst leest:** elke stap hieronder staat met het commando en met wat je
> hoort te zien. Volg de volgorde letterlijk — omdraaien of overslaan reproduceert precies de bugs
> die deze week gerepareerd zijn (zie de tabel hieronder).

---

## Stand van zaken: waar zit welke reparatie?

| bevinding | zit in de importroute | alleen in een script |
|---|---|---|
| kostenbedragen onafgerond opslaan | ja (`import/costs` + schema) | |
| leeg kostenbedrag verwerpt geen ronde meer | ja (`import/costs`) | |
| ingetrokken kostenregels opruimen | ja (`import/costs`, verzoening) | |
| levering volgt de leverancier uit Fabric | ja (`import/lots`) | |
| levering met tegenstrijdige leveranciers weigeren | ja (`import/lots`) | |
| orderregel die zijn partij tegenspreekt weigeren | ja (`import/orders`) | |
| kweker anders naamloos aangemaakt door de orders-import | ja (volgorde: kwekers vóór orders, zie stap 3) | |
| backfill start bij de eerste consignatiepartij | ja (`sync/backfill-start`) | |
| PDF-koppeling controleert leverdatum en leverancier | ja (`shipments/import-email`) | |
| **historie navullen na een herziening** | **nee** | `repair-zero-orders.ts`, `repair-costs.ts` |

Die laatste is bewust: het schuivende syncvenster komt niet terug op oude periodes. Na een schone
start is dat geen probleem — de backfill haalt alles één keer op — maar zodra het warehouse
historie herziet, loopt de portal weer achter. Dat vraagt een terugkerende ronde, geen eenmalige.
**Ze horen dus niet in deze procedure thuis**: pas weer nodig zodra het warehouse ná de herbouw
opnieuw historie herziet, niet als vast onderdeel van de herbouw zelf.

## Wat er níet opnieuw opgebouwd wordt

"De database opnieuw opbouwen" kan niet letterlijk. Alleen de tabellen die uit Fabric komen zijn
herbouwbaar; de rest bestaat alleen hier en is weg als je hem weggooit.

| herbouwbaar uit Fabric | alleen in de portal (blijft ongemoeid) |
|---|---|
| `Transaction`, `Lot`, `SalesSheet`, `SalesSheetCost`, `LotCorrection`, `Grower` | `User`, `Supplier`, `Document`, `ShipmentForecast`, `QualityIssue`, `Certificate`, `ChangeRequest`, alle fust-tabellen, `FustAuditLog`, `ImportBatch` |

In gewone taal: **gebruikers, fustorders/-instellingen en de admin-instellingen worden niet
aangeraakt.** Deze procedure vult alleen de Fabric-afgeleide tabellen.

**`Supplier` is het anker en moet zijn id's houden.** Gebruikers, fustorders, prognoses en documenten
hangen eraan; een nieuwe uuid maakt die wezen. Hetzelfde geldt voor `Document`: de blobs blijven
bestaan, maar `SalesSheet.pdfDocumentId` wijst naar een afrekening die na de herbouw een nieuwe
uuid heeft, dus die koppelingen moeten opnieuw gelegd worden — niet gemigreerd.

Op test is die rechterkolom bijna leeg (0 fustorders, 5 prognoses). Op productie niet. Meet het
daar vóór je begint, niet erna.

## Blokkade: 397 PDF's staan alleen in de blobopslag

De herbouw koppelt salessheets vanuit `private_input/salessheets`. Van de gekoppelde afrekeningen
zijn er 397 waarvan het bestand daar niet in zit: die kwamen via de e-mailstroom binnen en bestaan
alleen als blob. Na een herbouw zijn die koppelingen weg en niet terug te leggen — de route heeft
het bestand zelf nodig om de leverdatum te lezen, en die is sinds 29-08-2026 verplicht.

- [ ] Die 397 blobs eerst naar het archief halen, vóór de herbouw. `Document.fileUrl` staat in de
      database, dus het is een download per stuk.
- [ ] Daarna `scripts/audit-salessheet-links.ts` erop draaien: nu zijn ze niet te controleren, en
      dat is de enige groep waarvan we niet weten of de koppeling klopt.

---

## Procedure

Op een lege database moet eerst het schema staan en moet er een admin-gebruiker zijn om in te
loggen en relaties te activeren — dat valt buiten deze procedure (`npx prisma db push`, en een
admin-account via `prisma/seed.ts` of handmatig in de database).

### Stap 0 — Sync-schema's klaarzetten (alleen op een lege database)

```
npx tsx scripts/seed-sync-schedules.ts
```

**Verwacht:** print twee `SyncSchedule`-rijen (`intraday`, `nightly`), allebei met
`enabled: false`. Zonder deze stap heeft `/api/sync/tick` niets om te plannen. Schakel ze pas in
(`enabled: true`, via Admin → Import Status of rechtstreeks in de database) als de eerste backfill
achter de rug is — anders loopt de doorlopende sync dwars door de backfill heen.

### Stap 1 — Leveranciers: FabricRelation vullen

`/api/import/suppliers` schrijft **alleen** `FabricRelation`, nooit een `Supplier`. Dat is bewust:
welke relaties leverancier worden is een inhoudelijk besluit, en de verkeerde aanzetten haalt
koop-partijen (FOB/CIF) binnen die hier niet horen.

Normaal draait dit via de portal-gestuurde sync (Power Automate voert de query uit die de portal
opstelt). Op productie tikt Vercel Cron elke 5 minuten vanzelf. **Op test niet** — daar moet je de
tik met de hand geven:

```
curl -X POST https://<test-portal>/api/sync/tick -H "Authorization: Bearer $CRON_SECRET"
```

**Verwacht:** JSON met `{ reaped, orphanBatches, enqueued, dispatched, failed }`. Herhaal (of
gebruik de "Advance queue"-knop op Admin → Import Status) tot de suppliers-ronde op `done` staat.
Controleer daarna Admin → Fabric relations: het aantal relaties moet overeenkomen met wat Fabric
kent, en er is nog **geen** nieuwe `Supplier` bijgekomen.

### Stap 2 — Relaties activeren

Met de hand, via **Admin → Fabric relations**, per relatie op "Activeren". Dat is
`POST /api/admin/fabric-relations` (`src/app/api/admin/fabric-relations/route.ts`): het maakt de
`Supplier` aan én plant in dezelfde aanroep een backfill in, met als startpunt de eerste
consignatielevering van die relatie in Fabric (`resolveBackfillStart()`,
`src/lib/sync/backfill-start.ts`) — niet de globale `sync.backfillStartDate`, die is alleen de
ondergrens.

**Verwacht:** de `Supplier` verschijnt in Admin → Suppliers. Er verschijnen nieuwe `SyncJob`-rijen
onder één `runId` (zichtbaar op de detailpagina van de leverancier of via Admin → Import Status):
eerst één `growers`-job, dan per kwartaal `lots` → `orders` → `costs`.

### Stap 3 — De backfill laten lopen

De wachtrij werkt zichzelf af: elke import-route roept na afloop `completeJobForBatch()` aan
(`src/lib/sync/runner.ts`), die de volgende job in de keten meteen dispatcht. Een tik (of de
"Advance queue"-knop) hoeft de ronde dus alleen te **starten**, niet stap voor stap te duwen — met
één uitzondering: op test tikt Vercel Cron nooit, dus moet je periodiek zelf tikken zolang er nog
werk in de wachtrij staat.

**Volgorde binnen één leverancier, en waarom:**
1. **Kwekers, één keer, zonder datumvenster.** Zij moeten vóór de partijen — niet omdat de
   lots-import kwekers zou wegfilteren (dat doet hij niet, hij noemt kwekers nergens), maar omdat
   de **orders-import** (`src/app/api/import/orders/route.ts`) een ontbrekende kweker anders zelf
   aanmaakt als naamloos bijproduct — zonder code, land of plaats — puur om de orderregel niet te
   hoeven weggooien.
2. **Per kwartaal: lots → orders → costs**, vanaf het kwartaal van de eerste consignatielevering
   tot nu.

```
curl -X POST https://<doelportal>/api/sync/tick -H "Authorization: Bearer $CRON_SECRET"
```

**Verwacht:** `ImportBatch`-rijen lopen op; per leverancier stijgen de aantallen `Lot`,
`Transaction`, `SalesSheetCost`, `Grower`. Dit duurt: de wachtrij verwerkt één job tegelijk. Een
mislukte job annuleert de rest van zíjn eigen run en laat de wachtrij verder gaan met wat er nog
staat — dat is bewust, anders blijft alles daarna voor altijd op `pending` staan.

### Stap 4 — Controleren vóór het koppelen

```
npx tsx scripts/recon-pdf-fabric-portal.ts
```

**Verwacht:** de drieweg-vergelijking (Fabric / PDF / portal) komt dicht bij nul uit op omzet en
kosten. Wijkt het af, dan mankeert er iets aan de backfill — ga daar op zoek, niet bij de PDF's.

### Stap 5 — Salessheets koppelen in één batch

```
npx tsx scripts/link-salessheet-pdfs.ts --api-base=<doelportal>            # eerst dry run
npx tsx scripts/link-salessheet-pdfs.ts --api-base=<doelportal> --apply    # echt versturen
```

`--api-base` is verplicht — er is bewust geen standaardwaarde meer (zie
`scripts/link-salessheet-pdfs.ts`): dit is de laatste stap van de herbouw, en wie de doelportal
vergeet duwt het hele archief stilzwijgend naar de verkeerde omgeving. Dit duwt alles door
`/api/shipments/import-email`, dezelfde route als de e-mailstroom, dus gelden dezelfde datum- en
leverancierscontrole.

**Verwacht:** een rapport met aantallen gekoppeld/overgeslagen. Vrijwel elke PDF in
`private_input/salessheets` krijgt een `pdfDocumentId` op zijn afrekening. Niet koppelen vóór stap 3
klaar is: de koppeling matcht op referentie + leverdatum, en ontbreekt de levering nog, dan
mislukt de koppeling stil en moet het archief opnieuw langs.

### Stap 6 — Koppelingen auditen

```
npx tsx scripts/audit-salessheet-links.ts --apply
```

**Verwacht:** 0 afwijkingen (buiten de 397 blob-only PDF's uit de blokkade hierboven, die pas te
controleren zijn nadat ze uit de blobopslag zijn gehaald). Geeft het er wél, dan is de koppelroute
niet streng genoeg en moet dát gerepareerd worden — niet de data met de hand.

---

## Wat er nog moet gebeuren voordat dit kan

- [ ] **Een terugkerende inhaalronde.** Nu is dat handwerk. Kandidaat: een derde `SyncSchedule`-rij
      die maandelijks een kwartaal uit het verleden opnieuw ophaalt, zodat herzieningen vanzelf
      binnenkomen in plaats van pas bij de volgende reconciliatie.
- [ ] **Partijen-backfill.** Orders en kosten zijn deze week portalbreed opnieuw opgehaald, partijen
      niet. Steellengtes, colli, kwaliteitscodes en correcties dateren dus nog van vóór de
      reparaties, en de leveranciertoewijzing verhuist pas als er een lots-ronde langskomt.
- [ ] **Beslissen over `Grower.supplierId`** (zie `todo-kweker-bij-meerdere-leveranciers.md`). Bij
      een schone start is dat het moment om het model goed te zetten, want dan is er nog niets om te
      migreren.

## Niet doen

- Niet koppelen (stap 5) vóór de backfill (stap 3) klaar is.
- Niet `scripts/repair-zero-orders.ts` of `scripts/repair-costs.ts` als vast onderdeel van de
  herbouw draaien — die zijn de periodieke inhaalronde voor een warehouse dat ná de herbouw
  opnieuw historie herziet, niet een stap in de herbouw zelf.
- Niet de sync-schedules inschakelen (stap 0) vóórdat de eerste backfill klaar is — anders loopt de
  doorlopende sync dwars door de backfill heen.
