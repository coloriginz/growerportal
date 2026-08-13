# Extractieverzoek KBT → Grower Portal

> **Voor:** datateam Coloriginz
> **Van:** Henk Pieter den Boer, grower portal
> **Datum:** 30 juli 2026
>
> **Doel:** de grower portal rechtstreeks voeden vanuit KBT in plaats van via het semantisch model.
> Dit document beschrijft welke tabellen en velden de portal daadwerkelijk nodig heeft.
>
> **Belangrijk:** dit is bewust een *minimale* set. De portal gebruikt vandaag ongeveer 25 unieke
> bronvelden. Alles wat hieronder niet staat, hebben we niet nodig — ook als het nu wel wordt
> aangeleverd. Achtergrond in `kbt-datalandschap.md`.

---

## 1. Hoe de portal de data samenstelt

De portal draait op vier entiteiten. De join-structuur is het belangrijkste onderdeel van dit
verzoek, want die gaat in de huidige route mis.

```
zendhdr ──┐
          ▼
       parthdr  (levering / afrekening)        → SalesSheet
          │  └── shkost  (kosten per levering) → SalesSheetCost
          ▼
        part    (partij)                       → Lot
          │  └── partcor (correcties)          → LotCorrection
          ▼
        verd    (verdeling)  ← DE KOPPELTABEL  → Allocation
          ▼
       ordreg   (orderregel)                   → OrderLine
          ▼
       ordhdr   (orderheader)
```

**`ordreg` heeft geen `part_id`.** De koppeling partij ↔ orderregel loopt uitsluitend via `verd`,
en is many-to-many: één orderregel kan uit meerdere partijen gevuld worden. `verd_id` is de enige
stabiele sleutel op dat niveau — `(part_id, ordreg_id)` is niet uniek (20.529 dubbele combinaties
op 3,33 miljoen rijen).

Graag `verd` als eigen tabel aanleveren, mét `verd_id`, en niet vooraf platgeslagen met `ordreg`.

---

## 2. Benodigde velden per tabel

Legenda: **✓** = zeker nodig · **?** = graag, nog te bevestigen · *cursief* = kan vervallen

### `parthdr` — levering / afrekening → SalesSheet

| veld | nodig | waarvoor |
|---|---|---|
| `parthdr_id` | ✓ | primaire sleutel, join naar `part` en `shkost` |
| `rel_id` | ✓ | leverancier (bevestigd, zie §4) |
| `factnum` | ✓ | **niet** het factuurnummer maar het vlucht-/containernummer; op de PDF gelabeld als `Flight number / container` (geverifieerd) |
| `ssh_afrekening_id` | ✓ | koppeling naar de salessheet-afrekening — zie vraag 1 |
| `levdatum` / `levdatumtijd` | ✓ | leverdatum, sortering en weergave |
| `zendhdr_id` | ? | koppeling naar zending; alleen nodig als we `parthdrkost` willen |
| `salessheetaanmaakdatumtijd` | ✓ | **afrekendatum** — zie vraag 1, nu niet gespiegeld |
| `bdrf_id` | ? | bedrijfsentiteit, voor multi-company branding |

### `part` — partij → Lot

Van de 130 kolommen hebben we er negen nodig.

| veld | nodig | waarvoor |
|---|---|---|
| `part_id` | ✓ | primaire sleutel |
| `parthdr_id` | ✓ | join naar levering |
| `rel_id` | ✓ | kweker (bevestigd, zie §4) |
| `art_id` | ✓ | join naar `art` voor productnaam |
| `partnum` | ✓ | partijnummer, getoond aan de kweker |
| `s01` | ✓ | **steellengte** — de portal leest dit als lengte in cm |
| `s02`, `s03` | ✓ | sorteerkenmerken, getoond in leveringsdetail |
| `aantal`, `ape` | ? | colli en aantal per eenheid (bevestigd, zie §4) |
| `agrpspec_id` | ? | artikelgroep komt via art.agrp_id, niet uit part |

*Niet nodig:* de overige ~120 kolommen, waaronder `oms`, `lengte`, `klokprijs`, `inkoop`,
`status`, alle logistieke vlaggen.

### `verd` — verdeling → Allocation

