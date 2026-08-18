# Ontwerp: doorklikken van een import naar de records

> **Status:** ontwerp, nog niet gebouwd.
> **Datum:** 18 augustus 2026
> **Bouwt op:** [2026-08-17-sync-bediening-design.md](2026-08-17-sync-bediening-design.md), waarvan het
> implementatieplan op 18 augustus is afgerond.
> **Aanleiding:** het importscherm toont per ronde hoeveel records zijn aangemaakt, bijgewerkt en
> overgeslagen. Wat het niet toont is wélke. De vraag die in de praktijk terugkomt is niet "hoeveel"
> maar "is de levering van die ene kweker binnengekomen", en die is nu niet te beantwoorden.

---

## 1. Twee vragen, twee mechanismen

Het scherm moet twee dingen kunnen beantwoorden, en die vragen precies het tegenovergestelde.

**"Wat heeft deze ronde binnengehaald?"** Die records bestaan; ze hoeven alleen gemarkeerd te worden
met de ronde die ze heeft aangeraakt.

**"Wat heeft deze ronde weggegooid, en waarom?"** Die records bestaan juist *niet* — dat is de hele
reden dat ze in beeld moeten komen. Er is niets om naartoe te klikken, dus dit vraagt iets anders:
niet het record, maar de leverancier die ontbreekt en de knop om hem aan te maken.

Die asymmetrie is het hart van dit ontwerp. Eén mechanisme dat beide dekt bestaat niet.

---

## 2. Genomen beslissingen

| onderwerp | keuze | overweging |
|---|---|---|
| **Herkomst van een record** | `lastImportBatchId` op `Lot`, `Transaction`, `Grower`, `SalesSheetCost` | de goedkoopste manier om "welke ronde raakte dit aan" beantwoordbaar te maken, zonder lijsten in een JSON-kolom |
| **Aangemaakt versus bijgewerkt** | afgeleid uit `createdAt` tegen de starttijd van de batch | scheelt een tweede kolom en klopt per definitie |
| **Overgeslagen** | het bestaande `skippedSuppliers` uitbreiden en tonen | de import weet het al; er hoeft niets bij opgeslagen te worden dat er niet is |
| **Kweker of interne boeking** | afleiden uit `facttypesub` tijdens de import | het onderscheid zit in de data; een handmatig vlaggetje veroudert |
| **Waar de doorklik landt** | een eigen weergave in het importscherm | `/lots` is leverancier-gescopet en kwekergericht; een beheerder kijkt juist over leveranciers heen |
| **Omvang** | een pagina per keer, niet alles | een ronde raakt tot 2.735 partijen; een volledige lijst beantwoordt geen vraag |

---

## 3. Wat er binnenkwam

Vier modellen krijgen een nullable `lastImportBatchId` met een index: `Lot`, `Transaction`, `Grower`
en `SalesSheetCost`. De import-routes zetten hem in hun upsert.

Dat is de hele opslag. Geen lijsten, geen groei: één string per record, overschreven bij elke ronde
die hem aanraakt.

**Aangemaakt of bijgewerkt** hoeft niet apart vastgelegd te worden. Een record waarvan `createdAt` op
of ná de starttijd van de batch ligt, is door die batch aangemaakt; al het andere is bijgewerkt. Dat
klopt per definitie en scheelt een kolom die uit de pas kan lopen.

**Wat je ziet als je klikt.** Een paneel in het importscherm met de records van die ronde, gescheiden
in aangemaakt en bijgewerkt, gesorteerd op leverancier en leverdatum, vijftig per pagina. Per regel
genoeg om hem te herkennen — partijnummer, leverancier, artikel, leverdatum — en een link naar de
bestaande detailpagina.

**Waarom niet doorlinken naar `/lots`.** Dat scherm is gebouwd voor een kweker die zijn eigen partijen
bekijkt: het filtert op de gekozen leverancier en toont productgerichte kolommen. Een beheerder die een
ronde nakijkt wil juist over leveranciers heen kijken. Dat scherm daarvoor ombouwen maakt het voor
beide doelgroepen slechter.

**De kosten-import vraagt extra aandacht.** Die schrijft langs drie paden weg: een rauwe `UPDATE`
over een jsonb-array voor bestaande regels, een `createMany` voor nieuwe, en een terugval op losse
creates als die faalt. Alle drie moeten het batch-id meekrijgen. Slaat er één over, dan ontstaan er
kostenregels die wel bestaan maar geen herkomst dragen — en dat is een halve toestand die later niet
te verklaren is.

**Buiten scope:** `Supplier`. Die wordt elke ronde in zijn geheel bijgewerkt — 673 van de 673 — dus
"welke leveranciers raakte deze ronde aan" levert geen antwoord op dat iets toevoegt. Toe te voegen
wanneer iemand het mist; het patroon is dan identiek.

---

## 4. Wat er niet binnenkwam

`ImportBatch.details.skippedSuppliers` bevat sinds 17 augustus per `rel_id` hoeveel partijen zijn
weggegooid omdat de leverancier niet in de portal bestaat. Dat is de basis; er komen twee dingen bij.

### De leverancier krijgt een gezicht

`FabricRelation` bevat alle 2.926 Fabric-relaties met code, naam en accountmanager. Het scherm joint
daarop, zodat er `16699 — FFS Ecuador (PFC)` staat in plaats van een nummer.

