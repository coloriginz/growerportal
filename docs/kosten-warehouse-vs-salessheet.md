# Kosten in het warehouse tegenover de salessheet

> **Aan:** datateam
> **Datum:** 13 augustus 2026
> **Bron:** `wh_transform`, `marts.fct_salesheets_costs` en `marts.fct_orders`, stand 12–13 augustus 2026
> **Scope:** 234 salessheets van twee leveranciers — PCFUP (`rel_id` 11467) en COLBFL (`rel_id` 11463),
> allemaal met een op leverdatum geverifieerde salessheet-PDF.
> **Vraag:** twee punten, samengevat in [§6](#6-wat-we-vragen).

---

## 1. Waar het over gaat

De grower portal toont kwekers hun afrekening: omzet, kosten, netto resultaat. Die kosten komen uit
`marts.fct_salesheets_costs`. Daarnaast krijgt de kweker een salessheet-PDF — het document dat
leidend is, want dat is wat hij daadwerkelijk in handen heeft en waarop hij wordt uitbetaald.

Over 234 salessheets liggen de kosten in het warehouse **€ 689,65 hoger** dan wat er op diezelfde
salessheets staat. Dit document laat zien waar dat verschil zit.

Twee dingen vooraf, zodat helder is wat níet ter discussie staat:

- **De percentages kloppen.** Zie [§5](#5-wat-er-niet-aan-de-hand-is).
- **Dit is niet het importprobleem van de portal.** Wij lopen op sommige leveringen achter met
  synchroniseren; dat is ons eigen probleem en staat los hiervan. Dit document gaat uitsluitend over
  het verschil tussen het warehouse en de salessheet-PDF.

---

## 2. Het verschil per kostensoort

Alle kostensoorten uit `fct_salesheets_costs` zijn gekoppeld aan de corresponderende regel op de
salessheet-PDF (Nederlandse naam tegenover Engelse), en het verschil is per soort opgeteld:

| kostensoort | `kost_id` | Fabric − PDF | salessheets met meer dan € 0,50 verschil |
|---|---|---|---|
| **Transactie heffing** | 156 | **+ 474,86** | **111 van 223** |
| **Commissie directe verkoop** | 17 | **+ 202,19** | **22 van 233** |
| Finance en debiteuren verzekering | 166 | + 16,35 | 8 van 234 |
| Service charge + BBH levy | 14 | + 5,81 | 4 van 234 |
| alle overige circa twintig soorten samen | | − 12,56 | **0** |
| **totaal** | | **+ 689,65** | |

Twee posten zijn samen goed voor 98% van het verschil. Verwerkingskosten, veilingprovisie,
distributiekosten, karheffing, partijheffing, fusthuur, inklaring en alle overige soorten wijken in
**geen enkele** salessheet meer dan vijftig cent af — dat is zuiver afronding, omdat de PDF per regel
op twee decimalen afrondt en `salesheet_amount` volledige precisie voert.

---

## 3. Bevinding 1 — de transactieheffing telt meer eenheden

De transactieheffing is geen percentage maar een tarief: **€ 1,12 per eenheid**. Elk bedrag op de
salessheets is een exact veelvoud daarvan.

Alle 111 afwijkingen zijn dat óók — zonder één uitzondering. Het verschil is dus altijd een heel
aantal eenheden, nooit een afrondings- of berekeningsrestje:

| `parthdr_id` | PDF | Fabric | verschil | eenheden |
|---|---|---|---|---|
| 2318405 | 165,76 | 188,16 | + 22,40 | + 20 |
| 2330600 | 86,24 | 107,52 | + 21,28 | + 19 |
| 2423657 | 212,80 | 230,72 | + 17,92 | + 16 |
| 2353613 | 30,24 | 43,68 | + 13,44 | + 12 |
| 2352898 | 98,56 | 112,00 | + 13,44 | + 12 |

In 110 gevallen telt het warehouse méér eenheden dan de salessheet, in één geval minder. Het raakt
ongeveer de helft van alle onderzochte salessheets, verspreid over de hele periode.

**Onze lezing:** de transactieheffing is na het opmaken van de afrekening herberekend op een groter
aantal eenheden. Wat wij niet kunnen zien, is of dat een correctie is die terecht is doorgevoerd
(dan klopt het warehouse en zijn de verstuurde salessheets te laag) of dat er eenheden worden
meegeteld die niet bij deze levering horen.

---

## 4. Bevinding 2 — de kostengrondslag slaat correcties over

De commissies worden berekend over `totaal_omzet` uit `fct_salesheets_costs`. Die kolom telt de
orderregels met `bronfeit_extra = 'correcties'` **niet** mee; de salessheet doet dat wel.

### De casus: COLBFL, salessheet "C031 KLM", `parthdr_id` 2280043

Het hele verschil op deze salessheet komt van **één orderregel**: `ordreg_id` 15703756, `part_id`
5362444, lot 3666658 (Protea Robijn), 19-05-2025, `reden_id` 93 — *Retour: Terugkoop van klant*.
In `fct_orders` staat die als twee rijen met dezelfde `afrekenprijs_per_steel` van € 0,654:

| | `vor_aantal` | × prijs | bedrag | `bronfeit_extra` |
|---|---|---|---|---|
| verkooppoot | + 1.710 | 0,654 | + 1.118,34 | `correcties` |
| terugkooppoot | − 2.610 | 0,654 | − 1.706,94 | `correcties` |
| **netto** | **− 900** | | **− 588,60** | |

Beide rijen vallen buiten `totaal_omzet`. Daardoor:

| | grondslag directe omzet |
|---|---|
| `totaal_omzet` in het warehouse | 6.382,17 |
| directe omzet op de salessheet | 5.793,57 |
| verschil | **588,60** — exact de netto correctie |

Dat werkt door in drie kostensoorten:

| kostensoort | percentage | PDF | Fabric | verschil |
|---|---|---|---|---|
| Commissie directe verkoop | 10% | 579,36 | 638,21 | + 58,85 |
| Finance en debiteuren verzekering | 0,85% | 49,25 | 54,24 | + 4,99 |
| Service charge + BBH levy | 0,322% | 34,60 | 36,49 | + 1,89 |
| overige dertien regels | | | | − 0,07 |
| **totaal** | | **2.992,27** | **3.057,93** | **+ 65,66** |

De transactieheffing blijft op deze salessheet gelijk (€ 98,56 in beide) — die hangt immers aan een
aantal, niet aan de omzet.

Op de salessheet zelf is deze terugkoop wel zichtbaar, maar zonder bedrag: onder lot 3666658 staan
twee regels met prijs 0,000 en bedrag € 0,00 (*retour: repurchased from customer* 900 stelen en
*Return: customer rejection* −880 stelen). Het bedrag is verwerkt in de netto directe omzet.

### Het gedrag is niet consistent

Van de 234 salessheets hebben er 30 orderregels met `bronfeit_extra = 'correcties'`. Die vallen
uiteen in twee groepen:

| | salessheets | `totaal_omzet` | salessheet-PDF |
|---|---|---|---|
| correctie valt buiten de grondslag, PDF telt hem wel mee | **18** | bruto | netto |
| correctie telt in beide niet mee | 12 | bruto | bruto |

Alleen de eerste groep geeft een kostenverschil. Wat de twee groepen onderscheidt, hebben wij niet
kunnen vaststellen:

- **Niet de reden.** `reden_id` 104, 65 en 54 komen in beide groepen voor.
- **Niet de timing.** Alle 30 correcties zijn geboekt vóór de factuurdatum van de bijbehorende
  salessheet.

---

## 5. Wat er niet aan de hand is

**De percentages zijn goed.** Uit de bedragen zelf afgeleid, en tot in vier decimalen gelijk:

| kostensoort | afgeleid uit de PDF | afgeleid uit Fabric | grondslag |
|---|---|---|---|
| Commissie directe verkoop | 10,0001% | 10,0000% | directe omzet |
| Finance en debiteuren verzekering | 0,8501% | 0,8499% | directe omzet |
| Service charge + BBH levy | 0,3220% | 0,3219% | totale omzet |

Er wordt dus niet met een verkeerd tarief gerekend. Het verschil zit uitsluitend in waar het
percentage overheen gaat.

**De overige kostensoorten kloppen.** Zie de laatste regel van de tabel in [§2](#2-het-verschil-per-kostensoort):
geen enkele afwijking boven vijftig cent, in geen enkele salessheet.

**`salesheet_amount` is het juiste veld.** Het bevat het uitgerekende bedrag, ook voor de
percentageregels. De rauwe `shkost.bedrag` met `percok`/`grondslag_id` hoeft niet gereproduceerd te
worden. Dat werkt zoals bedoeld.

---

## 6. Wat we vragen

1. **Hoort `bronfeit_extra = 'correcties'` mee te tellen in `totaal_omzet`?** Als de commissie hoort
   te gaan over de omzet ná retouren en creditcorrecties — zoals de salessheet doet — dan is de
   huidige grondslag te hoog. Zo niet, dan wijken de verstuurde salessheets af van de bedoelde
   berekening. Graag ook uitsluitsel over de inconsistentie uit [§4](#het-gedrag-is-niet-consistent):
   waarom valt de correctie bij 18 salessheets wel buiten de grondslag en bij 12 niet.

2. **Waarom telt de transactieheffing meer eenheden dan bij het opmaken van de afrekening?** Bij 110
   van de 223 salessheets ligt het aantal hoger, altijd met een heel aantal eenheden. Is dit een
   bedoelde herberekening, of worden er eenheden meegeteld die niet bij de levering horen?

3. **Ter overweging: een `laatst_gewijzigd`-kolom op de marts-tabellen.** `fct_salesheets_costs` kent
   nu alleen `levering_datum`. Daardoor kunnen wij niet zien wanneer een bedrag is herrekend en
   kunnen wij correcties op oude leveringen niet incrementeel oppikken. Dat is voor ons de
   belangrijkste reden dat wij periodiek een volledige backfill moeten draaien.

---

## 7. Reproductie

Alle cijfers komen uit twee queries op `wh_transform`.

**Kosten per levering:**

```sql
SELECT parthdr_id, kost_id, kost_naam, kost_type_code,
       salesheet_amount, totaal_omzet, totaal_verkoop_aantal
FROM   marts.fct_salesheets_costs
WHERE  parthdr_id = 2280043
ORDER  BY kost_id;
```

**De onderliggende orderregels, met de correcties apart:**

```sql
SELECT SUM(vor_aantal * afrekenprijs_per_steel) AS omzet_totaal,
       SUM(CASE WHEN bronfeit_extra =  'correcties'
                THEN vor_aantal * afrekenprijs_per_steel ELSE 0 END) AS omzet_correcties,
       SUM(CASE WHEN bronfeit_extra <> 'correcties'
                THEN vor_aantal * afrekenprijs_per_steel ELSE 0 END) AS omzet_zonder_correcties
FROM   marts.fct_orders
WHERE  parthdr_id = 2280043;
```

Uitkomst voor 2280043: totaal 10.746,17 — gelijk aan de omzet op de salessheet — waarvan
− 588,60 correcties en 11.334,77 zonder correcties. Dat laatste bedrag is wat `totaal_omzet` in
`fct_salesheets_costs` toont.

De omzetmaat is `vor_aantal × afrekenprijs_per_steel`. Die sluit exact aan op de salessheet;
`vor_omzet` doet dat niet (voor deze levering 11.100,09 tegen 10.746,17 op de PDF).

---

## 8. Achtergrond

Deze analyse hoort bij de bredere reconciliatie in `docs/reconciliatie-pcfup-colbfl.md`, waarin
dezelfde 234 salessheets zijn vergeleken op omzet, kosten en netto resultaat.

Eén punt uit dat document is hier bewust buiten beschouwing gelaten: bij een aantal leveringen is de
omzet in het warehouse zelf hoger dan op de salessheet. Dat raakt de kostenberekening via de
grondslag, maar is een eigen vraagstuk en wordt apart opgepakt.