| veld | nodig | waarvoor |
|---|---|---|
| `verd_id` | ✓ | **primaire sleutel — cruciaal** |
| `part_id` | ✓ | join naar partij |
| `ordreg_id` | ✓ | join naar orderregel |
| `aantalst` | ✓ | verdeelde stelen — de basis van alle volumecijfers |
| `inkwaarde` | ? | inkoopwaarde per verdeelregel |
| `aanmaakdatumtijd` | ✓ | delta-detectie |

### `ordreg` — orderregel → OrderLine

Van de 129 kolommen hebben we er vijf nodig.

| veld | nodig | waarvoor |
|---|---|---|
| `ordreg_id` | ✓ | primaire sleutel |
| `ordhdr_id` | ✓ | join naar orderheader |
| `afrekenprijs` | ✓ | afrekenprijs per steel — samen met `verd.aantalst` de omzet |
| `herkomst` | ✓ | **verkoopkanaal**: 0=Persoonlijk, 3=VMP, 8=Aurora, 4=OfferDirect (zie §4) |

### `ordhdr` — orderheader

| veld | nodig | waarvoor |
|---|---|---|
| `ordhdr_id` | ✓ | primaire sleutel |
| `vdatum` | ✓ | **verkoopdatum** — élk datumfilter in de portal draait hierop |
| `ordertype` | ✓ | `AO` betekent Veilen en gaat vóór op `herkomst` (zie §4) |
| `status` | ? | filtering op afgeronde orders |

### `partcor` — correcties → LotCorrection

| veld | nodig | waarvoor |
|---|---|---|
| `partcor_id` | ✓ | primaire sleutel |
| `part_id` | ✓ | join naar partij |
| `reden_id` | ✓ | join naar `reden` voor de correctiereden |
| `coraantalst` | ✓ | correctie in stelen |
| `ape` | ✓ | aantal per eenheid; colli = `coraantalst / ape` (zie §4) |
| `cordatum` | ✓ | datum en delta-detectie |

### `shkost` — kosten → SalesSheetCost

| veld | nodig | waarvoor |
|---|---|---|
| `shkost_id` | ✓ | primaire sleutel |
| `parthdr_id` | ✓ | join naar levering |
| `kost_id` | ✓ | join naar `kost` voor de omschrijving |
| `bedrag` | ✓ | kostenbedrag |

*Niet nodig:* `grondslag_id`, `percentage`, `percok`, `inclusiefok`, `btwsrt`, `type`, `rel_id`.

### `zendhdr` — zending

Alleen nodig als we kosten op zendingniveau (`parthdrkost`) willen meenemen. Nu niet in gebruik.

| veld | nodig |
|---|---|
| `zendhdr_id`, `rel_id`, `aankomstdatum` | ? |

---

## 3. Stamtabellen

Klein en zelden wijzigend; volledige verversing is prima. Sommige tabellen zijn breed (`rel` heeft
173 kolommen, `agrp` 125), daarom hieronder per tabel de velden die we nodig hebben.

### `rel` — relaties (leveranciers én kwekers)

| veld | nodig | waarvoor |
|---|---|---|
| `rel_id` | ✓ | primaire sleutel |
| `kode` | ✓ | leverancierscode, o.a. voor het matchen van salessheet-PDF's |
| `oms` | ✓ | naam |
| `levok`, `kwekerok` | ✓ | onderscheid leverancier / kweker |
| `actiefok` | ✓ | inactieve relaties uitfilteren |
| `bdrf_id` | ✓ | bedrijfsentiteit, voor multi-company branding |
| `land_id`, `plaats` | ✓ | herkomst kweker, getoond in leveranciersdetail |
| `taal_id` | ? | **nieuw** — voorkeurstaal; nu handmatig ingesteld per leverancier |
| `email`, `telefoon`, `adres`, `postcode`, `btwnum` | ? | **nieuw** — nu handmatig onderhouden in de portal |
| `valuta_id` | ? | |

### `rel_data` — aanvullende relatiegegevens

| veld | nodig | waarvoor |
|---|---|---|
| `rel_id` | ✓ | sleutel |
| `accountmanager_id` | ✓ | **accountmanager**, join naar `mede`. Dit is een autorisatiemechanisme: commercie ziet alleen leveranciers met een matchende AM-code. |
| `globalgap_nummer`, `mpsnummer` | ? | **nieuw** — certificeringen; nu handmatig onderhouden in de portal |

### `mede` — medewerkers

`mede_id`, `kode`, `oms`. Nodig voor de accountmanager-koppeling. Graag bevestigen dat `mede.kode`
overeenkomt met de KBT-code die onze commercie-gebruikers hebben.