En `POST /api/admin/fabric-relations` maakt al een `Supplier` aan vanuit zo'n relatie, inclusief de
controle of hij niet al bestaat. Die knop hoeft dus niet gebouwd te worden — hij moet alleen
bereikbaar worden vanuit het importscherm.

Het rollende venster maakt dit meteen nuttig: zet je een leverancier aan, dan valt zijn partij de
volgende ronde nog steeds binnen het venster en komt hij alsnog binnen. Aanzetten ís de reparatie.

### Kwekers en interne boekingen uit elkaar

Niet elke overgeslagen relatie hoort een leverancier te worden. Gemeten op 18 augustus:

| rel_id | code | land | EAN | wat ze boeken |
|---|---|---|---|---|
| 16699 | FFSEPFC | Ecuador | ja | 1.070 `origineel` + 12 `correctie` |
| 13397 | GCPDFAAL | Italië | ja | 398 `origineel` + 16 `correctie` |
| 8623 | RCPROD | Nederland | nee | 367 `productie` + 1 `productiecorrectie` |
| 14845 | RCFTPROD | Nederland | nee | 122 `productie` |
| 15639 | SCPRO | Nederland | nee | 236 `productie` + 1 `productiecorrectie` |

De onderste drie boeken uitsluitend `productie`: interne productieboekingen, geen kwekers om aan af te
rekenen. Hun partijen horen overgeslagen te worden. Zonder onderscheid staan ze elke ronde bovenaan en
nodigen ze uit om leveranciers aan te maken die er niet horen — en een leverancier verwijderen is een
stuk lastiger dan aanmaken.

**Het onderscheid wordt afgeleid, niet ingevoerd.** De lots-import kent de `Facttype Sub` van elke rij
die hij weggooit. `skippedSuppliers` gaat daarom van `{ relId: aantal }` naar
`{ relId: { partijen, productie } }`. Een relatie waarvan álle overgeslagen partijen `productie` zijn,
toont het scherm apart onder "interne boekingen".

Dat is beter dan een vlaggetje op `FabricRelation` dat iemand met de hand zet: geen onderhoud, geen
verouderde markeringen, en een relatie die ooit tóch als kweker gaat leveren verhuist vanzelf naar de
juiste groep.

**Let op wat níét werkt als onderscheid.** `dim_leverancier.leverancier_is_leverancier` staat bij alle
vijf op `true`. Het veld waarvan de naam precies dit belooft, levert het niet — de vierde kolom in dit
warehouse waarvan de naam iets anders belooft dan hij bevat, na de accountmanager, `vor_omzet` en
`inkoopfust_volume`.

---

## 5. Wat er in de code verandert

| bestand | wijziging |
|---|---|
| `prisma/schema.prisma` | `lastImportBatchId String?` plus index op `Lot`, `Transaction`, `Grower` |
| `src/app/api/import/lots/route.ts` | batch-id in de upsert; `skippedSuppliers` telt ook `productie` |
| `src/app/api/import/orders/route.ts` | batch-id in de upsert |
| `src/app/api/import/growers/route.ts` | batch-id in de upsert |
| `src/app/api/import/costs/route.ts` | batch-id in alle drie de schrijfpaden |
| `src/app/api/admin/import-batches/[id]/records/route.ts` | nieuw: de records van één ronde, gepagineerd |
| `src/app/api/admin/import-batches/[id]/skipped/route.ts` | nieuw: overgeslagen relaties, gejoind en gegroepeerd |
| `src/app/(portal)/admin/imports/batch-records-dialog.tsx` | nieuw: het paneel met de records |
| `src/app/(portal)/admin/imports/data-sync-tab.tsx` | de aantallen aanklikbaar maken; de bestaande overgeslagen-dialoog wordt de twee groepen met een aanmaakknop |

**Het risico zit in de upserts.** Dat is rauwe SQL die financiële data wegschrijft, en een kolom
toevoegen betekent hem in zowel de `INSERT`-lijst als de `ON CONFLICT DO UPDATE SET` opnemen. Eén per
keer omzetten en per stuk verifiëren, zoals bij het omzetten naar de gedeelde omhulling.

---

## 6. Testaanpak

De classificatie kweker-of-productie is een pure functie over `skippedSuppliers` en krijgt een
controlescript onder `scripts/checks/`, in de bestaande vorm: alleen `productie` telt als interne
boeking, gemengd telt als kweker, en een relatie zonder telling telt als kweker.

De rest is integratie en wordt op test geverifieerd: een ronde draaien, de aantallen aanklikken, en
controleren dat de records die je ziet ook werkelijk die ronde als herkomst dragen. En één echte
reparatie: een overgeslagen leverancier aanzetten, de volgende ronde draaien, en zien dat zijn partijen
alsnog binnenkomen.

---

## 7. Wat hier niet in zit

- **Overgeslagen orderregels.** De orders-import gooit per nachtronde 6.269 regels weg waarvan er maar
  99 verklaard worden door `skippedNoOrdregId`. De rest heeft geen partij in de portal en dat wordt
  nergens geteld. Hetzelfde patroon als bij lots, maar een eigen wijziging; los te trekken zodra dit
  staat.
- **Historie per record.** `lastImportBatchId` houdt alleen de laatste ronde bij. "Welke rondes hebben
  deze partij ooit aangeraakt" vraagt een koppeltabel, en die vraag is nog nooit gesteld.
- **Opruimen.** De kolom wijst naar een `ImportBatch` die nooit verwijderd wordt. Komt er ooit een
  opruiming van oude batches, dan moeten deze verwijzingen mee.
