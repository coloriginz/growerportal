# Power Automate rechtstreeks op de Warehouse — connectie en testqueries

> **Status:** T1 t/m T3 op 12 augustus 2026 in Power Automate uitgevoerd en geslaagd, op een
> Entra-integrated connectie. DLP blokkeert de actie niet. Nog te doen: service principal,
> volledige resultaatset zonder `TOP`, en de HTTP-actie naar de importendpoint.
> **Doel:** de kostenimport voeden vanuit `marts.fct_salesheets_costs` via de SQL Server-connector,
> in plaats van via een DAX-query op het semantisch model.
> **Aanleiding:** [reconciliatie-pcfup-colbfl.md](reconciliatie-pcfup-colbfl.md) — de kosten in de
> marts zijn al uitgerekend, en een SQL-venster is instelbaar waar het huidige importvenster dat niet is.

---

## 1. Connectieparameters

| veld | waarde |
|---|---|
| connector | SQL Server |
| actie | Execute a SQL query |
| server | `gxj6wkn4weouxoe35jxcon4hmi-l7hqrjfpqx4exjealdfohrh4he.datawarehouse.fabric.microsoft.com` |
| database | `wh_transform` |
| authenticatie | Microsoft Entra ID — service principal (headless) of Entra-integrated (eerste test) |
| gateway | niet nodig, dit is een cloud-endpoint |
| poort | 1433, impliciet; versleuteling verplicht |

Dit is hetzelfde endpoint dat `scripts/fabric-query.js` gebruikt. Dat het endpoint gewone T-SQL
accepteert is aangetoond: `scripts/recon-12-haal-fabric-kosten.js` haalde er 3.656 rijen uit
`marts.fct_salesheets_costs` op.

### Rechten voor de service principal

Naast een rol op de workspace heeft de principal leesrecht op het warehouse nodig. Voor het
datateam komt dat neer op iets in deze vorm — exacte formulering afstemmen, in Fabric lopen
rechten deels via workspace-rollen:

```sql
CREATE USER [naam-van-de-app-registration] FROM EXTERNAL PROVIDER;
GRANT SELECT ON SCHEMA::marts TO [naam-van-de-app-registration];
```

Alleen `marts` volstaat. `staging` en `intermediate` zijn niet nodig en kun je beter dicht laten.

---

## 2. Testladder

Vier stappen, oplopend. Stop bij de eerste die faalt — dan weet je waar het zit.

### T1 — mag de connector überhaupt draaien

```sql
SELECT SUSER_NAME() AS ingelogd_als, DB_NAME() AS database_naam, SYSDATETIME() AS servertijd;
```

Verwacht: één rij. `ingelogd_als` toont bij Entra-integrated jouw adres, bij een service principal
de object-id of de naam van de app registration — daarmee bevestig je meteen dat de juiste
identiteit gebruikt wordt.

Faalt dit met een beleidsmelding in plaats van een verbindingsfout, dan blokkeert DLP de actie
"Execute a SQL query". Zie §5.

### T2 — is de marts zichtbaar

```sql
SELECT COUNT(*) AS rijen_totaal,
       MIN(levering_datum) AS oudste_levering,
       MAX(levering_datum) AS nieuwste_levering
FROM   marts.fct_salesheets_costs;
```

Gemeten op 12 augustus 2026: **189.134 rijen**, van 2023-01-03 tot 2026-08-10. Krijg je nul rijen
of een permissiefout terwijl T1 slaagde, dan ontbreekt de `GRANT` uit §1.

### T3 — de payload voor `/api/import/costs`