### `art` — artikelen

`art_id`, `kode`, `oms` (productnaam), `agrp_id`, `kleur_id`, `actiefok`, `mutatiedatumtijd`.

### `agrp` — artikelgroepen

`agrp_id`, `kode`, `oms`, `pd_oms`, `actiefok`, plus `sortkmerk1_id` t/m `sortkmerk6_id`.

### `sortkmerk` — betekenis van de sorteerkenmerken

Volledige tabel (klein). Bepaalt samen met `agrp.sortkmerk1_id` t/m `6_id` wat `part.s01` t/m
`s06` per artikelgroep betekenen.

### `reden` + `redentype` — correctieredenen

`reden`: `reden_id`, `kode`, `oms`, `redentype_id`, `claimok`, `actiefok`
`redentype`: `redentype_id`, `kode`, `oms`, `actiefok`

Nu handmatig geseed via een script; graag als volwaardige feed.

### `kost` + `kosttype` — kostensoorten

`kost`: `kost_id`, `kode`, `oms`, `kosttype_id`, `actiefok`
`kosttype`: `kosttype_id`, `kode`, `oms`, `shkostok`, `actiefok`

`kosttype.shkostok` lijkt aan te geven of een kostensoort op de salessheet hoort — graag bevestigen.

### Overige lookups — volledig, ze zijn klein

| tabel | velden |
|---|---|
| `land` | `land_id`, `kode`, `oms`, `isocode` |
| `kleur` | `kleur_id`, `kode`, `oms`, `colour` |
| `valuta` | `valuta_id`, `kode`, `oms`, `isocode`, `symbool`, `koersverk` |
| `keurmerk` | volledige tabel (6 kolommen) |
| `veilkwal` | niet nodig, zie vervallen vraag onderaan §5 |
| `mede` | medewerkers, voor de accountmanager-koppeling via `rel.verkoper_id` |
| `bdrf` | `bdrf_id`, `kode`, `oms`, `handelsnaam`, `salessheetemail`, `globalgap_nummer` |
| `fust` | `fust_id`, `kode`, `oms`, `soort` — alleen als we colli-eenheden willen tonen |

---

## 4. Zelf uitgezocht — ter bevestiging

Onderstaande hebben we op 3 augustus 2026 zelf vastgesteld op de Fabric landing zone. Graag een
korte bevestiging dat we het goed lezen; als iets niet klopt horen we dat uiteraard liever nu.

**Leverancier en kweker.** `parthdr.rel_id` is de leverancier, `part.rel_id` de kweker. Gemeten
over 885.000 partijen: in 59% is de leverancier `levok=1, kwekerok=0` en de kweker `kwekerok=1`,
en zijn het verschillende relaties. In 30% is het dezelfde relatie met beide vlaggen aan — een
kweker die zelf levert. Slechts 1,8% wijkt hiervan af.

**Colli en aantal per eenheid.** `part.aantal` is het aantal colli, `part.ape` het aantal per
eenheid; het product is het totaal aantal stelen. Bevestigd door vergelijking met de verdeling.

**Artikelgroep.** `art.agrp_id` → `agrp` is de bron. Dekking is volledig: van de 37.676 artikelen
heeft er geen enkele een lege `agrp_id`, verdeeld over 749 groepen.

**Accountmanager.** Dit is **`rel_data.accountmanager_id`** → `mede`, niet `rel.verkoper_id`.
Dat laatste is de verkoper, een ander begrip, en staat voor 52 van onze 56 leveranciers op
"Onbekend". De accountmanager-koppeling via `rel_data` komt exact overeen met wat wij nu hebben.

**Correctie in colli.** Bestaat niet als apart veld. `partcor.coraantalst` is de correctie in
stelen en `partcor.ape` het aantal per eenheid; colli is af te leiden als `coraantalst / ape`
wanneer `ape > 0`. In de praktijk staat `ape` vaak op 0.

**Verkoopkanaal.** Het verkooptype dat het semantisch model toont, is te reproduceren uit twee
bronvelden. Geverifieerd met een join tussen `marts.fct_orders` en `kbtpro.ordreg`:

| verkooptype | regel | regels |
|---|---|---|
| Veilen | `ordhdr.ordertype = 'AO'` | 175.128 |
| VMP | `ordreg.herkomst = 3` | 1.274.869 |
| Aurora | `ordreg.herkomst = 8` | 453.148 |
| OfferDirect | `ordreg.herkomst = 4` | 27.282 |
| Persoonlijk | `ordreg.herkomst = 0` | 1.600.131 |

