# KBT-ontsluiting: portal voeden vanuit lh_landing

> **Doel:** de grower portal niet langer voeden via het semantisch model + Power Automate, maar
> rechtstreeks uit de Fabric landing zone `lh_landing.kbtpro`. Eindbeeld blijft directe toegang tot
> de KBT-bronserver. De tabelstructuur is identiek, dus het datamodel blijft dan gelijk — maar het
> delta-mechanisme moet wel veranderen, want de bron heeft geen technische watermark (zie 1e).
>
> **Achtergrond en bewijsvoering:** `docs/kbt-datalandschap.md`. Kort: de transformatielaag
> vermenigvuldigt rijen (één verdeelregel wordt 35–70 rijen met fractionele aantallen) en laat
> `verd_id` weg, waardoor de portal geen stabiele sleutel heeft. In `lh_landing.kbtpro` is dat
> probleem er niet.
>
> Vorige plan gearchiveerd als `todo-2026-04-multi-company-branding.md`.

---

## Openstaande beslissingen — nodig voor fase 2 en 3

Deze twee bepalen de vorm van de rest. Nog niet genomen.

- [ ] **A. Allocation-model akkoord?** De portal-notie "transactie" wordt de verdeelregel
      (`verd`), niet de orderregel. Zie fase 2. Raakt de hele queryslaag.
- [ ] **B. Vorm van de sync.** Aanbeveling: backfill en terugkerende sync ontkoppelen. Zie hieronder.

### Toelichting bij B

De portal blijft op Neon draaien en wordt aan de achterkant gevuld. De sync is een los ding dat
Neon vult; loopt die stuk, dan draait de portal door op de data van gisteren.

**Frequentie is niet de bepalende factor.** Vaker syncen maakt het juist makkelijker: elke delta
wordt kleiner. Bij de gewenste ~2-uurs verversing zijn dat een paar duizend rijen, wat ruim binnen
een serverless timeout past. Wat de vorm wél bepaalt:

1. De eenmalige volledige laadslag — groot, ongeacht de frequentie daarna.
2. De grootst denkbare delta, niet de gemiddelde. Een herberekening in de bron kan honderdduizenden
   rijen aanraken.
3. Of er een bruikbare watermark bestaat. Dit is het punt dat de route echt kan veranderen: op
   `lh_landing` is er `_ingestion_datetime`, maar op de **definitieve KBT-bron bestaat die niet**.
   Zonder rowversion of gewijzigd-op moet je terugvallen op een venster op businessdatum plus
   periodieke sleutelvergelijking — per run duurder, en bij twaalf runs per dag telt dat op.
   Zie taak 1e.

**Aanbevolen opzet:**

| onderdeel | mechanisme | waarom |
|---|---|---|
| Backfill | eenmalig script, lokaal of via GitHub Action | mag uren duren, hoeft niet herhaalbaar |
| Terugkerende sync | Vercel Cron → API-route | kleine delta's, één platform, `ImportBatch`-logging staat er al |
| Vangnet | afbreken met bewaarde watermark, volgende run gaat verder | schaalt vanzelf als een delta te groot blijkt |

Vercel-plan is Pro, dus cron vaker dan dagelijks is beschikbaar.

Overwogen en afgevallen: een altijd-draaiende worker (Railway/Render/Azure) — extra platform en
kosten voor een probleem dat met kleine delta's niet bestaat. GitHub Actions voor de terugkerende
sync — geplande workflows lopen daar onvoorspelbaar achter en op een private repo tellen de minuten
tegen het quotum; prima voor de eenmalige backfill, minder voor twaalf runs per dag.

---

## Fase 0 — Toegang (extern, loopt parallel, heeft doorlooptijd)

Fabric SQL-endpoints accepteren geen SQL-logins, alleen Entra ID.

