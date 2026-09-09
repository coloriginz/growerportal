# Wat productie nog nodig heeft

> Bijgewerkt: 8 september 2026. Dit is de losse lijst van dingen die op **test** staan en op
> **productie** nog moeten gebeuren. Instellingen en schemawijzigingen reizen niet mee met een deploy;
> alleen code doet dat. Streep af wat gedaan is en verwijder dit bestand zodra het leeg is.
>
> **Alles hieronder is op 8 september 2026 tegen de productiedatabase nagelezen** in plaats van
> overgeschreven. Dat was nodig: de lijst noemde punten 2 tot en met 8 nog als openstaand terwijl ze
> al maanden draaien, en een checklist die dingen als open toont die gedaan zijn is op termijn
> schadelijker dan geen checklist — je gaat hem wantrouwen, en dan mis je het punt dat er wél toe doet.
> Wat er echt nog ligt staat in §8.

**Stand van productie op 8 september 2026:** 56 leveranciers, 7.983 afrekeningen (31-12-2024 tot
08-09-2026), 68.550 partijen, 344.892 transacties, 17.342 partijcorrecties. 3.575 importrondes sinds
10 mei 2026, waarvan 49 mislukt. Beide schedules staan aan en draaiden voor het laatst om 17:04.

## 1. Schemawijzigingen — GEDAAN

Twee rondes:

- **24 augustus 2026** — `lastImportBatchId` op vijf tabellen plus `SyncJob.priority`, uitgevoerd via
  de Neon HTTP-driver tegen `.env.production`. Het bleken er meer dan de twee die hier stonden.
- **8 september 2026** — `Transaction.creditInvoiceNumber` en `creditInvoiceDate`, met
  `prisma db push` tegen `.env.production`, vóór de merge naar `main` (de sync draait daar elke vijf
  minuten, dus code die naar die kolommen schrijft mag er niet eerder zijn dan de kolommen zelf).
- **10 september 2026 — NOG TE DOEN op productie** — `User.firstName`, `middleName` en `lastName`,
  alle drie nullable. Staan op test. Na de push hoort `scripts/backfill-user-names.ts --apply` te
  draaien: die vult de drie velden uit de bestaande `name` en laat `name` zelf ongemoeid, dus hij is
  onzichtbaar in de portal en kan zonder gevolgen nog eens. Zonder die ronde blijven de kolommen
  leeg tot iemand een gebruiker toevallig bewerkt — het formulier splitst een oude naam dan alsnog
  bij het openen.

`npx prisma migrate diff --from-url "<productie DIRECT_URL>" --to-schema-datamodel prisma/schema.prisma --script`
geeft sindsdien "This is an empty migration". **Dat is de manier om dit te controleren** — geen
handwerk, geen lijst die je moet bijhouden. Poort 5432 blijkt per netwerk te verschillen; meet het
eerst (zie de ontwikkelnotities in `CLAUDE.md`), dan weet je of `db push` kan of dat het via de
HTTP-driver moet.

## 2. Omgevingsvariabelen — GEDAAN, voor zover van buiten te zien

- **`NEXT_PUBLIC_APP_ENV=production`** — staat er. Niet rechtstreeks af te lezen van buiten Vercel,
  maar wel te bewijzen: zonder deze variabele weigert `/api/sync/tick` te versturen en zou er niets
  syncen. Er draaien 3.575 geslaagde importrondes, dus hij staat goed. Dezelfde variabele bepaalt
  sinds 7 september ook in welke map blobuploads landen (`prod/`); zonder haar zouden die in
  `unknown/` terechtkomen.
- **`CRON_SECRET`** — staat er al.
- **`IMPORT_API_KEY_PREVIOUS`** — nog niet nagekeken; van buiten Vercel niet te zien. Mag eruit zodra
  alle Power Automate-flows op de nieuwe sleutel draaien.

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

Beide flows werken: er draaien geslaagde rondes op productie.

**Nog niet bewezen, en het is de enige echte onbekende van de laatste wijziging.** De ordersquery
leest sinds 8 september ook uit `intermediate.int_order_correctie` en `staging.stg_kbtpro__fact`, een
laag onder de marts. Via de **vraag**-flow werkt dat aantoonbaar — de gecombineerde query met
`marts.fct_orders` erin draait daar zonder mopperen, dus die verbinding mag bij beide schema's. De
**haal**-flow is een andere flow en is er nog niet langs geweest. Gaat dat mis, dan zie je het niet
aan een foutmelding: die flow antwoordt 202 zodra hij start, dus de job blijft op `dispatched` staan
tot de reaper hem na een kwartier omlegt. Kijk na de eerste orders-ronde of er een geslaagde batch
staat.

## 4. Instellingen per omgeving — GEDAAN

- **De twee `SyncSchedule`-rijen** staan aan: `intraday` elke 360 minuten over 2 dagen
  (`lots`, `orders`), `nightly` om 03:00 over 7 dagen (alle vijf endpoints) met
  `windowOverrides: {"costs": 28}`. Laatste ronde 8 september 17:04.