`AO` gaat vóór op `herkomst`. Afwijkend: 4.065 regels (0,12%) staan als Persoonlijk terwijl
`herkomst` op 3 of 8 staat. Graag bevestigen dat we deze regel goed lezen, en of die 0,12% een
bewuste uitzondering is.

## 5. Openstaande vragen

Nog drie. Deze bepalen of de extractie in één keer goed is.

**1. Welk veld bevat de datum waarop de salessheet is opgemaakt?**

De portal toont nu de leverdatum waar de afrekendatum hoort te staan. Dat hebben we vastgesteld
door salessheet-PDF's naast de bron te leggen.

Elke salessheet-PDF bevat twee datums. De eerste is exact gelijk aan `parthdr.levdatum`. De tweede
ligt er dagen tot weken na en is de datum waarop de salessheet is opgemaakt — bij één exemplaar
staat er zelfs een tijdstip bij (`18-12-25 22:02`).

| `parthdr_id` | `factnum` | `levdatum` in KBT | datum 1 op de PDF | datum 2 op de PDF | verschil |
|---|---|---|---|---|---|
| 2240545 | `094-23` | 2025-01-02 | 02-01-2025 | 15-01-2025 | 13 dagen |
| 2280402 | `9512` | 2025-05-18 | 18-05-2025 | 26-05-2025 | 8 dagen |
| 2364305 | `101881` | 2025-11-05 | 05-11-2025 | 18-12-2025 | 43 dagen |
| 2409092 | `102145` | 2026-02-05 | 05-02-2026 | 13-02-2026 | 8 dagen |

Vier van de vier: datum 1 is de leverdatum, datum 2 iets anders.

Dit is voor ons niet cosmetisch. De portal rekent netto-opbrengst per periode af; bij een verschil
van 43 dagen valt de opbrengst in de verkeerde maand voor de kweker.

Wij vermoeden `parthdr.salessheetaanmaakdatumtijd` of `ssh_afrekening.aanmaakdatum`. Beide zijn
niet naar de landing zone gespiegeld, dus we kunnen het zelf niet toetsen. Welk veld levert datum 2?

**Waar we níét moeten zoeken:** in `fact` staan klantfacturen (347.000 stuks, types F/C/FF/D,
gericht aan debiteuren). De salessheetnummers uit de PDF's komen daar niet in voor.

### De `ssh_`-tabellen — mogelijk het antwoord op meer dan alleen de datum

In de bronkatalogus staat een familie tabellen die specifiek over salessheet-afrekeningen gaat.
**Geen daarvan is naar de landing zone gespiegeld**, waardoor ze bij ons pas laat in beeld kwamen:

| tabel | kolommen | inhoud |
|---|---|---|
| `ssh_afrekening` | 10 | `ssh_afrekening_id`, `leverancier_id`, **`aanmaakdatum`**, `begindatum`, `einddatum`, `balans`, `status`, `valuta_id`, `koers`, `opm` |
| `ssh_afrekening_balans` | 11 | `inkoop`, `kosten`, `opbrengst`, `voorafrekening`, `balansdatum` |
| `ssh_afrekening_kosten` | 8 | `kost_id`, `bedrag`, `koers`, `type` |
| `ssh_afrekening_opbrengsten` | 11 | `art_id`, `stelen`, `bedrag`, `connectbedrag`, `aantalpartijen` |
| `ssh_partijverantwoording` | 8 | `art_id`, `balansst` |
| `ssh_voorafrekening` | 11 | |

`parthdr.ssh_afrekening_id` en `parthdr.ssh_voorafrekening_id` koppelen eraan.

Dit lijkt de afrekening zoals die op de salessheet-PDF wordt afgedrukt: opbrengsten per artikel,
kosten per kostensoort, en een balans. De portal berékent die totalen nu zelf uit `part` en
`shkost`, terwijl KBT ze kennelijk al vastlegt.

**Dit is voor ons een harde eis geworden, geen wens.** Op 3–4 augustus is een reconciliatie
uitgevoerd over 234 salessheets van PCFUP en COLBFL (zie `reconciliatie-pcfup-colbfl.md`). Daaruit
bleek dat `shkost.bedrag` niet altijd een bedrag is:

