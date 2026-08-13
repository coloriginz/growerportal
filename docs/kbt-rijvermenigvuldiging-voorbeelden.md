# Rijvermenigvuldiging in `int_order_totaal` — reproduceerbare voorbeelden

> **Aanleiding:** reactie van Thijs op onze eerdere bevinding. Zijn uitleg: orderregels met
> productieorders worden teruggeleid naar de oorspronkelijke ingekochte partijen, waardoor één
> order uit 70 stukjes partij gevuld kan worden.
>
> **Die uitleg klopt en is precies wat we willen behouden.** We denken alleen dat we langs elkaar
> heen praten: wat wij melden is een ander verschijnsel. Dit document zet beide gevallen naast
> elkaar, met de queries erbij zodat ze na te draaien zijn.
>
> Alle metingen op `wh_transform`, 31 juli 2026.

---

## 1. Waar we het over eens zijn

Herkomsttracering over meerdere productiestappen is waardevol en we willen die graag houden. Een
orderregel die uit tientallen partijen wordt gevuld, hoort tientallen regels op te leveren — één
per herkomst. Dat is geen probleem.

Ter illustratie, dit zijn de orderregels met de meeste herkomsten:

```sql
SELECT TOP 8 ordreg_id,
       COUNT(DISTINCT part_id) AS n_partijen,
       COUNT(*)                AS n_rijen
FROM   intermediate.int_order_totaal
WHERE  ordreg_id IS NOT NULL AND part_id IS NOT NULL
GROUP BY ordreg_id
ORDER BY COUNT(DISTINCT part_id) DESC;
```

| ordreg_id | n_partijen | n_rijen |
|---|---|---|
| 14117583 | 64 | 75 |
| 14713438 | 63 | 67 |
| 14898379 | 63 | 64 |
| 16986344 | 60 | 60 |
| 14815288 | 58 | 58 |
| 16679907 | 57 | 57 |
| 14941207 | 55 | 55 |
| 14936339 | 55 | 55 |

64 partijen, 75 regels. Ongeveer één regel per herkomst. **Precies zoals Thijs beschrijft, en
hier hebben wij geen enkel bezwaar tegen.**

---

## 2. Wat wij melden is iets anders

Ons signaal gaat over orderregels waar **maar één partij** bij betrokken is, en die tóch tientallen
regels opleveren.

```sql
SELECT TOP 10 ordreg_id,
       COUNT(DISTINCT part_id) AS n_partijen,
       COUNT(DISTINCT verd_id) AS n_verdeelregels,
       COUNT(*)                AS n_rijen
FROM   intermediate.int_order_totaal
WHERE  ordreg_id IS NOT NULL AND part_id IS NOT NULL
GROUP BY ordreg_id
HAVING COUNT(DISTINCT part_id) = 1
ORDER BY COUNT(*) DESC;
```

| ordreg_id | n_partijen | n_verdeelregels | n_rijen |
|---|---|---|---|
| **14149196** | 1 | 1 | **64** |
| 14721748 | 1 | 1 | 63 |
| 14901351 | 1 | 1 | 63 |
| 16986489 | 1 | 1 | 60 |
| 14817319 | 1 | 1 | 58 |
| 16687614 | 1 | 1 | 57 |
| 16689183 | 1 | 1 | 57 |
| 16686494 | 1 | 1 | 57 |
| 16687509 | 1 | 1 | 57 |
| 16684640 | 1 | 1 | 57 |

Eén orderregel, één partij, één verdeelregel — en 57 tot 64 regels in de uitvoer. Er is hier maar
één herkomst om te traceren.

---

## 3. Casus in detail: `ordreg_id = 14149196`, `part_id = 4879469`

### Door de lagen heen

```sql
SELECT '1 bron: kbtpro.verd' AS laag, COUNT(*) AS rijen,
       COUNT(DISTINCT verd_id) AS distinct_verd, SUM(CAST(aantalst AS float)) AS som_aantal
FROM   lh_landing.kbtpro.verd            WHERE ordreg_id = 14149196 AND part_id = 4879469
UNION ALL
SELECT '2 int_order_totaal', COUNT(*), COUNT(DISTINCT verd_id), SUM(CAST(vor_aantal AS float))
FROM   intermediate.int_order_totaal     WHERE ordreg_id = 14149196 AND part_id = 4879469
UNION ALL
SELECT '3 marts.fct_orders', COUNT(*), NULL, SUM(CAST(vor_aantal AS float))
FROM   marts.fct_orders                  WHERE ordreg_id = 14149196 AND part_id = 4879469
ORDER BY laag;
```

| laag | rijen | distinct `verd_id` | som aantal |
|---|---|---|---|
| `lh_landing.kbtpro.verd` (bron) | **1** | 1 | 3840 |
| `intermediate.int_order_totaal` | **64** | 1 | 3840 |
| `marts.fct_orders` | **64** | kolom niet aanwezig | 3839,999989 |

De som blijft correct. Het aantal wordt niet gedupliceerd maar verdeeld.

### Wat varieert er tussen die 64 regels?