- [ ] 0a. Service principal (app registration) aanvragen met client secret
- [ ] 0b. Toegang tot workspace DPL-COL-DEV, minimaal Viewer op `lh_landing`
- [ ] 0c. Tenant-instelling "Service principals can use Fabric APIs" laten aanzetten
- [ ] 0d. Connectiestring ophalen (knop *Copy SQL connection string* onderaan de lakehouse-explorer)
- [ ] 0e. Verbinding testen vanaf lokaal met `mssql` + `azure-active-directory-service-principal-secret`
- [ ] 0f. **Uitgaand poort 1433 laten openzetten op het kantoornetwerk** naar
      `gxj6wkn4weouxoe35jxcon4hmi-l7hqrjfpqx4exjealdfohrh4he.datawarehouse.fabric.microsoft.com`

      Vastgesteld op 03-08-2026: op het kantoornetwerk komt de TCP-verbinding naar 1433 niet tot
      stand (`Test-NetConnection` → `TcpTestSucceeded: False`), terwijl 443 naar `app.powerbi.com`
      wél werkt. Uitgaand SQL-verkeer wordt dus geblokkeerd. Getest met en zonder sandbox, zelfde
      resultaat.

      Authenticatie is niet het probleem: een device code-login op het eigen Entra ID-account
      levert een geldig token op (`scripts/fabric-query.js`). Alleen de verbinding ontbreekt.

      **Waarom nodig:** zonder dit kan er lokaal niet tegen de bron ontwikkeld of getest worden en
      moet elke query handmatig via de webeditor worden gedraaid en geëxporteerd. Voor het bouwen
      en debuggen van de sync is dat onwerkbaar.

      **Waarom het de productie niet raakt:** de sync draait vanaf Vercel of GitHub Actions en die
      zitten niet achter dit netwerk. Dit is puur een blokkade voor lokale ontwikkeling.

      **Mobiele hotspot werkt ook niet** en is geen bruikbaar alternatief. Getest op 03-08-2026:
      - Zonder "maximaliseer compatibiliteit": IPv6/NAT64 (`64:ff9b::1432:34`), TDS loopt vast.
      - Mét die instelling: gewoon IPv4 (`20.50.0.70`), `Test-NetConnection` slaagt — maar tedious
        krijgt geen enkel prelogin-antwoord, ook niet met debug-logging aan en een timeout van
        drie minuten. Waarschijnlijk accepteert de provider het TCP-handshake en blokkeert daarna
        al het niet-HTTP verkeer.

      **Wel werkend gevonden op 03-08-2026**: een andere externe verbinding (niet het
      kantoornetwerk, niet de hotspot) laat TDS gewoon door. Daarmee is de hele reconciliatie
      gedraaid. `scripts/fabric-query.js` werkt, authenticatie is rond en het account wordt nu
      persistent bewaard, dus stille vernieuwing werkt. Op kantoor blijft 1433 dicht — dit item
      staat open voor de werkplek zelf.

## Fase 1 — Aannames verifiëren

- [ ] 1a. **Krijgt een gewijzigde rij een nieuwe `_ingestion_datetime`?** Doorslaggevend: zo ja
      volstaat een delta-watermark, zo nee is periodieke PK-reconciliatie verplicht.
      Meet een paar dagen de verdeling van recente timestamps op `kbtpro.verd`.
- [ ] 1b. Wie beheert de Dagster-kolomselectie, en ligt die vast? Als de subset zonder overleg kan
      krimpen is deze route fragiel.
- [x] 1c. **`parthdr.rel_id` is de leverancier, `part.rel_id` de kweker.** Gemeten over 885.000
      partijen: 59% verschillende relaties met `levok`/`kwekerok` zoals verwacht, 30% dezelfde
      relatie met beide vlaggen (kweker die zelf levert), 1,8% afwijkend.