- `percok = false` → bedrag, komt exact overeen met de salessheet
- `percok = true` → **percentage**, dat nog met een grondslag vermenigvuldigd moet worden

Over de hele tabel: 347.101 regels met `percok = true` tegen 1.005.734 met `false`. Wij willen die
berekening niet zelf reproduceren — het is bedrijfslogica die wij niet beheren en waarvan een fout
rechtstreeks doorwerkt in wat de kweker uitbetaald krijgt. `ssh_afrekening_kosten` bevat
vermoedelijk de berekende bedragen zoals ze op de salessheet worden afgedrukt.

Twee vragen: klopt het dat dit de bron van de afgedrukte salessheet is, en kunnen deze tabellen mee
in de extractie?

Los daarvan hebben we `shkost` mét `percok` en `grondslag_id` sowieso nodig, om de aansluiting te
kunnen controleren. En we weten nog niet waar `grondslag_id` naar verwijst — er is geen
grondslagentabel gespiegeld.

**Hoe we hierop kwamen**, zodat jullie het zelf kunnen nalopen: in `lh_landing` staat de tabel
`kbtpro._info_schema_columns` met de volledige kolomkatalogus van de bronserver — 8.111 kolommen
over 662 tabellen, dus ook alles wat niet gespiegeld is. Daarop:

```sql
SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
FROM   kbtpro._info_schema_columns
WHERE  LOWER(TABLE_NAME) LIKE '%afreken%' OR LOWER(TABLE_NAME) LIKE '%ssh%'
ORDER BY TABLE_NAME, COLUMN_NAME;
```

Onafhankelijke bevestiging: `ssh_afrekening_id` en `ssh_voorafrekening_id` staan ook in de
kolomlijst die de oude QlikView-extracten voor `PARTHDR` teruggaven.

Mogelijk relevant buiten onze vraag om: als het semantisch model het netto resultaat zelf berekent
uit `part` en `shkost` terwijl `ssh_afrekening_balans` het al vastlegt, kan dat verschillen
verklaren tussen wat Power BI toont en wat er op de salessheet-PDF staat die de kweker ontvangt.
Dat is te toetsen met één salessheet.

**2. Regels met verkooptype "Script aanpassen" hebben geen bestaande orderregel**
In `marts.fct_orders` staan 4.063 regels met verkooptype `Script aanpassen`. Bij een join met
`kbtpro.ordreg` op `ordreg_id` vallen die er allemaal uit — er is dus geen bijbehorende orderregel
in de bron. Ze zitten verspreid over `VO`, `MO`, `BO`, `INT` en regels zonder ordertype.

Geen groot volume, maar het leek ons goed te melden. Voor ons is de vraag vooral of we ze mogen
negeren.

**3. Waar staan de factuurcorrecties?**
*Toegevoegd 10 augustus 2026.*

In `fct_orders` staat `bronfeit_extra` met vier waarden. Eén daarvan, `correcties` (43.231 rijen),
bevat orderregelcorrecties met een `reden_id` — bijvoorbeeld 104 `VNIREKW` "Niet Retour, Weggooi
Klant". **Die correcties zijn wij in de bron niet tegengekomen.** Ze staan niet in `verd`, niet in
`ordreg` en niet in `partcor`; `partcor` bevat alleen partijcorrecties (`PTWG`, `PPKW` en
soortgelijke).

Concreet voorbeeld, partij `partnum` 3910198 (PCFUP, `parthdr_id` 2424435, factuur 165):

| laag | regel | stelen | bedrag |
|---|---|---|---|
| KBT `verd` 17802001 → `ordreg` 16793437 | gewone verkoop, `afrekenprijs` 0,476 | 240 | **+114,24** |
| salessheet-PDF | "Not Returned, Destructed by Customer", prijs 0,000 | 240 | **0,00** |
| `fct_orders`, `bronfeit_extra = 'correcties'`, `reden_id` 104 | correctie | −240 | **−114,24** |
| `fct_orders`, `bronfeit_extra = 'prullenbak-factcor'` | leeg | 0 | 0,00 |

De salessheet saldeert verkoop en correctie tot nul. In KBT zien wij alleen de verkooppoot, in het
semantisch model alleen de correctiepoot. Beide geven daardoor een verkeerd antwoord: de bron
€ 114,24 te hoog, de portal € 114,24 te laag.

Onze vragen:

