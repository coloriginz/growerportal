# Twee gaten aan de bronkant: de afrekenprijs en de afrekentabellen

> **Voor het datateam.** Gemeten op 9 september 2026 tegen de testomgeving van de portal en
> rechtstreeks tegen Fabric via de vraag-flow. Alle queries hieronder zijn uitgevoerd, niet bedacht.
>
> **Kern:** de portal kan een verschil met de afrekening van de kweker maar van één kant bekijken.
> `marts.fct_orders` toont een `afrekenprijs_per_steel` ook wanneer de bron zegt dat die prijs niet
> is vastgesteld, en de tabellen waarin de afrekening zelf staat zijn wel beschreven maar nooit
> ingelezen. Twee kleine ingrepen maken het verschil aantoonbaar in plaats van onverklaarbaar.

---

## De aanleiding: één orderregel van EUR 54

Levering **5044771** (COLFLCEU, geleverd 18-07-2026, afrekening gedrukt 03-08-2026), partij
**3969018**. De portal komt op EUR 15.935,60 en de afrekening op EUR 15.881,60 — EUR 54,00 verschil
over tien partijen.

Dat hele verschil zit op één regel. De gedrukte partijtabel van de PDF, uitgelezen met
`src/lib/salessheet-pdf-lines.ts`, naast wat de portal heeft:

| datum | omschrijving | stelen | prijs | bedrag | portal |
|---|---|---|---|---|---|
| 18-07 | Handling: more in box | −25 | 0,000 | 0,00 | partijcorrectie |
| 20-07 | Direct sales | 200 | 0,237 | 47,40 | klopt |
| 20-07 | FHN / FHR / VBA | 3 × 1.500 | | 943,50 | klopt |
| 21-07 | Direct sales | 800 | 0,226 | 180,80 | klopt |
| **22-07** | **Direct sales** | **4.025** | **0,226** | **908,50** | **962,50** |
| 23-07 | Direct sales | 300 | 0,240 | 72,00 | klopt |
| 24-07 | Direct sales / FHN / FHR / VBA | 700 + 3 × 2.000 | | 1.634,20 | klopt |
| 27-07 | Direct sales | 700 | 0,258 | 180,60 | klopt |

**Twaalf van de dertien regels kloppen tot op de cent.** Het is dus geen systematisch prijsverschil
maar één orderregel.

De regel van 22-07 bestaat uit drie orderregels in `marts.fct_orders`:

| ordreg_id | aantal | afrekenprijs_per_steel | aantal × prijs |
|---|---|---|---|
| **16504930** | 2.000 | **0,280** | 560,00 |
| 17041997 | 25 | 0,100 | 2,50 |
| 17044559 | 2.000 | 0,200 | 400,00 |
| | 4.025 | | **962,50** |

Terugrekenen wat de afrekening hanteert — 908,50 − 2,50 − 400,00 — geeft **EUR 506 voor die 2.000
stelen, oftewel 0,253 per steel** in plaats van 0,280. Precies de EUR 54.

---

## Bevinding 1 — `afrekenprijsok` haalt de mart niet

In `lh_landing.kbtpro.ordreg` staat per orderregel zowel een `afrekenprijs` als een vlag
`afrekenprijsok`. Voor de drie regels hierboven:

```sql
SELECT ordreg_id, aantal, ape, afrekenprijs, afrekenprijsok, advies, verk
FROM lh_landing.kbtpro.ordreg
WHERE ordreg_id IN (16504930, 17041997, 17044559)
```

| ordreg_id | aantal × ape | afrekenprijs | afrekenprijsok | verk | mart toont |
|---|---|---|---|---|---|
| **16504930** | 20 × 100 = 2.000 | **0** | **false** | 0,28 | 0,28 |
| 17041997 | 1 × 25 = 25 | 0,10 | true | 0,10 | 0,10 |
| 17044559 | 5 × 400 = 2.000 | 0,20 | true | 0,21 | 0,20 |

Waar de vlag op `true` staat toont de mart netjes de afrekenprijs uit de bron. Waar hij op `false`
staat — dus waar de bron zegt dat er geen afrekenprijs is vastgesteld — toont de mart alsnog een
getal, en presenteert dat onder de naam `afrekenprijs_per_steel`. De portal neemt dat over en toont
het aan de kweker.

**Omvang.** Juli 2026, alleen consignatie en originele boekingen:

```sql
SELECT o.afrekenprijsok, COUNT(*) regels, SUM(f.vor_aantal) stelen,
       ROUND(SUM(f.vor_aantal * f.afrekenprijs_per_steel), 2) omzet
FROM marts.fct_orders f
JOIN lh_landing.kbtpro.ordreg o ON o.ordreg_id = f.ordreg_id
WHERE f._datum_key_vertrek >= '2026-07-01' AND f._datum_key_vertrek < '2026-08-01'
  AND f.bronfeit_extra = 'origineel' AND f.inkooptype_code = 'CONS'
GROUP BY o.afrekenprijsok
```

| afrekenprijsok | regels | stelen | omzet |
|---|---|---|---|
| **false** | **153** | 49.950 | **EUR 14.938,85** |
| true | 23.177 | 6.362.842 | EUR 2.392.656,58 |

Dus 0,7% van de orderregels, goed voor bijna EUR 15.000 omzet in één maand, draagt een prijs
waarvan de bron zegt dat hij niet definitief is. Van die 153 is de martprijs maar bij 8 gelijk aan
`verk`, dus waar de mart het getal in de overige gevallen vandaan haalt is niet vast te stellen.

**De vlag is er al.** `staging.stg_kbtpro__ordreg` draagt hem als `is_afrekenprijs`. Hij wordt alleen
niet doorgegeven aan `marts.fct_orders`.