- [ ] 1d. Retentie bevestigen: landing zone begint bij 2023, geen 2022. Voldoende voor de portal?
- [x] 1e. **Heeft de KBT-bron een rowversion of gewijzigd-op kolom?** → **Nee.** Gemeten op de
      volledige bronkatalogus (662 tabellen, 8.111 kolommen): nul kolommen van type `rowversion` of
      `timestamp`. Van de tien kerntabellen heeft er geen enkele een gewijzigd-op veld. Enige
      treffers: `art.mutatiedatumtijd` (stamdata) en `ordreg.uitconinpakkengewijzigdok` (boolean,
      vals-positief).
      **Gevolg:** `_ingestion_datetime` bestaat alleen op de landing zone. Bij de latere overstap
      naar de bron moet het delta-mechanisme terug naar een venster op businessdatum plus
      volledige sleutelvergelijking. Bouw de sync daarom met een verwisselbare delta-strategie, en
      bouw de sleutelreconciliatie meteen — die is op de bron hoe dan ook nodig. Zie
      `docs/kbt-datalandschap.md`, sectie "De bron heeft geen technische watermark".

## Fase 2 — Datamodel

Huidige model heeft `Lot 1—* Transaction` waarbij Transaction een orderregel probeert te zijn. Dat
klopt niet met de bron: `ordreg` heeft geen `part_id`.

```
OrderHeader (ordhdr)  1—*  OrderLine (ordreg)
                                  │
                            Allocation (verd)   ← verd_id als PK
                                  │
                                Lot (part)
```

Bedrag per partij wordt `allocation.aantalst × orderline.afrekenprijs`. Hele aantallen, stabiele
sleutel, geen fracties.

- [ ] 2a. Prisma-schema: `Allocation` model op `verd_id`
- [ ] 2b. `OrderLine` op `ordreg_id` (nu wél uniek), `OrderHeader` op `ordhdr_id`
- [ ] 2c. `Transaction` uitfaseren of hernoemen naar `Allocation`
- [ ] 2d. Lookup-modellen: `reden`, `redentype`, `kost`, `kosttype`, `art`, `agrp`, `veilkwal`
- [ ] 2e. `fabric*` velden hernoemen naar `kbt*` (semantisch onjuist geworden)
- [ ] 2f. Migratiepad voor bestaande data — IDs zijn dezelfde, dus koppelbaar

## Fase 3 — Sync bouwen

Staging eerst: rauwe KBT-tabellen één-op-één in Neon, daarna afleiden naar de domeinmodellen.
Zelfde patroon als de bestaande staging-tabellen, en het maakt reconciliatie mogelijk zonder
opnieuw te trekken.

- [ ] 3a. Staging-tabellen: `kbt_verd`, `kbt_part`, `kbt_parthdr`, `kbt_ordreg`, `kbt_ordhdr`,
      `kbt_partcor`, `kbt_shkost`, `kbt_zendhdr`, `kbt_partopslag`, `kbt_parthdrkost`
- [ ] 3b. Stamdata-sync (klein, volledig verversen): `rel`, `art`, `agrp`, `reden`, `redentype`,
      `kost`, `kosttype`, `fust`, `land`, `kleur`, `bdrf`, `valuta`, `keurmerk`, `mede`, `locatie`
- [ ] 3c. Connectielaag met service principal, herbruikbaar
- [ ] 3d. **Verwisselbare delta-strategie** — twee implementaties achter dezelfde interface:
      (1) landing zone: watermark op `_ingestion_datetime`;
      (2) bron later: venster op businessdatum (`part.tijd`, `parthdr.aanmaakdatum`,
      `verd.aanmaakdatumtijd`, `ordhdr.vdatum`). Zie 1e.
- [ ] 3e. Backfill als los script (eenmalig, mag lang duren) — apart van de terugkerende sync
- [ ] 3i. Vercel Cron-route voor de terugkerende sync, ~2-uurs interval
- [ ] 3j. Vangnet: bij te grote delta afbreken met bewaarde watermark, volgende run gaat verder
- [ ] 3f. PK-reconciliatie voor verwijderingen (goedkoop: alleen de sleutelkolom ophalen)
- [ ] 3g. Sync-run logging, in lijn met de bestaande `ImportBatch`
- [ ] 3h. Afleiding staging → domeinmodellen

