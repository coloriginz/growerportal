# Correcties die pas ná de afrekening zijn geboekt

> **Voor het data-team.** Gemeten op de testomgeving, 31 augustus 2026. Alle cijfers
> hieronder zijn met SQL tegen de portaldatabase en met directe queries tegen
> `marts.fct_orders` en `marts.fct_partijen` gecontroleerd.
>
> **Kern:** de sales sheet die een kweker krijgt, is een momentopname. Correcties die
> daarna in het bronsysteem worden geboekt, verlagen de omzet in Fabric en dus in de
> portal — maar staan niet op het papier dat de kweker al heeft. Bewezen bedrag waar
> die twee uiteenlopen: **EUR 7.740** over 107 leveringen. Het totaal aan correcties
> dat na de factuurdatum landde is **EUR 164.766** over 698 leveringen; welk deel
> daarvan wél op de afrekening stond, is alleen vast te stellen voor de leveringen
> waarvan we de PDF hebben.

---

## De aanleiding: één partij

Partij **3979999** (SCXGOLFW, levering C00003987, Callistephus Matsumoto Lavender).

Wat de sales sheet drukt:

| datum | | stelen | prijs | bedrag |
|---|---|---|---|---|
| 12-08-2026 | Direct sales | 80 | 0,529 | 42,28 |
| 17-08-2026 | Direct sales | 80 | 0,500 | 40,00 |
| | **totaal** | **160** | **0,514** | **82,28** |

Wat de portal toont: 120 stelen, EUR 62,28.

Het verschil is exact EUR 20,00.

## Waar dat verschil vandaan komt

`marts.fct_orders` heeft voor `part_id = 5865363` zeven rijen. De portal heeft ze
alle zeven, identiek — de import doet hier niets verkeerd:

| ordreg_id | datum | type | aantal | prijs | omzet | bronfeit_extra | reden |
|---|---|---|---|---|---|---|---|
| 17097351 | 12-08 | Aurora | 40 | 0,53 | 21,20 | origineel | |
| 17097567 | 12-08 | VMP | 40 | 0,527 | 21,08 | origineel | |
| 17103912 | 17-08 | VMP | 40 | 0,50 | 20,00 | origineel | |
| 17103912 | 17-08 | VMP | **−40** | 0,50 | **−20,00** | **correcties** | **104** |
| 17103912 | 17-08 | VMP | 0 | 0,50 | 0,00 | correcties | 104 |
| 17103912 | 17-08 | Persoonlijk | 0 | — | — | prullenbak-factcor | |
| 17106004 | 17-08 | VMP | 40 | 0,50 | 20,00 | origineel | |

De vier `origineel`-rijen tellen op tot precies 160 stelen en EUR 82,28 — de sales
sheet. De correctie van −40 stelen staat er niet op.

**En de datums verklaren waarom.** De factuurdatum van C00003987 is **09-08-2026**;
de correctie vertrok op **17-08-2026**, acht dagen later. De afrekening was al
gedrukt toen die correctie werd geboekt.

Reden 104 is *"Niet Retour, Weggooi Klant"*: de klant heeft de partij niet
teruggestuurd maar vernietigd. Dat wordt achteraf verwerkt.

**De portal is hier dus actueler dan het papier, niet fout.** De kweker heeft
EUR 82,28 op zijn afrekening zien staan; de huidige stand is EUR 62,28.

## Wat het níét is

Voor de volledigheid, want dit is uitgesloten met metingen over alle 4.041
leveringen waarvan de sales sheet-PDF is uitgelezen:

| alternatieve verklaring | uitkomst |
|---|---|
| alles optellen (huidige gedrag) | **3.803 komt overeen / 237 wijkt af** |
| `correcties`-rijen weglaten | 3.519 / 521 |
| alleen reden 104 weglaten | 3.672 / 368 |
| zelf-opheffende paren weglaten | 3.802 / 238 |
| bij een `prullenbak-factcor`-rij alleen `origineel` tellen | 3.631 / 409 |

Correcties horen dus in het totaal thuis — ze weglaten zou 91 leveringen repareren
en 375 breken. De optelling in de portal klopt; deze partij is een echte uitzondering.

## Omvang

### Correcties die na de factuurdatum vertrokken

| | |
|---|---|
| correctieregels | 2.559 |
| leveringen | 698 |
| stelen | −454.402 |
| bedrag | **−EUR 164.766** |

Bijna alles landt binnen tien dagen na de factuurdatum (2.475 van de 2.559 regels,
EUR 160.918); een kleine staart loopt door tot ruim vijftig dagen.

### Naar correctiereden