Dit is de query die de huidige DAX-query vervangt. **Aliassen zijn niet meer nodig** — het endpoint
matcht kolomnamen los van hoofdletters, spaties en underscores, dus `shkost_id` komt vanzelf op
`Shkost ID` uit. Zie [§7](#7-kolomnamen-hoeven-niet-meer-te-matchen).

```sql
SELECT c.shkost_id,
       c.parthdr_id,
       c.kost_id,
       c.kost_naam,
       c.kost_type_code,
       c.kost_type_naam,
       c.totaal_omzet,
       c.totaal_verkoop_aantal,
       c.salesheet_amount,
       CONVERT(varchar(10), c.laatste_ontvangstdatum, 23) AS laatste_ontvangstdatum,
       CONVERT(varchar(10), c.laatste_aanmelddatum,  23) AS laatste_aanmelddatum
FROM   marts.fct_salesheets_costs AS c
WHERE  c.levering_datum >= DATEADD(day, -45, CAST(SYSDATETIME() AS date))
ORDER  BY c.shkost_id;
```

Gemeten op 12 augustus 2026: **3.983 rijen** over 45 dagen. Ter vergelijking: de huidige
DAX-variant levert er 2.156 per run.

`CONVERT(..., 23)` geeft `2026-06-28`; de endpoint parst dat met `new Date()`. Laat je de datums
als `date`-type staan, dan maakt de connector er een ISO-tijdstempel van — ook goed, maar dan
verschilt het formaat per connectorversie en dat wil je niet.

De bedragen komen met volle precisie binnen (`112.13175`); de endpoint rondt zelf af op twee
decimalen, dus daar hoef je niets aan te doen.

### T4 — gerichte backfill

Voor het repareren van historie, bijvoorbeeld de transactieheffing uit de reconciliatie. Zelfde
`SELECT` als T3, alleen een andere `WHERE`:

```sql
-- op periode
WHERE c.levering_datum BETWEEN '2025-01-01' AND '2025-12-31'

-- of op een expliciete lijst leveringen
WHERE c.parthdr_id IN (2352690, 2352321, 2364602)
```

Zet dit in een aparte, handmatig te starten flow. Niet in de reguliere sync: een backfill over een
heel jaar is grofweg 50.000 rijen en dat wil je niet elke vier uur door de keten duwen.

---

## 3. Wat je hiermee wint

1. **De kosten zijn al berekend.** `salesheet_amount` is het uitgerekende bedrag; de
   percentageregels uit `shkost` (`percok`, `grondslag_id`) hoeven niet gereproduceerd te worden.
2. **`stripBracketKeys()` is weg.** Vervangen door `normalizeImportKeys()`, dat beide vormen
   accepteert. Zie [§7](#7-kolomnamen-hoeven-niet-meer-te-matchen).
3. **Het venster is een parameter** in plaats van een eigenschap van de flow.

---

## 4. Wat het niet oplost

`fct_salesheets_costs` heeft geen kolom met het moment van laatste wijziging. Filteren kan alleen
op `levering_datum`. Een correctie die het datateam vandaag doorvoert op een levering van vorig
jaar valt dus nog steeds buiten elk lopend venster — precies het gat waardoor de herberekende
transactieheffing de portal niet bereikte.

Zolang die kolom er niet is, blijft periodieke backfill via T4 noodzakelijk. Een
`laatst_gewijzigd`-kolom op de marts-tabellen is het waard om bij het datateam neer te leggen; dat
zou incrementeel syncen pas echt sluitend maken.

---

## 5. Als DLP de actie blokkeert

"Execute a SQL query" staat bij Microsoft te boek als niet-aanbevolen vanwege injectierisico en is
in veel tenants door beleid uitgezet. Merk je dat, dan zijn er twee omwegen:

- **Een view of stored procedure in het warehouse.** De connector heeft ook een actie om een
  stored procedure uit te voeren, en die valt vaak buiten hetzelfde beleid. Bijkomend voordeel: de
  query staat dan in Fabric onder versiebeheer van het datateam in plaats van in een flow-veld.
- **Een Fabric Data Pipeline** die de Copy-activity naar onze import-endpoints doet, met Power
  Automate alleen als starter.

---

## 6. Stand van zaken

Beproefd op 12 augustus 2026 in Power Automate:

| | uitkomst |
|---|---|
| T1 verbinding | geslaagd, geen DLP-blokkade op "Execute a SQL query" |
| T2 leesrecht op `marts` | geslaagd, 189.134 rijen — gelijk aan wat het endpoint direct geeft |
| T3 payloadquery | geslaagd in de query-actie; de HTTP-push erna faalde, zie §7 |
| T3 volledige set | 3.983 rijen over 45 dagen, in één keer — geen afkapping of paginering |

De output staat onder `ResultSets.Table1`. Dat is de array voor de HTTP-actie:

```
{
  "costs": @{body('SQL')?['ResultSets']?['Table1']}
}
```

Kolomnamen benader je met bracket-notatie: `?['shkost_id']`.

> `body('...')` verwacht de naam van de actie als tekst, niet een dynamic-content-token. Spaties in
> de actienaam worden onderstrepingstekens, dus de standaardnaam "Execute a SQL query (V2)" wordt
> `Execute_a_SQL_query_(V2)`. Hernoem de actie naar `SQL` en dat probleem is weg.

Het aantal opgehaalde rijen controleer je met een Compose-actie:

```
length(body('SQL')?['ResultSets']?['Table1'])
```

---

## 7. Kolomnamen hoeven niet meer te matchen

> Toegevoegd 13 augustus 2026, na de eerste echte push vanuit SQL.

De eerste HTTP-actie naar `/api/import/costs` (12 augustus, 20:38) faalde met **11.949
validatiefouten** — precies drie verplichte velden maal 3.983 rijen. Elke rij miste `Shkost ID`,
`Parthdr ID` en `Salesheet Amount`: het endpoint was geschreven tegen DAX-output en kreeg de kale
SQL-kolommen binnen. De foutmelding herhaalde 11.949 keer `expected number, received undefined`
zonder één veldnaam te noemen, wat de diagnose onnodig lastig maakte.

Dat is opgelost in het endpoint in plaats van in de aanlevering, omdat we juist van DAX áf bewegen:
kolomnamen in DAX-vorm forceren zou die vorm bestendigen op het moment dat hij verdwijnt.

**Wat er nu geldt voor alle vijf de importendpoints:**

- `normalizeImportKeys()` brengt sleutels terug tot een vorm zonder hoofdletters, spaties,
  underscores en blokhaken. `[Shkost ID]`, `Shkost ID` en `shkost_id` komen alle drie op hetzelfde
  schemaveld uit. Schrijf je query dus zoals het je uitkomt.
- Velden die écht anders heten krijgen een alias in de route zelf. Voor de kosten is dat er één:
  `totaal_verkoop_aantal` → `Totaal Aantal`. Bij orders zijn het er drie (`vor_aantal`,
  `vor_colli`, `afrekenprijs_per_steel`), bij partijen één (`inkoopfust_volume`).
- Berekende kolommen hebben geen alias in de route nodig — die noem je in de query zoals het
  schemaveld heet. `SUM(vor_aantal * afrekenprijs_per_steel) AS afrekenomzet` komt op
  `Afrekenomzet` uit.
- Mislukt een import toch, dan noemt `ImportBatch.errorMessage` nu het ontbrekende veld bij naam,
  telt per veld in plaats van per rij, en laat zien welke sleutels de bron wél stuurde:

  ```json
  {
    "rowsReceived": 3983,
    "problems": [{ "field": "Shkost ID", "message": "...", "rows": 3983 }],
    "keysReceived": ["shkost_id", "parthdr_id", "..."],
    "keysMissing": ["Shkost ID", "Parthdr ID", "Salesheet Amount"]
  }
  ```

Voor `dim_leverancier` en `dim_kweker` staat de aliastabel nog leeg: die worden nog niet via SQL
bevraagd. Blijkt bij de eerste testrun een veld te missen, dan wijst bovenstaande melding het aan.

Zit in `develop` sinds 13 augustus 2026 (PR #6).

---

Nog openstaand:

- **Service principal.** De testconnectie draait op een persoonlijk Entra-account; die valt om bij
  een wachtwoordwijziging of vertrek. Dezelfde IT-aanvraag dekt de Vercel-variant uit
  [sso-entra.md](sso-entra.md) §1 — een tweede app registration, geen uitbreiding van de
  bestaande SSO-registratie.
- **HTTP-actie naar `/api/import/costs`**, eerst tegen de testomgeving.