- **`sync.backfillStartDate`** staat op `2024-01-01`.

## 4b. Salessheet-pdf's koppelen — NOG NIET AF

**364 van de 7.983 afrekeningen hebben een gekoppelde pdf (4,6%), waarvan er 362 zijn uitgelezen.**
Op test is dat 4.061. Zolang dit niet gedraaid is, dekt de `pdf-mismatch`-controle op productie bijna
niets af en is de omzetaansluiting daar niet te maken.

Draai eerst zonder `--apply`: dat is de standaard en toont wat hij zou doen. Zie
[salessheet-pdfs-gekoppeld-2026-08-21.md](salessheet-pdfs-gekoppeld-2026-08-21.md) voor wat er op test
gebeurde en [salessheet-pdfs-koppelen.md](salessheet-pdfs-koppelen.md) voor het commando.

## 5. Volgorde — grotendeels afgewerkt

1. ~~SQL uit §1 tegen de productiedatabase~~ — gedaan 24 augustus 2026, aangevuld 8 september 2026
2. ~~`NEXT_PUBLIC_APP_ENV` zetten~~ — gedaan (zie §2)
3. ~~Beide Power Automate-verbindingen controleren~~ — gedaan; er draaien rondes
4. ~~Merge naar `main` en laten deployen~~ — gedaan 24 augustus 2026 (`1d05752`), laatste 8 september (`bdc92f3`)
5. ~~Eén ronde met de hand aftikken en de aantallen nalopen~~ — gedaan; 3.575 rondes sindsdien
6. ~~Schedules aanzetten, basisdatum zetten~~ — gedaan (zie §4)
7. Backfills draaien voor de leveranciers die je wilt — deels; zie §8
8. Salessheet-pdf's koppelen (§4b) — nog niet

## 6. Waar je op moet letten

- **Het ordersvenster.** Sinds het consignatie-filter aan de bronkant zit haalt een ronde over acht
  dagen 7.009 rijen op in plaats van 15.229. Power Automate kwam niet terug bij 15.229 en net wel bij
  11.128, dus het venster van 7 dagen houdt stand — maar de dichtheid groeit, dus dit is geen
  instelling die je één keer goed zet.
- **De overgeslagen leveranciers.** Na een ronde staat er een lijst met relaties die geen leverancier
  in de portal hebben. Zet er alleen aan wat je bewust wilt: aanzetten haalt zijn historie op, en dat
  is uren werk.
- **Niet-consignatie.** `SELECT COUNT(*) FROM "Lot" WHERE "purchaseType" <> 'CONS'` hoort nul te zijn.
  **Op 8 september staan er 3.** Klein, maar het hoort nul te zijn, dus het is de moeite waard om te
  kijken wanneer die binnengekomen zijn — het filter zit sindsdien aan de bronkant, dus vermoedelijk
  zijn het rijen van vóór die wijziging.
- **49 mislukte importrondes** van de 3.575. Niet nagelopen waarop.

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

## 8. Wat er nog ligt

### 8a. Productie mist vrijwel al zijn orderregelcorrecties

Gemeten op 8 september 2026, `Transaction` naar `bronFeitExtra`:

| | productie | test |
|---|---|---|
| origineel | 344.867 | 347.131 |
| correcties | **18** | 2.460 |
| prullenbak-factcor | **7** | 739 |

Partijcorrecties zijn er wél (17.342 tegen 17.714 op test), dus het zit niet in de lots-import maar
in de orders-import. De aantallen originele regels lopen bijna gelijk, dus het is geen kwestie van
minder historie: de correctierijen ontbreken.

Dat is geen cosmetisch verschil. Correcties zijn negatief — op test gaat het om −EUR 313.993 over
2.454 rijen. Ontbreken ze, dan staat de omzet in de portal te hoog, en dat is precies het getal dat
de kweker op zijn afrekening naast de portal legt.

**Vermoeden, niet gemeten:** de warehouse voegt correcties ná de levering toe en het schuivende
venster komt daar nooit meer langs. Op test zijn sinds april meerdere inhaalrondes over oude
kwartalen gedraaid (`repair-zero-orders.ts`, `repair-costs.ts`, `backfill-credit-invoices.ts`); op
productie is dat nooit gebeurd. Dat verklaart het patroon, maar het is niet nagetrokken.

Wat het níét oplost: `scripts/backfill-credit-invoices.ts` haalt alleen de creditfactuur op bij
correcties die er al staan. Voor productie is een gewone **orders-backfill over 2025 en 2026** nodig
die de ontbrekende rijen alsnog binnenhaalt. Meet daarna opnieuw.

### 8b. Salessheet-pdf's koppelen

Zie §4b. 364 van 7.983.

### 8c. Kleine dingen

- 3 partijen met een ander inkooptype dan `CONS` (§6).
- 49 mislukte importrondes van de 3.575, oorzaak niet nagelopen.
- `IMPORT_API_KEY_PREVIOUS` opruimen (§2) en de sleutel per omgeving scheiden (§7).