1. **In welke brontabel worden deze correcties vastgelegd?** Het label `prullenbak-factcor` doet
   een factuurcorrectietabel vermoeden, maar wij hebben de naam niet kunnen vaststellen. Een query
   op `kbtpro._info_schema_columns` naar `%factcor%` of `%ordregcor%` levert bij ons niets
   bruikbaars op — mogelijk omdat de tabel anders heet.
2. **Wat betekent `prullenbak-factcor` precies?** Alle 609 rijen die de portal ervan ontvangt
   hebben nul stelen en nul euro. Is dat een restbak waarin het origineel verdwijnt zodra er een
   factuurcorrectie op zit?
3. Zodra de tabel bekend is: kan die mee in de extractie, met `reden_id` erbij?

Volume in de portalkopie: 26 combinaties van partij en orderregel hebben wel een correctie maar
geen origineel, samen −€ 1.171. Klein bedrag, maar het maakt partijen bij de kweker zichtbaar
negatief. Achtergrond in `reconciliatie-pcfup-colbfl.md` §9.

---

### Vervallen vraag: kwaliteitsdata

We hadden hier een vraag staan over keur- en kwaliteitsmeldingen per partij, omdat de
kwaliteitsmodule van de portal geen databron heeft. Die is niet aan jullie gericht: kwaliteit zit
niet in KBT en wordt via een aparte applicatie gekoppeld. We hebben in de mirror wel `veilkwal`
gezien, maar die bevat alleen `kode` en `veilkwal_id` en vier rijen — geen bruikbare feed.

---

## 6. Afbakening en volumes

**Periode:** de portal heeft 2024 tot heden nodig; 2025–2026 volstaat voor de eerste levering.
Historie vóór 2023 is niet relevant.

Volumes ter indicatie, gemeten op de landing zone (2023–2026):

| tabel | rijen totaal | 2024–2026 |
|---|---|---|
| `verd` | 3.331.168 | 2.319.044 |
| `part` | 883.865 | — |
| `parthdr` | 92.532 | — |
| `partcor` | 185.503 | — |
| `shkost` | 303.040 | — |

**Delta-mechanisme.** We hebben vastgesteld dat KBT geen `rowversion` of gewijzigd-op kolom heeft
op de transactionele tabellen (0 van 662 tabellen, gecontroleerd op de volledige katalogus). Als er
tóch een technische mutatiestempel bestaat die wij niet hebben gevonden, horen we dat graag — dat
scheelt aanzienlijk. Zo niet, dan werken we met een venster op businessdatum plus periodieke
sleutelvergelijking, zoals de QlikView-extracten ook deden.

**Verwijderingen.** We moeten kunnen detecteren dat een partij of orderregel is verwijderd. De
goedkoopste vorm is periodiek de volledige lijst primaire sleutels, zonder overige kolommen —
precies wat de QlikView-extracten deden met `SELECT part_id FROM part WHERE YEAR(tijd) >= 2022`.

---

## 7. Wat we expliciet níét nodig hebben

Scheelt jullie werk, en ons ruis:

- Alle logistieke velden: karren, dozen, bonnen, picklijsten, transport
- Voorraad en opslag (`partopslag`, `_voorraadstand`)
- Facturatie richting debiteuren (`fact`, `factreg`, `factord`) — *met één voorbehoud sinds
  10 augustus: de factuurcorrecties uit vraag 3 in §5 hebben wij wél nodig. Als die in deze familie
  tabellen blijken te zitten, geldt de uitsluiting daar niet voor.*
- Productie en verwerking (`verwerk`, `lstreg`, productieplanning)
- `part_data` — in de huidige mirror bevat die alleen `part_id` en `aanmeldtijd`, en de portal
  gebruikt er niets uit
- `parttrans` — hebben we eerder overwogen, maar de portal gebruikt het niet

---

## 8. Betrouwbaarheid van dit document

De veldenlijsten voor `part`, `parthdr`, `ordreg`, `ordhdr`, `verd`, `partcor`, `shkost` en
`zendhdr` zijn afgeleid uit de kolomlijsten die de QlikView-extracten teruggaven, gekruisd met
`kbtpro._info_schema_columns` in de Fabric landing zone. Die twee bronnen komen exact overeen op
kolomaantallen, dus de tabelstructuur is betrouwbaar.

Wat we **niet** met zekerheid weten is de betekenis van individuele velden — vandaar de acht vragen
in §4. Daar hebben we jullie kennis voor nodig.
