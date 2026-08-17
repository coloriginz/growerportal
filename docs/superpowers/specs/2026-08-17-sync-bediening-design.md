# Ontwerp: bediening van de sync-motor

> **Status:** ontwerp, nog niet gebouwd.
> **Datum:** 17 augustus 2026
> **Bouwt op:** [2026-08-15-portal-gestuurde-sync-design.md](2026-08-15-portal-gestuurde-sync-design.md),
> waarvan het implementatieplan
> [2026-08-15-sync-motor.md](../plans/2026-08-15-sync-motor.md) op 17 augustus is afgerond.
> **Aanleiding:** de motor draait, maar is alleen te bedienen met SQL tegen de database. Tijdens het
> bouwen zijn er een stuk of tien wegwerpscripts geschreven om te zien wat de wachtrij deed. Dat is
> het bewijs dat dit scherm ontbreekt.
> **Buiten scope:** de backfill per leverancier. Die krijgt een eigen ontwerp, zodat hij ontworpen
> wordt tegen een wachtrij die we bediend hebben zien worden.

---

## 1. Wat dit oplost

De sync neemt sinds 17 augustus zelf beslissingen: of er gedraaid wordt, over welke periode, en met
welke query. Die beslissingen staan in twee rijen in `SyncSchedule` en de uitvoering in `SyncJob`.
Beide zijn vandaag alleen zichtbaar en aanpasbaar via de database.

Dat is op drie manieren een probleem.

1. **Instellen vraagt om SQL.** Een interval wijzigen of een ronde uitzetten tijdens onderhoud kan
   alleen met een `UPDATE`. Dat is precies het soort handeling dat je op een ongelukkig moment doet.
2. **De lopende ronde is onzichtbaar.** Het bestaande importscherm toont `ImportBatch`, en een job die
   nog niet verstuurd is heeft nog geen batch. Wat er in de wachtrij staat is dus niet te zien.
3. **De historie mist de helft van het verhaal.** Je ziet wat er binnenkwam, maar niet over welk
   venster, bij welke ronde, de hoeveelste poging, of welke leveranciers zijn overgeslagen.

---

## 2. Genomen beslissingen

| onderwerp | keuze | overweging |
|---|---|---|
| **Scope** | eerst de bediening, backfill later | de backfill raakt de wachtrij op een manier die we nog niet bediend hebben zien worden |
| **Plaatsing** | uitbreiden van `/admin/imports`, niet een nieuw scherm | dezelfde ronde vanuit twee schermen tonen is hoe cijfers gaan lijken te verschillen |
| **Historie** | blijft gedreven door `ImportBatch`, aangevuld met jobgegevens | de batch is het verslag van wat er met data gebeurde; de job voegt context toe |
| **Lopende ronde** | apart blok, gedreven door `SyncJob` | alleen de jobkant kent werk dat nog moet beginnen |
| **Riskante instellingen** | waarschuwen, niet blokkeren | een blokkade die je niet kunt omzeilen wordt een reden om weer met SQL te werken |
| **Handmatig tikken** | eigen route met sessie-auth | `CRON_SECRET` hoort niet in een browser |

---

## 3. Het scherm

`/admin/imports` krijgt drie tabs: **Data Sync**, **Schema's**, **Sales Sheets**.

### Data Sync

**Gezondheidsregel per schema, bovenaan.** Wanneer liep dit schema voor het laatst helemaal goed, en
staat er iets vast. Dit is de blik van drie seconden: gaat het goed, dan klik je weg.

**"Nu bezig", alleen zichtbaar als er werk in de wachtrij staat.** De jobs van de lopende ronde met
hun status, in volgorde, plus het aantal pogingen. Verdwijnt zodra de ronde klaar is. Hier staat ook
de knop **wachtrij een stap**, want de wachtrij is één rij over alle schema's heen — er staat er
hoogstens één tegelijk uit, ongeacht welk schema hem heeft klaargezet. Die knop hoort dus bij de
wachtrij en niet bij een schema.

**De bestaande historie-tabel**, uitgebreid met vier kolommen uit de job: het opgehaalde venster, de
ronde waar het bij hoorde, de hoeveelste poging, en bij `lots` welke leveranciers zijn overgeslagen.

De bestaande KPI-kaarten per endpoint en de foutdialoog blijven zoals ze zijn.

### Schema's

De twee regels uit `SyncSchedule`, bewerkbaar: aan of uit, interval of tijdstip, welke endpoints, het
venster, en de uitzonderingen per endpoint. Per regel één knop: **nu draaien**, die een ronde klaarzet
ongeacht `lastRunAt`.

Die knop en de stapknop bij de wachtrij zijn samen geen gemak maar noodzaak: op test is `develop` een
preview-deployment en Vercel Cron vuurt alleen op productie. Zonder die twee staat de wachtrij daar
stil en moet je hem met scripts vooruit duwen, zoals tijdens het bouwen.

