# Reconciliatie PCFUP en COLBFL — bron, portal en salessheet

> **Uitgevoerd:** 3–4 augustus 2026. Naonderzoek 10 augustus 2026 — zie [§9](#9-naonderzoek-factuurcorrecties-zonder-verkooppoot).
> **Scope:** twee leveranciers, alle salessheets in de portal (336), waarvan 234 met een
> geverifieerde salessheet-PDF.
> **Methode:** drieweg-vergelijking. De PDF is leidend — dat is het document dat de kweker
> daadwerkelijk ontvangt.

| | PCFUP | COLBFL |
|---|---|---|
| naam | Flora United farm LDA Portugal / Odilia | Bergflora Capetown (Pty) Ltd |
| `rel_id` | 11467 | 11463 |
| salessheets in portal | 132 | 204 |
| partijen | 2.452 | 5.020 |
| met geverifieerde PDF | 82 | 160 |

---

## 1. Hoofdconclusie

**De portal mist structureel de productieomzet.** Van de 234 gecontroleerde salessheets:

| bevinding | salessheets | aandeel | omzetverschil |
|---|---|---|---|
| omzet klopt exact met de PDF | 117 | 50,0% | € 0,46 |
| **portal mist de productieomzet** | **100** | **42,7%** | **−€ 22.931,52** |
| onverklaard | 17 | 7,3% | −€ 5.963,12 |

110 van de 234 salessheets bevatten een regel `Used in production`, samen € 26.717,58.
Daarvan wordt **€ 22.932,18 niet meegeteld** door de portal.

Het netto resultaat — het bedrag dat de kweker ontvangt — wijkt over deze 234 salessheets
**€ 28.333** af van wat er op de salessheets staat.

---

## 2. De bron volgt de salessheet beter dan de portal

| | exact (<€ 0,50) | binnen € 5 | binnen € 50 |
|---|---|---|---|
| **bron (KBT)** tegenover PDF | **126 / 234** | **153** | **211** |
| **portal** tegenover PDF | 117 / 234 | 125 | 180 |

Per salessheet: de bron staat in **131** gevallen dichter bij de PDF, de portal in **23**,
en in 88 gevallen zijn ze gelijk.

Dat is het inhoudelijke argument voor de migratie: rechtstreeks uit KBT lezen levert cijfers op die
beter aansluiten op wat de kweker in handen heeft.

---

## 3. Hoe de omzet is opgebouwd

De salessheet kent drie omzetcategorieën, die één-op-één corresponderen met het ordertype in KBT:

| op de salessheet | ordertype | totaal PDF | totaal bron |
|---|---|---|---|
| Direct sales | `VO` | € 1.270.760 | € 1.274.778 |
| Turnover Auction | `AO` | € 564.343 | € 576.343 |
| **Used in production** | `MO` | € 26.752 | € 28.420 |

De omzet per verdeelregel is `verd.aantalst × ordreg.afrekenprijs`. Het alternatief `ordreg.verk`
komt niet in de buurt (16 treffers tegen 126), dus **`afrekenprijs` is het juiste veld**.

---

## 4. Kosten: de portal klopt, `shkost` alleen is niet genoeg

| | PDF | portal |
|---|---|---|
| PCFUP | € 157.060 | € 168.475 |
| COLBFL | € 316.010 | € 315.410 |

Binnen € 5 tolerantie komt de portal op 184 van de 242 salessheets overeen met de PDF.

**Belangrijke valkuil bij de migratie.** `shkost.bedrag` bevat niet altijd een bedrag:

- `percok = false` → het is een bedrag; komt exact overeen met de PDF
- `percok = true` → het is een **percentage** dat nog met een grondslag vermenigvuldigd moet worden

Voorbeeld (parthdr 2353369):

| kostensoort | `percok` | `bedrag` | op de PDF |
|---|---|---|---|
| Commissie directe verkoop | true | 10 | € 878,44 = 10% van € 8.784,45 |
| Commissie veilingverkoop | true | 2 | € 32,67 = 2% van € 1.633,38 |
| Finance en debiteurenverzekering | true | 0,85 | € 74,67 = 0,85% van € 8.784,45 |
| Veilingprovisie | false | 127,4036 | € 127,40 |
| Verwerkingskosten | false | 627,248 | € 627,25 |

Over de hele tabel: 347.101 regels met `percok = true` (gemiddelde 6,62) tegen 1.005.734 met
`percok = false` (gemiddelde 116,93).

`grondslag_id` bepaalt waarover het percentage wordt gerekend. Welke grondslag welke waarde heeft,
is nog niet uitgezocht.

> **Standpunt:** deze berekening willen we niet zelf reproduceren. Het is bedrijfslogica die wij
> niet beheren en waarvan een fout direct doorwerkt in wat de kweker uitbetaald krijgt. De
> `ssh_afrekening_kosten`-tabel bevat vermoedelijk de berekende bedragen. Dat maakt levering van de
> `ssh_`-tabellen een **harde eis**, geen wens.

---

## 5. Bug in de portal: verkeerd gekoppelde salessheet-PDF's

Bij het verifiëren van de koppelingen bleken **8 van de 242** PDF's bij een andere levering te
horen. Alle acht waren gelegd door de portal zelf, via `SalesSheet.ourInvoiceNumber`.

| parthdr | leverdatum portal | leverdatum op de PDF | bestand |
|---|---|---|---|
| 2254938 | 2025-03-09 | **2026-03-06** | `95-398227.pdf` |
| 2255566 | 2025-03-20 | **2026-01-19** | `113-395803.pdf` |
| 2253061 | 2025-02-09 | **2026-02-12** | `53-397168.pdf` |
| 2253270 | 2025-02-13 | **2026-02-15** | `56-397333.pdf` |
| 2252773 | 2025-02-06 | **2026-02-07** | `47-396947.pdf` |
| 2254701 | 2025-03-06 | **2026-03-05** | `90-398121.pdf` |
| 2387114 | 2025-12-21 | **2025-04-09** | `343-376515.pdf` |
| 2424041 | 2026-04-12 | **2026-05-08** | `148-402472.pdf` |

Het patroon is steeds hetzelfde: het factuurnummer (`95`, `113`, `53`) komt overeen, maar het jaar
niet. De filename-parser matcht op een nummer dat jaarlijks opnieuw wordt gebruikt.

**Gevolg:** deze kwekers kunnen in de portal een salessheet downloaden die bij een andere levering
hoort. Dit staat los van de migratie en is direct te repareren door bij het matchen ook de
leverdatum te controleren — precies wat wij in deze analyse hebben gedaan.

Koppelingen die op factuurnummer *plus* leverdatum tot stand kwamen (170 stuks) waren **allemaal**
correct.

---

## 6. Wat er niet aan de hand is

Twee verklaringen zijn onderzocht en verworpen.

**Geen cut-off-probleem.** De imports draaien elke vier uur; de laatste was 3 augustus 20:00.
Afwijkingen zijn niet geconcentreerd bij recente leveringen — de laatste dertig dagen kloppen juist
het best (67%), terwijl de bak van 181–365 dagen het grootste verschil laat zien. Afwijkingen komen
voor van 1 dag oud tot 576 dagen oud.

**Geen ontbrekende partijen.** Het aantal partijen komt in alle 336 salessheets exact overeen
tussen bron en portal (2.452 en 5.020). Geen enkele partij mist een verdeelregel.

---

## 7. Resterende 17 onverklaarde gevallen

| categorie | aantal | verschil |
|---|---|---|
| bron = PDF, portal wijkt af (portal-fout) | 6 | −€ 3.094 |
| alle drie verschillend | 10 | −€ 2.870 |
| bron = portal, PDF wijkt af | 1 | +€ 35 |

De zes waar bron en PDF exact overeenkomen zijn portal-defecten. Het duidelijkste voorbeeld is
parthdr 2387317: PDF € 9.147,54, bron € 9.147,54, portal € 6.170,30.

De tien waar alles verschilt vragen om regelvergelijking op transactieniveau. De data daarvoor
ligt klaar: 13.923 transactieregels uit de PDF's, gekoppeld aan partij en datum.

> **Bijgewerkt 10 augustus.** Eén van die tien — parthdr 2424435, PCFUP factuur 165 — is inmiddels
> volledig verklaard. Zie [§9](#9-naonderzoek-factuurcorrecties-zonder-verkooppoot). Er blijven er
> negen over.

---

## 8. Reconciliatie op transactieniveau

De vervolgpagina's van de salessheets bevatten per partij de losse transacties. Daarvan zijn
**13.923 regels** uitgelezen en vergeleken met de verdeelregels in KBT.

**Het partijnummer op de PDF is `part.partnum`.** Van de 5.457 partijnummers op de salessheets
werden er 5.453 teruggevonden in de bron; de vier missers zijn een parseerfout, geen datafout.

**Per partij, bedrag uit de PDF tegenover de bron:**

| | partijen | aandeel |
|---|---|---|
| exact gelijk (< € 0,05) | **5.069** | **93,0%** |
| binnen € 0,50 | 5.095 | 93,4% |
| binnen € 5,00 | 5.312 | 97,4% |
| afwijkend | 358 | 6,6% |

Van de 358 afwijkende partijen hebben er **325 productieomzet** — opnieuw dezelfde oorzaak.

### Verkoopkanalen op de salessheet

| kanaal | regels | bedrag |
|---|---|---|
| Direct sales | 8.084 | € 1.219.082 |
| VBA | 1.904 | € 369.417 |
| FHN | 745 | € 109.785 |
| FHR | 248 | € 34.621 |
| **Production** | **391** | **€ 26.718** |
| VPL | 236 | € 25.503 |
| Handling: less in box | 1.111 | € 0 |
| Handling: quality | 78 | € 0 |

Het bedrag bij `Production` komt exact overeen met de som van alle `Used in production`-regels op
pagina 1. Dat sluit de cirkel: productieomzet is een eigen verkoopkanaal op de salessheet, en de
portal importeert dat kanaal niet.

Twee dingen die hieruit volgen voor het portal-datamodel:

1. De veilingomzet valt uiteen in **vier kanalen** — VBA, FHN, FHR en VPL — die de portal nu onder
   één noemer "Veilen" schaart. Als kwekers onderscheid willen zien tussen veilingen, is dat
   beschikbaar.
2. De regels `Handling: less in box` en `Handling: quality` hebben bedrag € 0 maar wel aantallen.
   Dat zijn correcties op het aantal stelen zonder financieel effect — 1.189 regels in totaal.

---

## 9. Naonderzoek: factuurcorrecties zonder verkooppoot

> Uitgevoerd 10 augustus 2026, naar aanleiding van partij 3910198 op PCFUP factuur 165.

### De casus

Op de salessheet staat partij 3910198 (Leucadendron Ayoba Star Pearl) met vier regels, samen
350 stelen en € 46,94. In de portal staat dezelfde partij op **−140 stelen en −€ 67,30**.

| bron | regel | stelen | prijs | bedrag |
|---|---|---|---|---|
| PDF | 20-04 Handling: less in box | 10 | 0,000 | 0,00 |
| PDF | 22-04 Direct sales | 20 | 0,479 | 9,58 |
| PDF | 22-04 **Not Returned, Destructed by Customer** | 240 | **0,000** | **0,00** |
| PDF | 23-04 Direct sales | 80 | 0,467 | 37,36 |
| | | **350** | | **46,94** |

De portal heeft voor deze partij vier `Transaction`-rijen:

| ordreg | salesType | stelen | bedrag | `bronFeitExtra` | reden |
|---|---|---|---|---|---|
| 16793437 | Aurora | **−240** | **−114,24** | `correcties` | 104 `VNIREKW` — Niet Retour, Weggooi Klant |
| 16793437 | Persoonlijk | 0 | 0,00 | `prullenbak-factcor` | — |
| 16795227 | VMP | 20 | 9,58 | `origineel` | — |
| 16797882 | VMP | 80 | 37,36 | `origineel` | — |

**Voor ordreg 16793437 heeft de portal alleen de correctiepoot en nooit de verkooppoot.** Fabric
levert het origineel aan als lege `prullenbak-factcor`-rij: nul stelen, nul euro. De salessheet
saldeert verkoop en correctie tot "240 stelen, prijs 0,000, € 0,00"; de portal houdt −€ 114,24 over.

Daarmee sluit deze salessheet exact aan:

```
PDF omzet                    12.128,59
- productieomzet (§1)           182,40   ->  11.946,19
- factuurcorrectie (deze §)     114,24   ->  11.831,95
portal omzet                              11.831,96    (1 cent afronding)
```

### De bron kent deze correctie ook niet

In KBT staat verdeelregel 17802001 als een gewone verkoop: 240 stelen × `afrekenprijs` 0,476 =
**+€ 114,24**. Er staat geen tegenboeking in `verd`, `ordreg` of `partcor` — `partcor` bevat voor
deze partij alleen `PTWG` −10 (de regel "Handling: less in box").

Dat verklaart waarom ook de bronkolom afwijkt: bron € 161,18 tegen PDF € 46,94, hetzelfde verschil
van € 114,24. Dit is dus **geen portalfout maar een gat in onze tabellenset** — het is de eerste
bevinding waarbij de bron het net zo goed misheeft als de portal.

Fabric heeft de correctie wél, gelabeld `bronfeit_extra = 'correcties'` met `reden_id` 104. Het
label `prullenbak-factcor` wijst op een factuurcorrectietabel. Welke tabel dat is, is nog niet
vastgesteld; dat staat als vraag 3 in `kbt-extractie-verzoek.md` §5.

### Omvang

Portalbreed 26 combinaties van (partij, orderregel) met een `correcties`-rij zonder bijbehorende
`origineel`-rij: −2.190 stelen en **−€ 1.171,44**.

| leverancier | groepen | bedrag |
|---|---|---|
| COLXGREE | 8 | −€ 475,10 |
| MPOMARCO | 3 | −€ 324,00 |
| **PCFUP** | **1** | **−€ 114,24** |
| MDTT | 1 | −€ 72,00 |
| MPOXEIJC | 1 | −€ 60,00 |
| COLXLNFW | 1 | −€ 46,40 |
| MPOHER | 1 | −€ 36,00 |
| COLSEMPC | 1 | −€ 21,90 |
| COLXAFRI | 1 | −€ 21,00 |
| MPJSK | 2 | −€ 0,80 |
| overig (5) | 5 | € 0,00 |

Ter vergelijking: 1.025 groepen hebben correctie én origineel, en die salderen wel correct
(netto +€ 154.838). Binnen deze reconciliatie raakt het precies één salessheet, die van PCFUP.

Financieel is dit dus klein. De weergave niet: de kweker ziet een partij met negatieve stelen en
negatieve omzet, wat er als een fout uitziet ook al gaat het om een tientje.

### Bijvangst: de portal-UI voegt ongerelateerde regels samen

De aanleiding voor dit onderzoek was dat de regel `20 stelen × 0,479` onvindbaar leek in de portal.
Die staat er gewoon (ordreg 16795227). Hij is onzichtbaar door `mergeTransactions()` in
`src/app/(portal)/shipments/[id]/shipment-detail.tsx:194-222`. Pass 2 groepeert op **dag +
kanaalcategorie**, en `DIRECT_TYPES` gooit Persoonlijk, VMP en Aurora samen onder "Direct Sales".
De correctieregel (Aurora, −240) en de verkoopregel (VMP, +20) vallen daardoor allebei op 22-04 in
dezelfde bak:

- stelen −240 + 0 + 20 = **−220**
- bedrag −114,24 + 0 + 9,58 = **−104,66**
- prijs 104,66 / 220 = **0,476** — een gemengd getal dat geen enkele werkelijke prijs is

Dit is los van de migratie te repareren en raakt elke partij waar op één dag zowel een correctie
als een verkoop in hetzelfde kanaal valt.

### Werkwijze

De portal-database is bevraagd via de Neon HTTP-driver (`@neondatabase/serverless`); Prisma over
TCP 5432 komt niet door het werknetwerk. De brondata komt uit `private_input/recon-bron.json`.

---

## 10. Databestanden

Alles ligt in `private_input/`, alle scripts in `scripts/`:

| bestand | inhoud |
|---|---|
| `recon-werklijst.json` | 336 salessheets met PDF-koppeling en portalcijfers |
| `recon-bron.json` | brondata uit KBT (20 MB): parthdr, part, verd, ordreg, ordhdr, partcor, shkost |
| `recon-pdf-data.json` | 242 PDF's uitgelezen: samenvatting, kostenregels, 13.923 transactieregels |
| `recon-drieweg.json` | drieweg-vergelijking per salessheet |
| `recon-diagnose.json` | verschillen met verklaring |
| `recon-schoon.json` | 234 salessheets, verkeerd gekoppelde PDF's uitgesloten |

| script | doel |
|---|---|
| `recon-01-match-pdfs.js` | PDF's koppelen en verifiëren op leverdatum |
| `recon-02-haal-bron.js` | brondata uit KBT ophalen |
| `recon-03-vergelijk.js` | bron tegenover portal |
| `recon-05-lees-pdfs.js` | PDF's uitlezen |
| `recon-06-drieweg.js` | drieweg-vergelijking |
| `recon-07-diagnose.js` | verschillen verklaren |

| `recon-08-regelniveau.js` | reconciliatie op transactieniveau |
| `recon-regelniveau.json` | 5.453 partijen, PDF tegenover bron |

---

## 11. Wat hieruit volgt

### Voor de portal, los van de migratie

1. **Productieomzet ontbreekt.** Dit is de grootste bevinding. Kwekers zien een lager netto
   resultaat dan op hun eigen salessheet staat. Over 234 salessheets van twee leveranciers gaat het
   om € 22.932 aan niet-getoonde omzet. *Geen portal-only fix:* er bestaat geen productiekanaal in
   `Transaction.salesType` — de vijf waarden zijn VMP, Persoonlijk, Aurora, Veilen en OfferDirect.
   De MO-regels bereiken de importendpoints niet, dus dit vraagt eerst een aanpassing aan de kant
   van Fabric/Power Automate.
2. **Acht verkeerd gekoppelde salessheet-PDF's.** Direct te repareren door bij het matchen de
   leverdatum te controleren.
3. **`invoiceDate` is de leverdatum.** Zie `kbt-datalandschap.md`; in 48% van de gevallen valt de
   afrekening in een andere maand.
4. **De transactieweergave voegt ongerelateerde regels samen.** Zie [§9](#bijvangst-de-portal-ui-voegt-ongerelateerde-regels-samen).
   Verbergt data en toont een verzonnen prijs. Portal-only, klein.

### Voor het extractieverzoek

1. **De `ssh_`-tabellen zijn een harde eis**, niet een wens. Zonder `ssh_afrekening_kosten` moeten
   we de percentageberekening zelf reproduceren, en dat is bedrijfslogica die direct doorwerkt in
   wat de kweker uitbetaald krijgt.
2. **`ordreg.herkomst` en `ordhdr.ordertype`** zijn bevestigd als bron van het verkoopkanaal, en
   `ordertype = 'MO'` is de productieomzet die nu ontbreekt.
3. **`shkost.percok` en `grondslag_id`** moeten mee, óók als de `ssh_`-tabellen worden geleverd —
   ze zijn nodig om de aansluiting te kunnen controleren.
4. **Factuurcorrecties ontbreken in onze tabellenset.** Zie [§9](#9-naonderzoek-factuurcorrecties-zonder-verkooppoot).
   `verd`, `ordreg` en `partcor` bevatten ze niet; Fabric heeft ze wel als
   `bronfeit_extra = 'correcties'`. Uitgezet als vraag 3 in `kbt-extractie-verzoek.md` §5. Let op
   dat §7 van dat document `fact`, `factreg` en `factord` nu nog uitsluit.

### Nog uit te zoeken

- De negen resterende salessheets waar bron, portal én PDF alle drie verschillen. Data ligt klaar
  op regelniveau.
- In welke tabel van het semantisch model de factuurcorrecties zitten. Wordt nagevraagd bij het
  datateam.
- Waar `grondslag_id` naar verwijst; er is geen grondslagentabel gespiegeld.
- Of de vier veilingkanalen (VBA, FHN, FHR, VPL) apart getoond moeten worden aan de kweker. Dat is
  een productvraag, geen datavraag.