### Zuinig queryen

Fabric rekent af op compute, en het datateam let op dataverbruik. Dat is geen reden om
noodzakelijke queries niet te draaien — informatie ophalen die je nodig hebt gaat voor. Maar het
is wel iets om bewust in te richten en te melden wanneer een query zwaar is.

Werkwijze die we aanhouden:

- **Eén keer breed ophalen, daarna lokaal analyseren.** `scripts/fabric-query.js --out data.json`
  en vervolgens in Node analyseren. Scheelt herhaalde scans en gaat sneller.
- **Volledige tabelscans alleen als het echt nodig is** en dan bewust. Een `GROUP BY` over
  `int_order_totaal` raakt 3,3 miljoen rijen.
- **Voor de sync (fase 3): delta op `_ingestion_datetime`**, niet elke run een volledige scan.
  De PK-reconciliatie voor verwijderingen haalt alleen de sleutelkolom op, geen volledige rijen.
- **Meld het als een query zwaar is**, zodat we het samen kunnen afwegen in plaats van dat het
  onopgemerkt oploopt.

## Portal-defecten gevonden bij de reconciliatie (03-08-2026)

Los van de migratie; direct repareerbaar. Onderbouwing in `docs/reconciliatie-pcfup-colbfl.md`.

- [ ] P1. **Productieomzet wordt niet geimporteerd.** Orderregels via `ordhdr.ordertype = 'MO'`
      ontbreken in de portal. Bij 100 van 234 gecontroleerde salessheets scheelt dat EUR 22.932 aan
      niet-getoonde omzet. De kweker ziet een lager netto resultaat dan op zijn eigen salessheet
      staat. Grootste bevinding van de reconciliatie.
- [ ] P2. **Acht salessheet-PDF's zijn aan de verkeerde levering gekoppeld.** De filename-parser
      matcht op een factuurnummer dat jaarlijks opnieuw wordt gebruikt, en pakt het verkeerde jaar.
      Op te lossen door bij het matchen ook de leverdatum uit de PDF te controleren; die staat er
      gelabeld op als `Deliverydate`. Koppelingen die wel op datum zijn geverifieerd (170 stuks)
      waren allemaal correct.
- [ ] P3. **`SalesSheet.invoiceDate` is de leverdatum.** In 48% van de gevallen valt de afrekening
      in een andere maand dan de levering; mediaan 13 dagen, bereik 4 tot 46. Raakt elke
      periodeberekening. Zie `kbt-datalandschap.md`.
- [ ] P4. **`invoiceNumber` en `ourInvoiceNumber` zijn semantisch omgedraaid.** `invoiceNumber`
      bevat het vlucht-/containernummer, `ourInvoiceNumber` het werkelijke factuurnummer.

## Fase 4 — Reconciliatie (go/no-go)

- [x] 4a. Uitgevoerd voor PCFUP en COLBFL: 336 salessheets, 234 met geverifieerde PDF
- [x] 4b. Verschillen verklaard: 50% klopt, 42,7% mist productieomzet, 7,3% resteert
- [x] 4c. Bron volgt de salessheet beter dan de portal (131 tegen 23). Op partijniveau komt 93,0% exact overeen.
- [ ] 4d. Uitbreiden naar alle leveranciers, laatste 12 maanden
- [ ] 4e. Bevindingen terugkoppelen aan het datateam

## Fase 5 — Cutover

- [ ] 5a. Beide pipelines parallel, dagelijkse vergelijking
- [ ] 5b. Portal-queries omzetten naar het nieuwe model (sales, dashboard, trends, lots, shipments)
- [ ] 5c. Power Automate-flows uitzetten
- [ ] 5d. Oude `/api/import/*` endpoints opruimen
- [ ] 5e. `CLAUDE.md` bijwerken: datamodel, importpipeline, terminologie

---

## Review

_(in te vullen na afronding)_