---

## 4. Waarschuwen zonder blokkeren

`windowAdvies()` komt naast `isDue()` in `src/lib/sync/schedule.ts` te staan: een pure functie die een
schema aanneemt en een lijst waarschuwingen teruggeeft. Het scherm toont ze bij het bewerken; de
opslagroute gebruikt ze niet om te weigeren.

De regels komen uit metingen van 16 en 17 augustus:

| regel | waarom |
|---|---|
| `costs` onder 21 dagen | na één week bestaat 45% van de kostenregels, na twee weken 88%, daarna alles. Daaronder mis je structureel, elke nacht, zonder foutmelding |
| venster kleiner dan tweemaal de rondefrequentie | geen marge als een ronde overslaat; het venster schuift dan over leveringen die nooit zijn opgehaald |
| interval onder vijf minuten | korter dan de cron zelf, dus zinloos |

De opslagroute controleert wél types en bereiken: gehele getallen, een positief venster, een `atTime`
die op `HH:MM` lijkt, en endpoints die bestaan. Dat is iets anders dan een riskante keuze weigeren.

---

## 5. Routes

Alle vijf met `requireAuth(["admin"])`.

| route | doet |
|---|---|
| `GET /api/sync/schedules` | de twee regels plus, per schema, wanneer het voor het laatst helemaal goed liep |
| `PUT /api/sync/schedules/[name]` | opslaan na type- en bereikcontrole |
| `POST /api/sync/schedules/[name]/run` | zet nu een ronde klaar, ongeacht `lastRunAt` |
| `POST /api/sync/advance` | verwerkt één stap uit de wachtrij |
| `GET /api/sync/jobs` | de lopende ronde |

`/api/sync/advance` roept dezelfde `tick()` aan als de cron-ingang, maar achter een sessie in plaats
van `CRON_SECRET`. Dezelfde functie, een andere deur.

De historie haalt zijn jobgegevens niet apart op: `/api/admin/import-batches` krijgt een left join op
`SyncJob`. Eén query, zodat de twee helften van een regel niet uit de pas kunnen lopen.

**"Wanneer liep dit schema voor het laatst helemaal goed"** is afgeleid en niet opgeslagen: de laatste
`runId` van dit schema waarvan alle jobs op `done` staan. Dat vult het gat dat in het vorige ontwerp
open bleef — `lastRunAt` wordt gestempeld bij het klaarzetten, niet bij het slagen, en kan dus nooit
als alarm dienen.

---

## 6. Wat er in de code verandert

**`imports-content.tsx` wordt opgesplitst.** Het bestand is ongeveer 700 regels met twee tabs; met een
derde tab en de wachtrij-uitbreiding erbij wordt het onwerkbaar. Het wordt een omhulsel met de tabs en
per tab een eigen bestand. Dat is geen opruiming naast het werk maar de goedkoopste manier om deze
wijziging aan te brengen.

**Verversen wordt afhankelijk van wat er gebeurt.** Het scherm ververst nu elke dertig seconden. Staat
er een job op `dispatched`, dan elke vijf; anders blijft het dertig. Gewoon via `useFetch`.

---

## 7. Testaanpak

`windowAdvies()` is puur en krijgt een controlescript onder `scripts/checks/`, in dezelfde vorm als de
bestaande: een venster van 7 dagen op `costs` moet waarschuwen, 28 niet, en een interval van één
minuut moet waarschuwen. Dit project heeft geen testframework en dit ontwerp voert er geen in.

De rest is integratie en wordt op test gecontroleerd: een schema aanpassen en zien dat de volgende
ronde het gebruikt, een ronde starten en hem in "nu bezig" zien verschijnen, en de wachtrij met de
knop stap voor stap zien vorderen.

---

## 8. Wat hier niet in zit

- **De backfill per leverancier.** Eigen ontwerp. Dit scherm is er wel de voorwaarde voor: een
  backfill zet tientallen brokken in de wachtrij en dat wil je kunnen volgen.
- **Opruimen van oude jobs.** `SyncJob` groeit met ongeveer 26.000 rijen per jaar. Voor Postgres is dat
  niets en de indexen raken alleen het kleine `pending`/`dispatched`-deel. Het telt pas als de
  historie in dit scherm traag wordt.
- **Een tweede tijdstempel voor de laatst geslaagde ronde.** Afleiden uit de jobs is genoeg zolang de
  historie klein is. Wordt dat traag, dan is een kolom op `SyncSchedule` de volgende stap.
- **Vaste klokstijden voor de intraday-ronde.** `intervalMin` schuift mee met de laatste run. Wil je
  echt 10:00, 16:00 en 22:00, dan moet `atTime` een lijst worden — een schemawijziging plus een
  aanpassing aan `isDue`, die nu zorgvuldig getest is.