> **Verzoek 1:** neem `afrekenprijsok` (of `is_afrekenprijs`) mee in `marts.fct_orders`. Dan kan de
> portal een niet-vastgestelde prijs als zodanig behandelen in plaats van hem als afrekenprijs te
> tonen.

---

## Bevinding 2 — de zes afrekentabellen zijn nooit geland

`lh_landing.kbtpro._info_schema_columns` beschrijft 669 tabellen, waaronder zes die over de
afrekening gaan:

```sql
SELECT TABLE_NAME FROM lh_landing.kbtpro._info_schema_columns
WHERE TABLE_NAME LIKE 'ssh%' GROUP BY TABLE_NAME
```

`ssh_afrekening`, `ssh_afrekening_kosten`, `ssh_afrekening_opbrengsten`, `ssh_afrekening_balans`,
`ssh_voorafrekening`, `ssh_partijverantwoording`.

**Alle zes geven een 502 op elke query, en alleen die zes.** Andere tabellen in dezelfde schema
lezen prima — `kor` antwoordt, `parthdr` telt 94.837 rijen, `ordreg` telt er 3.242.347.

Dat het niet aan de query ligt is te zien aan `SELECT TOP 0 *`: die leest geen enkele rij, alleen
metadata, en faalt óók. Ook `SELECT COUNT(*)` en `SELECT TOP 1 <één bigint-kolom>` falen, alle drie
binnen een seconde. Er is dus geen sprake van een timeout, een datatype dat de endpoint niet aankan
of rechten op rijniveau: **het tabelobject bestaat niet voor de SQL-endpoint.**

Bevestiging vanaf de andere kant: in het warehouse komt er niets van voor.

```sql
SELECT s.name, t.name FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id
WHERE t.name LIKE '%ssh%' OR t.name LIKE '%afreken%'
-- leeg, evenals dezelfde query op sys.views
```

`_info_schema_columns` is een tabel die het inleesproces zelf schrijft: een beschrijving van de
**bron**, niet van wat er daadwerkelijk in de lakehouse staat. Deze zes staan er dus wel in de
catalogus maar zijn nooit binnengehaald.

**Wat we ermee zouden kunnen.** `ssh_partijverantwoording` heeft `ssh_afrekening_id`, `art_id`,
`geleverdst`, `voorraadst`, `balansst`, `partijen`, `verwerktst`, `verkochtst`.
`ssh_afrekening` heeft `leverancier_id`, `status`, `aanmaakdatum`, `begindatum`, `einddatum`,
`balans`. Let op: deze tabellen hangen aan `ssh_afrekening_id` en `art_id` en kennen geen
`parthdr_id`, `part_id` of `ordreg_id` — het is de periodieke leveranciersafrekening per artikel,
niet de afrekening per levering. Voor de vraag hierboven lossen ze het dus mogelijk niet op, maar
zonder hen is er van de afrekenkant helemaal niets in het datalandschap.

> **Verzoek 2:** laat deze zes tabellen daadwerkelijk landen. En als er een bron is die de afrekening
> **per levering** draagt (de PDF drukt per partij en per dag een regel), dan is dát de tabel die we
> eigenlijk zoeken.

---

## Waar 0,253 níét staat

Zodat niemand deze zoektocht overdoet. Voor orderregel 16504930 is nagekeken:

| tabel | veld | waarde |
|---|---|---|
| `marts.fct_orders` | `afrekenprijs_per_steel` | 0,280 |
| `lh_landing.kbtpro.ordreg` | `afrekenprijs` | 0 |
| | `verk` | 0,280 |
| | `advies` | 0,310 |
| `lh_landing.kbtpro.verd` | `inkwaarde` | 0,230 |
| `lh_landing.kbtpro.brfordreg` | — | geen rij |

De gedrukte 0,253 komt in geen van deze velden voor, en ook EUR 506 of EUR 54 niet. De volledige
`ordreg`-rij is veld voor veld doorzocht.

Twee dingen die bij deze regel opvallen en die het verhaal misschien helpen duiden:

- **`_partition_key` is `2025-12-29`** en `_ingestion_datetime` 20-07-2026. De orderregel is dus eind
  december 2025 aangemaakt en pas in juli uitgeleverd — vandaar ook het lage `ordreg_id` (16504930)
  tussen buren in de 17.04x-reeks, op dezelfde orderkop en dezelfde vertrekdatum.
- **`vor_inkoopwaarde` is 0** in de mart, terwijl de twee buurregels 440 en 5,75 hebben.

Vermoeden, niet gemeten: een prijs die lang van tevoren is afgesproken en bij het afrekenen is
bijgesteld. Dat zou het patroon verklaren, maar het is niet aan te tonen zonder de afrekenkant.

---

## Hoe je dit reproduceert

Alle queries hierboven lopen via de vraag-flow. Een klein script volstaat:

```ts
import "dotenv/config";
process.env.NEXT_PUBLIC_APP_ENV = process.env.NEXT_PUBLIC_APP_ENV || "test";
import { ask } from "../src/lib/sync/dispatch";
console.log(await ask(`SELECT TOP 1 * FROM lh_landing.kbtpro.ordreg`));
```

Let op bij het lezen van fouten: **een 502 heeft twee heel verschillende oorzaken.** Een kolom die
niet bestaat geeft binnen een seconde een 502 die eruitziet als een storing — dat is een typefout in
de query. Een 502 op `SELECT TOP 0 *`, waar geen enkele kolom in voorkomt, betekent dat het
tabelobject zelf onvindbaar is. Dat onderscheid is het verschil tussen "mijn query deugt niet" en
"deze tabel bestaat niet".