```sql
SELECT v.kolom, COUNT(DISTINCT v.waarde) AS distinct_waarden
FROM   intermediate.int_order_totaal f
CROSS APPLY (VALUES
  ('herkomst_key',           CAST(f.herkomst_key AS varchar(80))),
  ('consreg_id',             CAST(f.consreg_id AS varchar(80))),
  ('verd_id',                CAST(f.verd_id AS varchar(80))),
  ('verwerk_id_productie',   CAST(f.verwerk_id_productie AS varchar(80))),
  ('verwerk_id_levering',    CAST(f.verwerk_id_levering AS varchar(80))),
  ('verwerk_id_verkoop',     CAST(f.verwerk_id_verkoop AS varchar(80))),
  ('partijnummer',           CAST(f.partijnummer AS varchar(80))),
  ('barcode',                CAST(f.barcode AS varchar(80))),
  ('inkoopfactuurnr',        CAST(f.inkoopfactuurnr AS varchar(80))),
  ('orderregel_aantal',      CAST(f.orderregel_aantal AS varchar(80))),
  ('order_stelen',           CAST(f.order_stelen AS varchar(80))),
  ('productie_input_aantal', CAST(f.productie_input_aantal AS varchar(80))),
  ('vor_aantal',             CAST(f.vor_aantal AS varchar(80))),
  ('inhoud',                 CAST(f.inhoud AS varchar(80))),
  ('klokprijs',              CAST(f.klokprijs AS varchar(80))),
  ('kostprijs',              CAST(f.kostprijs AS varchar(80))),
  ('verkoopprijs',           CAST(f.verkoopprijs AS varchar(80))),
  ('aanmelddatum',           CAST(f.aanmelddatum AS varchar(80))),
  ('leverdatum',             CAST(f.leverdatum AS varchar(80))),
  ('vertrekdatum',           CAST(f.vertrekdatum AS varchar(80)))
) v(kolom, waarde)
WHERE  f.ordreg_id = 14149196 AND f.part_id = 4879469
GROUP BY v.kolom
ORDER BY distinct_waarden DESC, v.kolom;
```

**Resultaat: alleen `vor_aantal` heeft meer dan één waarde (9 stuks). Alle andere twintig
kolommen staan op precies één waarde** — inclusief `herkomst_key`, `verd_id`, `consreg_id`,
`verwerk_id_productie`, `verwerk_id_levering`, `barcode` en `partijnummer`.

Ook op `marts.fct_orders` hebben we alle 36 kolommen getoetst: alleen de tien measure-kolommen
variëren, alle 26 dimensie- en sleutelkolommen zijn constant.

### Hoe het aantal verdeeld is

```sql
SELECT vor_aantal, COUNT(*) AS n_rijen
FROM   marts.fct_orders
WHERE  ordreg_id = 14149196 AND part_id = 4879469
GROUP BY vor_aantal
ORDER BY n_rijen DESC;
```

| vor_aantal | n_rijen | veelvoud van 19,896373 |
|---|---|---|
| 19,896373 | 22 | ×1 |
| 39,792746 | 11 | ×2 |
| 59,689119 | 6 | ×3 |
| 79,585492 | 13 | ×4 |
| 99,481865 | 2 | ×5 |
| 119,378238 | 5 | ×6 |
| 139,274611 | 2 | ×7 |
| 159,170984 | 2 | ×8 |
| 179,067357 | 1 | ×9 |

Alle waarden zijn exacte veelvouden van 19,896373, en 3840 ÷ 19,896373 = **precies 193**. De
veelvouden gewogen naar rijaantal sommeren ook op 193. De orderregel van 3840 stelen wordt dus in
193 eenheden geknipt en over 64 regels verdeeld.

---

## 4. Tweede casus: `ordreg_id = 16444107`, `part_id = 5593953`

Zelfde patroon, iets andere verhouding. Vervang de ID's in de queries hierboven.

| laag | rijen | distinct `verd_id` | som aantal |
|---|---|---|---|
| `lh_landing.kbtpro.verd` | 2 | 2 | 170 |
| `intermediate.int_order_totaal` | 70 | 2 | — |
| `marts.fct_orders` | 70 | — | 170,000009 |

Twee verdeelregels worden 70 regels.

---

## 5. Onze concrete vraag

De rekenkundige uitkomst klopt: elke gesommeerde measure geeft het juiste antwoord, en de
rapportage in Power BI is dus correct. Ons probleem zit in de korrel, niet in de cijfers.

De grower portal leest **regels**, geen aggregaten. Elke regel wordt een transactie die aan een
kweker getoond wordt en die we bij een volgende import moeten kunnen terugvinden. Daarvoor hebben
we een stabiele sleutel per regel nodig. Bij 64 regels die op elke kolom identiek zijn, bestaat die
sleutel niet — we kunnen ze niet uit elkaar houden en dus niet bijwerken.

Daarom drie vragen:

1. **Is deze vermenigvuldiging bedoeld?** Bij één partij, één verdeelregel en 64 uitvoerregels
   waarvan alle kenmerken gelijk zijn, lijkt er geen herkomst te zijn die onderscheiden wordt.
2. **Zit er ergens een kenmerk dat wij over het hoofd zien?** We hebben in `int_order_totaal`
   twintig kandidaat-kolommen getoetst en in `fct_orders` alle 36. Als er een kolom is die deze
   regels wél onderscheidt, dan is ons signaal onterecht en horen we dat graag.
3. **Kan `verd_id` meegeleverd worden in `fct_orders`?** Die staat wel in `int_order_totaal` maar
   valt weg in `marts`. Dat lost ons sleutelprobleem niet volledig op zolang er 64 regels per
   `verd_id` zijn, maar het is een noodzakelijke eerste stap.

Wat wij níét vragen is het weghalen van de herkomsttracering uit §1. Die willen we juist houden —
zonder die tracering kunnen we een steel niet terugleiden naar de partij van de kweker, en dat is
nu precies wat de portal moet laten zien.
