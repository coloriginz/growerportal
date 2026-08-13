# KBT-datalandschap — bron, lagen en grain

> Onderzoek uitgevoerd 27–28 juli 2026. Aanleiding: de grower portal draait op Fabric-output en
> loopt tegen dubbele orderregels aan. Vraag: kunnen we een laag dieper aansluiten, dichter op KBT?
>
> **Kernconclusie:** ja. De rijvermenigvuldiging is te herleiden tot de transformatielaag; de
> bronrijen in KBT zelf zijn uniek. Zie [Bewijs](#bewijs).
>
> **Belangrijke nuance:** de *totalen* in Power BI kloppen wel. De measures tellen correct terug
> naar de bronwaarden. Het probleem zit uitsluitend in de **grain** — wat één rij in de
> feitentabel voorstelt: één verdeelregel wordt
> 35–70 rijen met fractionele aantallen. Voor dashboards die sommeren is dat onzichtbaar; voor
> alles dat rijen consumeert (zoals de portal) of distinct telt, is het fataal.

---

## De keten

```
KBTPRO (MS SQL, bronserver LSN_DBCL01AG01.bssdomain.com)
  │   QlikView leest hier direct uit (Windows-auth, geen herbruikbare credentials)
  ▼
lh_landing.kbtpro            Lakehouse — Dagster staging
  │   72 tabellen, 10-25% van de bronkolommen, historie vanaf 2023
  ▼
wh_transform.intermediate    Warehouse — dbt intermediate (6 tabellen, 43 views)
  │   int_order_totaal: hier verandert de grain (zie Bewijs)
  ▼
wh_transform.marts           Warehouse — dbt marts (54 tabellen, 1 view)
  │   fct_orders, fct_partijen, dim_* — verd_id is hier niet aanwezig
  ▼
sm_kbt                       Semantic model, Direct Lake (51 tabellen, 1150 measures)
  │   documentatie: private_input/PBI/SM_KBT_REFERENCE.md
  ▼
DAX-queries → Power Automate → growerportal2 (/api/import/*)
```

Alles in Fabric-workspace **DPL-COL-DEV** (`a408cf5f-85af-4bf8-a480-58cae3c4fc39`), met vier items:
`lh_landing` (Lakehouse), `wh_transform` (Warehouse), `sm_kbt` en `sm_ffs` (Semantic models).

---

## Het structurele probleem: VERD

`ORDREG` heeft **geen** `part_id`. De koppeling partij ↔ orderregel loopt via **`VERD`** (verdeling),
een echte many-to-many:

```
verd: verd_id (PK) | part_id | ordreg_id | aantalst | inkwaarde | aanmaakdatumtijd | fust_id | inhoud
```

Gemeten op `lh_landing.kbtpro.verd` (3.331.168 rijen):

| | aantal |
|---|---|
| unieke `verd_id` | 3.331.168 — **echte PK** |
| unieke `(part_id, ordreg_id)` | 3.310.639 — 20.529 dubbel (0,6%) |
| unieke `ordreg_id` | 3.144.621 |
| unieke `part_id` | 876.263 |

Dus: `verd_id` is nodig als sleutel; `(ordreg_id, part_id)` is niet uniek. De samengestelde
constraint die de portal ooit had (`fabricOrdregId` + `lotId`) kón dus niet werken.

Maximaal ~5,9% van de orderregels wordt uit meer dan één partij gevuld.

Per jaar (retentie begint bij 2023):

| jaar | rijen | unieke ordreg | unieke part |
|---|---|---|---|
| 2023 | 1.012.124 | 961.125 | 254.004 |
| 2024 | 972.903 | 919.853 | 263.743 |
| 2025 | 919.242 | 866.419 | 249.017 |
| 2026 | 426.899 | 397.245 | 112.343 |

Voor de portal relevant (2024-2026): 2.319.044 rijen. Alleen 2025-2026: 1.346.141.

---

## Bewijs

### De fan-out zit in `int_order_totaal`

Voor één concrete combinatie (`ordreg_id=16444107`, `part_id=5593953`):

| laag | rijen | distinct `verd_id` |
|---|---|---|
| `lh_landing.kbtpro.verd` | 2 | — |
| `intermediate.int_order_totaal` | **70** | 2 |
| `intermediate.int_order_correctie` | 0 | 0 |
| `marts.fct_orders` | 70 | kolom niet aanwezig |

Twee verdeelregels worden 70 rijen. `marts` geeft die 70 alleen door en laat `verd_id` vallen.
De correctie-tak is hier niet bij betrokken (0 rijen), dus het is de hoofdstroom.

**Let op:** `verd_id` doorgeven aan `fct_orders` is nodig maar niet voldoende — binnen
`int_order_totaal` staan al 35 rijen per `verd_id`. De fan-out zelf moet opgelost worden.

### Twee reproduceerbare voorbeelden voor het datateam

Beide gevallen zijn door alle lagen heen gemeten. Draai deze query in `wh_transform` om ze te
reproduceren (cross-item naar de lakehouse werkt vanuit deze warehouse):

```sql
-- Casus A: ordreg_id = 16444107, part_id = 5593953
-- Casus B: ordreg_id = 14149196, part_id = 4879469
SELECT '1 verd' AS laag, COUNT(*) AS rijen, COUNT(DISTINCT verd_id) AS distinct_verd,
       SUM(CAST(aantalst AS float)) AS som_aantal
FROM   lh_landing.kbtpro.verd            WHERE ordreg_id = 16444107 AND part_id = 5593953
UNION ALL
SELECT '2 int_order_totaal', COUNT(*), COUNT(DISTINCT verd_id), NULL
FROM   intermediate.int_order_totaal     WHERE ordreg_id = 16444107 AND part_id = 5593953
UNION ALL
SELECT '3 fct_orders', COUNT(*), NULL, SUM(CAST(vor_aantal AS float))
FROM   marts.fct_orders                  WHERE ordreg_id = 16444107 AND part_id = 5593953
ORDER BY laag;
```

Resultaat (gemeten 28-07-2026):

| casus | laag | rijen | distinct `verd_id` | som aantal |
|---|---|---|---|---|
| **A** `ordreg 16444107` / `part 5593953` | `lh_landing.kbtpro.verd` | 2 | 2 | 170 |
| | `intermediate.int_order_totaal` | **70** | 2 | — |
| | `marts.fct_orders` | 70 | kolom weg | 170,000009 |
| **B** `ordreg 14149196` / `part 4879469` | `lh_landing.kbtpro.verd` | 1 | 1 | 3840 |
| | `intermediate.int_order_totaal` | **64** | 1 | — |
| | `marts.fct_orders` | 64 | kolom weg | 3839,999989 |

Wat hieruit af te lezen valt:

1. **De vermenigvuldiging ontstaat in `int_order_totaal`**, niet in `marts`. Casus B is het
   zuiverste bewijs: één bronrij, één `verd_id`, 64 rijen eruit.
2. **De factor is data-afhankelijk** (35× in A, 64× in B), dus het is een join op een tabel met
   variabel aantal rijen per verdeelregel — geen vaste cross join.
3. **De som blijft kloppen**, op afrondingsdrift na (170,000009 en 3839,999989). Het aantal wordt
   dus gedeeld over de rijen, niet gedupliceerd. Dat verklaart waarom dit nooit is opgevallen:
   elke gesommeerde measure in Power BI geeft het juiste antwoord.
4. **Die drift is wel reëel.** ~1e-5 per combinatie over miljoenen rijen stapelt op, en de
   fractionele waarden dwongen de portal al tot `Transaction.amount` met 3 decimalen.

Meer gevallen om op te zoeken (rijen in `fct_orders` versus in `verd`):

| ordreg_id | part_id | `fct_orders` | `verd` |
|---|---|---|---|
| 16444107 | 5593953 | 70 | 2 |
| 14149196 | 4879469 | 64 | 1 |
| 14901351 | 5104044 | 63 | 1 |
| 14721748 | 5030734 | 63 | 1 |
| 16986489 | 5832976 | 60 | 1 |
| 14817319 | 5075003 | 58 | 1 |

Zelf de ergste gevallen opsporen:

```sql
SELECT TOP 20 ordreg_id, part_id, COUNT(*) AS rijen
FROM   marts.fct_orders
WHERE  ordreg_id IS NOT NULL AND part_id IS NOT NULL AND bronfeit_extra = 'origineel'
GROUP BY ordreg_id, part_id
ORDER BY COUNT(*) DESC;
```

### De duplicaten zijn niet te onderscheiden

Alle 36 kolommen van `fct_orders` getoetst op casus B (64 rijen). **Alleen de 10 measure-kolommen
variëren; alle 26 dimensie- en ID-kolommen zijn constant.** Elke measure heeft exact 9 verschillende
waarden over 64 rijen.

Ook in `intermediate.int_order_totaal` — dat méér kolommen heeft dan `fct_orders` — is er niets
onderscheidends. Getoetst en allemaal op 1 distinct: `consreg_id`, `verd_id`, `som_fraction`,
`algemeen_fraction`, `korting_fraction`, `barcode`, `partijnummer`, `verkooplijst`, `transport`,
`commhandel`, `inkoopfactuurnr`, `productie_input_aantal`, `locatie_id`, `afleveradres_id`,
`verwerk_id_levering`, `verwerk_id_productie`. Alleen `vor_aantal` varieert.

Er is dus **geen enkele kolom, in geen enkele laag, waarmee de portal deze rijen kan sleutelen of
dedupliceren.** Delete-en-opnieuw-invoegen was de enige mogelijkheid.

### De verdeling is regelmatig — 193 eenheden over 64 rijen

Casus B uitgesplitst naar unieke measurewaarden:

| vor_aantal | vor_colli | vor_omzet | aantal rijen | veelvoud |
|---|---|---|---|---|
| 19,896373 | 0,248704 | 12,932642 | 22 | ×1 |
| 39,792746 | 0,497409 | 25,865285 | 11 | ×2 |
| 59,689119 | 0,746113 | 38,797927 | 6 | ×3 |
| 79,585492 | 0,994818 | 51,73057 | 13 | ×4 |
| 99,481865 | 1,243523 | 64,663212 | 2 | ×5 |
| 119,378238 | 1,492227 | 77,595855 | 5 | ×6 |
| 139,274611 | 1,740932 | 90,528497 | 2 | ×7 |
| 159,170984 | 1,989637 | 103,46114 | 2 | ×8 |
| 179,067357 | 2,238341 | 116,393782 | 1 | ×9 |

Alle waarden zijn exacte veelvouden van 19,896373. En **3840 ÷ 19,896373 = precies 193**. De
veelvouden gewogen naar rijaantal sommeren ook op 193 (22×1 + 11×2 + 6×3 + 13×4 + 2×5 + 5×6 + 2×7 +
2×8 + 1×9 = 193).

De orderregel van 3840 stelen wordt dus verdeeld in 193 eenheden, uitgesmeerd over 64 rijen die
elk 1 tot 9 eenheden krijgen. Dat is een regelmatige allocatie, geen willekeurige duplicatie — er
zit een mechanisme achter. Maar het kenmerk waarover verdeeld wordt, staat in geen enkele kolom.

**Waar de 64 niet vandaan komt:** de partij heeft in de bron maar **één** verdeelregel
(`SELECT COUNT(*) FROM lh_landing.kbtpro.verd WHERE part_id = 4879469` → 1). De fan-out ontstaat
dus door een join met een andere tabel die 64 matchende rijen heeft, niet door een explosie op
partijniveau. Welke tabel dat is, is zonder de dbt-modelcode niet vast te stellen.

De fractionele waarden verklaren commit `fix: increase Transaction.amount precision to 3 decimals`.

### De 64 rijen zitten ook in Power BI

Geverifieerd met een DAX-query op `sm_kbt`:

```dax
EVALUATE ROW(
  "rijen",      CALCULATE(COUNTROWS(Fact_Orders),          Fact_Orders[ordreg_id]=14149196, Fact_Orders[part_id]=4879469),
  "som_aantal", CALCULATE(SUM(Fact_Orders[#VOR_Aantal]),   Fact_Orders[ordreg_id]=14149196, Fact_Orders[part_id]=4879469)
)
```

Resultaat: **64 rijen, som 3840.** Het semantisch model neemt de fan-out dus onverkort over
(Direct Lake, geen aggregatie bij inladen), maar de measure telt correct terug naar de bronwaarde.

### Duplicatie in cijfers

`marts.fct_orders` (3.612.211 rijen), NULLs uitgesloten:

| scope | dubbele combinaties | extra rijen | max per combinatie |
|---|---|---|---|
| alle bronfeiten | 71.061 | 219.766 | 70 |
| alleen `origineel` | 50.386 | 167.230 | 70 |

**Filteren op `bronfeit_extra` lost het niet op** — 76% van de duplicatie zit binnen `origineel`.

### `bronfeit_extra` stapelt wel degelijk

`bronfeit` heeft één waarde (`orders`), maar `bronfeit_extra` niet:

| bronfeit_extra | rijen | bijzonderheid |
|---|---|---|
| origineel | 3.468.943 | |
| prullenbak-partcor | 87.578 | **alle rijen `ordreg_id IS NULL`** |
| correcties | 43.231 | |
| prullenbak-factcor | 12.459 | |

---

## Wat de landing zone wél en niet heeft

Kolommen bron → mirror:

| tabel | bron | mirror (excl. 4 metakolommen) |
|---|---|---|
| `part` | 130 | 30 |
| `ordreg` | 129 | 28 |
| `ordhdr` | 62 | 14 |
| `parthdr` | 59 | 13 |
| `verd` | 35 | 13 |
| `partcor` | 29 | 11 |
| `parthdrkost` | 26 | 7 |
| `shkost` | 12 | 9 |
| `partopslag` | 10 | 4 |
| `part_data` | 33 | 2 |
| `parttrans` | 18 | **niet gespiegeld** |

**Dit is geen blocker voor de huidige featureset.** Eerder gedachte gaten bleken onterecht:

- Steellengte komt uit **S01**, niet uit `part.lengte` (zie `src/app/api/import/lots/route.ts:319`).
  `s01`–`s06` zitten in de mirror.
- Productnaam komt uit `art` via `art_id`, niet uit `part.oms`.
- Salessheet-totalen worden door de portal zelf berekend, niet uit `parthdr.factuurbedrag`.
- `parttrans` wordt vandaag niet gebruikt.

Alle stamtabellen zijn aanwezig: `rel`, `rel_data`, `art`, `agrp`, `reden`, `redentype`, `kost`,
`kosttype`, `fust`, `fusttype`, `land`, `kleur`, `bdrf`, `valuta`, `keurmerk`, `veilkwal`, `mede`,
`locatie`.

Elke tabel heeft `_ingestion_datetime`, `_dagster_run_id`, `_batch_number`, `_partition_key`.
**`_ingestion_datetime` is een bruikbare technische watermark** — beter dan de businessdatums waar
QlikView op moest leunen.

`kbtpro._info_schema_columns` bevat de **volledige bronkatalogus** van KBTPRO (alle tabellen en
kolommen, ook niet-gespiegelde). Bruikbaar om precies te specificeren wat IT moet toevoegen.

### De bron heeft geen technische watermark

Gemeten op de volledige bronkatalogus (662 tabellen, 8.111 kolommen):

| zoekterm | kolommen | tabellen |
|---|---|---|
| type `rowversion` / `timestamp` | **0** | 0 |
| naam bevat `mutatie` | 35 | 30 |
| naam bevat `wijzig` | 17 | 11 |
| naam bevat `laatst` | 10 | 6 |
| naam bevat `modified` / `updated` | 6 | 5 |

Van de tien kerntabellen (`part`, `parthdr`, `verd`, `ordhdr`, `ordreg`, `partcor`, `shkost`,
`zendhdr`, `rel`, `art`) heeft er **geen enkele** een gewijzigd-op tijdstempel. Twee treffers, beide
onbruikbaar als watermark: `art.mutatiedatumtijd` (artikelstamdata, wel een echte timestamp) en
`ordreg.uitconinpakkengewijzigdok` (een boolean-vlag, vals-positief).

**Gevolg voor de architectuur:** op `lh_landing` is `_ingestion_datetime` een bruikbare watermark,
maar die kolom is door de Dagster-pipeline toegevoegd en bestaat niet in de bron. Gaat de portal
later rechtstreeks op KBT draaien, dan moet het delta-mechanisme terug naar wat QlikView deed: een
venster op businessdatum (`part.tijd`, `parthdr.aanmaakdatum`, `verd.aanmaakdatumtijd`,
`ordhdr.vdatum`) plus periodieke volledige sleutelvergelijking om wijzigingen buiten het venster en
verwijderingen te vangen.

Bouw de sync daarom met een **verwisselbare delta-strategie**. Het domeinmodel blijft gelijk; alleen
de manier waarop je bepaalt wat er veranderd is, verschilt per bron. Bouw de sleutelreconciliatie
sowieso meteen — die heb je op de bron hoe dan ook nodig.

---

## Aandachtspunt: `S01` is niet altijd de steellengte

De portal leidt `Lot.stemLength` af uit `part.s01` (`src/app/api/import/lots/route.ts:319`). Die
aanname is niet universeel waar.

`agrp.sortkmerk1_id` t/m `sortkmerk6_id` bepalen per artikelgroep wat `s01` t/m `s06` betekenen.
Ze verwijzen naar de lookup `sortkmerk`, waarin `sortkmerk_id = 11` staat voor `S20 — Lengte`.

Gemeten op 03-08-2026 over alle 886.403 partijen in de landing zone:

| betekenis van `s01` | partijen |
|---|---|
| **Lengte** | 882.727 (99,59%) |
| Onbekend | 1.361 |
| Materiaaldiameter | 1.296 |
| Gemiddelde bloemdiameter | 446 |
| Materiaalhoogte | 384 |
| Hoogte | 167 |
| Aantal stuks per fust | 20 |
| Diameter | 2 |

De 25 betrokken artikelgroepen zijn kerstbomen, mossen, kransen, geconserveerde rozen, bloembollen
en taxus — geen snijbloemen. Bij vier daarvan (`KRANS`, `KRANSDEC`, `ROPRE1`) staat de lengte
wél in `s02`; bij de rest bestaat er geen lengte en is elke waarde in dat veld misleidend.

**Raakt de portal vandaag niet.** De 3.676 geraakte partijen horen bij 50 relaties, allemaal Green
Connect en interne entiteiten. Gekruist tegen de 56 leveranciers in de portal: geen enkele overlap
(`scripts/check-s01-impact-portal.js`).

**Wel relevant zodra er een leverancier bijkomt** met droogbloemen, mos, kransen of soortgelijke
producten. Het faalt dan stil: de portal toont een diameter met "cm" erachter zonder foutmelding.

De robuuste oplossing is bij het importeren de artikelgroep raadplegen en het S-veld pakken dat
naar Lengte wijst, en `stemLength` leeg laten als er geen enkel veld naar Lengte wijst. Daarvoor
zijn `agrp.sortkmerk1_id` t/m `6_id` en de `sortkmerk`-tabel nodig; die staan om die reden op de
extractielijst.

## Aandachtspunt: `SalesSheet.invoiceDate` is de leverdatum, niet de afrekendatum

De portal zet `invoiceDate` bij aanmaak gelijk aan `deliveryDate` (`src/app/api/import/lots/route.ts:217`)
en werkt hem daarna nooit meer bij. Er is dus geen echte factuurdatum in de portal.

Geverifieerd op 03-08-2026 door salessheet-PDF's uit `private_input/salessheets/COL` naast de bron
te leggen. Elke PDF bevat twee datums; de eerste is exact `parthdr.levdatum`, de tweede is de datum
waarop de salessheet is opgemaakt:

| `parthdr_id` | `factnum` | `levdatum` | datum 1 op PDF | datum 2 op PDF | verschil |
|---|---|---|---|---|---|
| 2240545 | `094-23` | 2025-01-02 | 02-01-2025 | 15-01-2025 | 13 dagen |
| 2280402 | `9512` | 2025-05-18 | 18-05-2025 | 26-05-2025 | 8 dagen |
| 2364305 | `101881` | 2025-11-05 | 05-11-2025 | 18-12-2025 | 43 dagen |
| 2409092 | `102145` | 2026-02-05 | 05-02-2026 | 13-02-2026 | 8 dagen |

**Gevolg:** de netto-opbrengst per periode valt in de verkeerde maand wanneer levering en
afrekening in verschillende maanden liggen. Bij salessheet 392513 is dat 43 dagen.

De PDF labelt beide datums expliciet: `Deliverydate` en `Invoice date`, in het kopblok rechtsboven
op pagina 1. Het is dus geen interpretatie — Coloriginz drukt het onderscheid zelf af op de
salessheet die de kweker ontvangt.

Gemeten over 250 PDF's, gelijkmatig verspreid over het hele archief:

| verschil lever- en factuurdatum | aantal | aandeel |
|---|---|---|
| 0 dagen | **0** | 0,0% |
| 1–7 dagen | 25 | 10,0% |
| 8–14 dagen | 117 | 46,8% |
| 15–30 dagen | 91 | 36,4% |
| 31–60 dagen | 17 | 6,8% |

Nul van de 250 vallen samen; mediaan 13 dagen, bereik 4 tot 46. **In 48% van de gevallen valt de
afrekening in een andere maand dan de levering.** Dat raakt elke maand-, kwartaal- en
seizoensberekening in de portal. Meetscript: `scripts/meet-salessheet-datumverschil.js`.

### `parthdr.factnum` is niet het factuurnummer

Het kopblok van de PDF ziet er zo uit:

```
Invoice number             370828
Flight number/container    094-23
Invoice date               15-1-25 22:03
Deliverydate               02-01-2025
```

`parthdr.factnum` bevat **`094-23`** — het vlucht-/containernummer, niet het factuurnummer.
De PDF-bestandsnaam is `<factnum>-<salessheetnummer>.pdf`. Het echte factuurnummer (370828) zit
niet in `parthdr`.

De portal heeft deze twee bovendien semantisch omgedraaid: `SalesSheet.invoiceNumber` bevat het
containernummer, `SalesSheet.ourInvoiceNumber` het werkelijke factuurnummer.

### De `ssh_`-tabellen: een ongebruikte afrekenmodellering

De bron bevat zes tabellen die specifiek over salessheet-afrekeningen gaan — `ssh_afrekening`,
`ssh_afrekening_balans`, `ssh_afrekening_kosten`, `ssh_afrekening_opbrengsten`,
`ssh_partijverantwoording` en `ssh_voorafrekening`. `parthdr.ssh_afrekening_id` koppelt eraan.

**Geen daarvan is naar de landing zone gespiegeld**, en het semantisch model gebruikt ze evenmin.
De portal berekent omzet, kosten en netto resultaat nu zelf uit `part` en `shkost`, terwijl
`ssh_afrekening_balans` (inkoop, kosten, opbrengst, balans) en `ssh_afrekening_opbrengsten`
(stelen en bedrag per artikel) die uitkomsten kennelijk al vastleggen — vermoedelijk precies zoals
ze op de PDF worden afgedrukt.

Niet toetsbaar zolang ze niet gespiegeld zijn. Staat als vraag 1 in `kbt-extractie-verzoek.md`.

#### Hoe we ze gevonden hebben

Twee onafhankelijke sporen. Beide zijn na te lopen, wat de vondst controleerbaar maakt.

**1. De bronkatalogus binnen de landing zone.** In `lh_landing`, schema `kbtpro`, staat de tabel
`_info_schema_columns`. Dat is geen datatabel maar de volledige kolomkatalogus van de
KBTPRO-bronserver — 8.111 kolommen over 662 tabellen, dus inclusief alles wat níét gespiegeld is.
Via de gewone `INFORMATION_SCHEMA` zie je alleen de 72 gespiegelde tabellen; hierlangs zie je de
hele bron.

```sql
-- draaien tegen lh_landing
SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
FROM   kbtpro._info_schema_columns
WHERE  LOWER(COLUMN_NAME) LIKE '%ssh%'
    OR LOWER(TABLE_NAME)  LIKE '%ssh%'
    OR LOWER(TABLE_NAME)  LIKE '%salessheet%'
    OR LOWER(TABLE_NAME)  LIKE '%afreken%'
ORDER BY TABLE_NAME, COLUMN_NAME;
```

Er is op vier termen tegelijk gezocht omdat de naamgeving vooraf onbekend was; `afreken` was de
treffer.

Valkuil: `_info_schema_columns` kan niet gejoind worden met `INFORMATION_SCHEMA` — dat geeft
*"The query references an object that is not supported in distributed processing mode"*.
Vergelijken tussen bron en mirror moet daarom in twee losse stappen.

**2. De QlikView-reloadlogs.** In `private_input/kbtpro-extract-queries.md` staat de kolomlijst die
QlikView terugkreeg voor `PARTHDR`. Daarin staan `ssh_afrekening_id` en `ssh_voorafrekening_id`
gewoon vermeld. Die aanwijzing lag er dus al vóór er databasetoegang was, maar is over het hoofd
gezien omdat er destijds op datumvelden werd gezocht in plaats van op koppelingen.

## Route

**Gekozen richting: de portal voeden vanuit `lh_landing.kbtpro`**, met directe brontoegang als
eindbeeld.

Waarom:
- De grain-wijziging ontstaat in `intermediate`; één laag lager speelt die niet.
- `verd_id` geeft een stabiele sleutel en hele aantallen in plaats van fracties.
- De tabelstructuur is identiek aan de bron, dus de latere overstap naar directe brontoegang is
  een connectiewijziging, geen modelwijziging. **Wel** moet het delta-mechanisme dan veranderen:
  zie hieronder.
- Kan vandaag — toegang is er al.

Alternatieven en waarom niet:
- *Wachten op bronservertoegang* — nu nog geblokkeerd, en je bouwt de transformatielaag opnieuw
  op terwijl die er al staat.
- *`wh_transform` aanpassen* — kan een goede oplossing zijn, maar de portal heeft dan een andere
  grain nodig dan wat het semantisch model en de rapportage vragen. Dat is een gesprek met het
  datateam, geen aanname vooraf. De bevinding is sowieso het delen waard: het is de vraag of deze
  rijvermenigvuldiging ook voor Power BI bedoeld is.

Deze routekeuze betekent dat de portal langs `wh_transform` heen gaat lezen. Dat is geen oordeel
over die laag — de rapportagecijfers kloppen — maar een gevolg van het feit dat de portal rijen
consumeert waar Power BI aggregeert. Twee verschillende behoeften aan dezelfde data.

### Openstaand

- Wat veroorzaakt de fan-out in `int_order_totaal`? Base table, dus geen view-definitie leesbaar;
  de dbt-modelcode zit in een repo waar we geen zicht op hebben. Wat we wél weten en wat het
  zoekgebied afbakent:
  - De factor is **data-afhankelijk** (35× en 64× gemeten), dus geen vaste cross join.
  - Het is **niet** een explosie op partijniveau — de partij heeft één verdeelregel in de bron.
  - Het is een join met een tabel die per verdeelregel een variabel aantal rijen heeft, waarbij
    het aantal in gelijke eenheden over de matches wordt verdeeld (193 eenheden over 64 rijen).
  - Geen enkele kolom van de joinpartner is meegenomen, ook niet in `int_order_totaal`.
  - Kandidaten op fijnere grain: `int_partijopslagen_verkoop`, `int_salesheetkosten_*`.

  **Hypothese: een restant uit de QlikView-logica.** De namen in de dbt-laag corresponderen
  één-op-één met de oude QlikView-transform: `int_productieverdeelregels` ↔
  `KBT_ProductieVerdeelregels`, `int_productieverdelingen_totaal` ↔
  `KBT_ProductieVerdeelregels2`. In de QlikView-transform wordt op dat tweede model **vier keer
  achter elkaar een `LEFT JOIN`** uitgevoerd (regels 1105, 1116, 1132, 1145 in
  `KBTPRO Transform.qvw.log`). QlikView's `LEFT JOIN` is een tabel-merge, geen SQL-join, en
  meerdere merges op dezelfde tabel kunnen rijen vermenigvuldigen — met precies het effect dat we
  hier meten. Als de dbt-modellen een vertaling van die logica zijn, is dat een logische plek om
  te beginnen zoeken.

  Niet bewezen: de naamcorrespondentie en het joinpatroon zijn suggestief, maar we hebben de
  dbt-code niet gezien. Wel concreet genoeg om na te lopen.
- Ligt de Dagster-kolomselectie ergens vast, en wie beheert die? Als de subset zonder overleg kan
  krimpen is deze route fragiel.
- Is `parthdr.rel_id` de leverancier en `part.rel_id` de kweker? Nog niet geverifieerd; bepaalt de
  scoping van elke query.

---

## Praktisch: queryen op deze omgeving

De Fabric SQL-endpoints zijn te benaderen via de webeditor in de workspace. Aandachtspunten die
tijd besparen:

- **Naamgeving:** `kbtpro` is een *schema*, geen database. Dus `kbtpro.part`, niet `kbtpro.dbo.PART`.
- **`WITH (NOLOCK)` bestaat niet** in Fabric Warehouse — weglaten.
- **Cross-item queries werken:** vanuit `wh_transform` kun je `lh_landing.kbtpro.verd` bevragen.
  Ideaal om bron en gold layer in één query te vergelijken.
- **Maar:** een mirror-tabel joinen met `INFORMATION_SCHEMA` geeft
  `The query references an object that is not supported in distributed processing mode`.
  Vergelijken moet dan in twee stappen.
- **Het resultatengrid is canvas-based**, dus niet als tekst uit te lezen. Voor lange lijsten:
  `STRING_AGG` met een `ROW_NUMBER()/n`-groepering, dan passen ze in een paar zichtbare rijen.
- **`CONCAT` behandelt NULL als lege string.** Bij `COUNT(DISTINCT CONCAT(a,'|',b))` klappen
  NULL-rijen samen en overdrijf je de duplicatietelling. Filter expliciet op `IS NOT NULL`.

---

## Herkomst van de reverse-engineering

De QlikView-omgeving (`private_input/Kopie QVD files/`) bevatte geen QVD-databestanden, maar wel de
reload-logs met het volledige uitgevoerde script. Daaruit zijn 72 SQL-queries met alle bronkolommen
geëxtraheerd naar `private_input/kbtpro-extract-queries.md`. De bronkolomaantallen daaruit komen
exact overeen met `kbtpro._info_schema_columns`, wat beide bronnen valideert.

De QlikView-connectiestring gebruikt `Integrated Security=SSPI` — Windows-authenticatie, dus daar
zijn geen credentials uit te halen voor eigen brontoegang.