| reden | omschrijving | regels | bedrag |
|---|---|---|---|
| 54 | Retour van klant door inferieure kwaliteit | 498 | −84.273,68 |
| 104 | Niet Retour, Weggooi Klant | 918 | −60.765,28 |
| 56 | Niet geleverd | 116 | −5.585,22 |
| 93 | Retour: Terugkoop van klant | 50 | −3.167,70 |
| 112 | Retour Pick Pickopdrachten | 54 | −3.124,82 |
| 65 | Te weinig geleverd aan klant | 178 | −2.748,00 |
| 55 | Retour: Te laat geleverd | 18 | −2.707,40 |
| 106 | Te veel geleverd aan klant | 44 | −2.339,81 |
| 34 | Prijscorrectie | 82 | −54,00 |

### Wat hiervan aantoonbaar niet op de afrekening stond

Dit is het getal met bewijs eronder. Van de 698 leveringen met een correctie na de
factuurdatum hebben er **509** een sales sheet-PDF die de portal heeft uitgelezen.
Daarvan blijkt bij **107** het verschil tussen PDF en portal exact gelijk aan de
correctie:

| | |
|---|---|
| leveringen | 107 |
| som van de correcties | −EUR 7.740,32 |
| som van (PDF − portal) | +EUR 7.739,96 |

Die twee sluiten op 36 cent over 107 leveringen. Dat is geen correlatie maar een
identiteit: het bedrag dat de kweker op papier zag en dat er nu niet meer staat.

**Bij de andere 402 zit de correctie wél in de PDF.** De factuurdatum is dus geen
betrouwbare maat voor het moment waarop de afrekening werd gedrukt — vermoedelijk
wordt een sheet later opgemaakt of opnieuw uitgegeven. Dat is het belangrijkste
voorbehoud bij dit hele stuk.

### Hoeveel is er weggegeven?

- **Bewezen: EUR 7.740**, over 107 leveringen waarvan we het gedrukte document hebben.
- **Blootstelling: EUR 164.766** aan correcties na de factuurdatum, waarvan we voor
  591 leveringen niet kunnen nakijken of ze op het papier stonden.
- Naar waarde gemeten stond **12,9%** van de correcties op PDF-gecontroleerde
  leveringen níét op de afrekening (7.740 van 59.933). Houdt dat aandeel stand over
  het geheel, dan gaat het om de orde van **EUR 21.000**. Dat is een schatting met
  één zwakke aanname: de leveringen mét een gekoppelde PDF zijn geen willekeurige
  steekproef.

Om dat hard te maken zijn de gedrukte afrekeningen van de overige 591 leveringen
nodig.

## Wat dit betekent voor de controle

De portal vergelijkt sinds vandaag per levering het nettoresultaat op de PDF met het
berekende nettoresultaat, zichtbaar onder **Admin → Import Status → Data Quality**
(type `pdf-mismatch`). Op test wijken 237 van de 4.041 gelezen leveringen meer dan
een euro af.

**127 van die 237 dragen een correctieregel.** Een deel van de lijst is dus geen
importfout maar dit tijdsverschil. Zolang die twee soorten door elkaar staan, moet
iemand ze per geval scheiden. Voorstel: de rij markeren wanneer de levering een
correctie draagt die ná de factuurdatum vertrok, zodat in één oogopslag zichtbaar is
welke afwijking verklaard is. Het oordeel zelf verandert daar niet door — de portal
blijft de actuelere bron.

## Vragen voor het data-team

1. **Wanneer wordt een sales sheet daadwerkelijk opgemaakt?** `invoiceDate` blijkt
   dat moment niet betrouwbaar te dragen: bij 402 van de 509 gecontroleerde
   leveringen staat een correctie van ná die datum tóch op de PDF. Is er een veld dat
   het printmoment wél vastlegt?
2. **Wordt een afrekening opnieuw uitgegeven na een correctie?** Zo ja, krijgt de
   kweker die dan ook, en verrekent de volgende afrekening het verschil?
3. **Is reden 104 (Niet Retour, Weggooi Klant) financieel voor rekening van de
   kweker?** Met EUR 60.765 over 918 regels is dat na reden 54 de grootste post.
4. Voor de 591 leveringen zonder gekoppelde PDF: is het gedrukte archief compleet
   genoeg om ze alsnog na te rekenen?

---

*Reproduceerbaar: de partij staat in de portal als `Lot.lotNumber = '3979999'`
(`fabricPartId = 5865363`), de levering als `SalesSheet.invoiceNumber = 'C00003987'`.
De bronrijen staan in `marts.fct_orders` op `part_id = 5865363`.*
