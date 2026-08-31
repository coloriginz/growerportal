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

**Alle 107 staan regel voor regel in de bijlage onderaan**, met factuurdatum, datum
van de laatste correctie, het aantal dagen ertussen, beide nettobedragen en het
verschil — zodat elk geval los na te lopen is. De tien grootste staan er met hun
correctieredenen bij.

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


## Bijlage: de 107 leveringen, regel voor regel

De leveringen waarvan bewezen is dat de correctie niet op de afgedrukte afrekening
stond: het verschil tussen PDF en portal is daar gelijk aan de som van de correcties
die na de factuurdatum vertrokken. Gesorteerd op verschil, groot naar klein.

`verschil` is PDF minus portal: wat de kweker op papier zag, minus wat de portal nu zegt.
`dagen` is hoeveel dagen na de factuurdatum de laatste correctie vertrok.

| # | leverancier | levering | factuurdatum | laatste correctie | dagen | corr. regels | corr. stelen | netto portal | netto PDF | verschil |
|---:|---|---|---|---|---:|---:|---:|---:|---:|---:|
| 1 | COLOZFL | C711 - gribholm | 2025-09-27 | 2025-10-06 | 8 | 2 | -2000 | 9713.40 | 10953.42 | **1240.02** |
| 2 | PCXGAF | 1745 | 2026-06-12 | 2026-06-15 | 2 | 5 | -1050 | -22.55 | 523.45 | **546.00** |
| 3 | COLXLNFW | 2700475 | 2026-05-27 | 2026-05-29 | 1 | 3 | -1150 | 2553.47 | 3001.98 | **448.51** |
| 4 | COLXLNFW | 2700497 | 2026-06-05 | 2026-06-08 | 2 | 3 | -1200 | 3342.58 | 3726.58 | **384.00** |
| 5 | SCXGOLFW | C00003942 | 2026-06-03 | 2026-06-04 | 0 | 3 | -1920 | 133.24 | 478.84 | **345.60** |
| 6 | COLFLCEU | 5044489 | 2026-03-06 | 2026-03-09 | 2 | 2 | -1900 | 13939.99 | 14217.38 | **277.39** |
| 7 | SCXGOLFB | C00003828 | 2026-03-06 | 2026-03-09 | 2 | 4 | -1500 | 1485.91 | 1740.91 | **255.00** |
| 8 | PCXOMRI | 684 | 2025-02-27 | 2025-03-03 | 4 | 3 | -400 | 2857.63 | 3039.64 | **182.01** |
| 9 | PCFUSA | 9480 | 2025-05-09 | 2025-05-12 | 2 | 3 | -200 | 8882.97 | 9064.40 | **181.43** |
| 10 | COLXLNFW | 2600192 | 2025-03-13 | 2025-03-17 | 4 | 2 | -480 | 864.81 | 1032.80 | **167.99** |
| 11 | COLXGREE | 11811 Poeldijk | 2025-04-25 | 2025-04-29 | 3 | 2 | -320 | 20417.08 | 20582.53 | **165.45** |
| 12 | PCFUSA | 9995 | 2025-10-04 | 2025-10-07 | 2 | 3 | -220 | 5711.00 | 5857.74 | **146.74** |
| 13 | COLXSHA | 56-2410068 | 2026-02-21 | 2026-02-27 | 5 | 3 | -225 | 2250.21 | 2396.43 | **146.22** |
| 14 | PCFUSA | 9504 | 2025-05-16 | 2025-05-19 | 2 | 3 | -225 | 13597.29 | 13739.92 | **142.63** |
| 15 | COLZFLXC | 102573 | 2026-05-24 | 2026-06-01 | 7 | 3 | -750 | -964.69 | -852.18 | **112.51** |
| 16 | COLXLNFW | 2600660 | 2025-09-15 | 2025-09-19 | 3 | 6 | -210 | 322.41 | 429.45 | **107.04** |
| 17 | COLZFLXC | 102170 | 2026-02-16 | 2026-02-23 | 6 | 5 | -250 | 630.45 | 735.55 | **105.10** |
| 18 | COLXAFRI | EURO251007 | 2025-11-25 | 2025-11-28 | 3 | 3 | -300 | 625.45 | 730.45 | **105.00** |
| 19 | PCFUP | 158 | 2026-04-15 | 2026-04-20 | 4 | 3 | -100 | 9075.48 | 9178.77 | **103.29** |
| 20 | COLCICE | 133-22 | 2025-05-27 | 2025-05-30 | 2 | 3 | -350 | 781.15 | 872.15 | **91.00** |
| 21 | COLXLNFW | 2700350 | 2026-04-23 | 2026-04-28 | 4 | 6 | -400 | 4447.69 | 4533.69 | **86.00** |
| 22 | PCFUSA | 10088 | 2025-10-25 | 2025-10-27 | 1 | 3 | -250 | 23894.48 | 23979.71 | **85.23** |
| 23 | PCFUSA | 10076 | 2025-10-23 | 2025-10-27 | 3 | 3 | -150 | 3907.05 | 3987.57 | **80.52** |
| 24 | SCXGOLFW | C00003466 | 2025-03-06 | 2025-03-10 | 4 | 3 | -180 | 4327.64 | 4399.64 | **72.00** |
| 25 | COLXLNFW | 2700003 | 2026-01-04 | 2026-01-06 | 1 | 6 | -90 | 5521.20 | 5592.01 | **70.81** |
| 26 | COLXTOG2 | 17591 240226 | 2026-02-24 | 2026-02-26 | 1 | 2 | -100 | 1177.45 | 1247.45 | **70.00** |
| 27 | SCXGOLFW | 2026-000000012 | 2026-05-25 | 2026-05-28 | 2 | 3 | -160 | 712.29 | 773.09 | **60.80** |
| 28 | PCFUP | 208 | 2025-06-05 | 2025-06-10 | 4 | 2 | -60 | 3560.12 | 3618.67 | **58.55** |
| 29 | PCFRUT | 22-2276714 | 2025-04-05 | 2025-04-10 | 5 | 3 | -40 | 5111.57 | 5170.05 | **58.48** |
| 30 | PCFRUT | 6-2241686 | 2025-01-23 | 2025-01-27 | 4 | 3 | -72 | 59972.38 | 60030.06 | **57.68** |
| 31 | COLXLNFW | 2600761 | 2025-11-12 | 2025-11-17 | 4 | 2 | -90 | 2293.57 | 2350.63 | **57.06** |
| 32 | COLXGREE | 17709 | 2026-03-10 | 2026-03-11 | 0 | 3 | -40 | 12367.91 | 12422.56 | **54.65** |
| 33 | COLXLNFW | 2700018 | 2026-01-12 | 2026-01-19 | 6 | 3 | -60 | 3055.53 | 3108.34 | **52.81** |
| 34 | PCXOMRI | 779 | 2025-06-20 | 2025-06-24 | 3 | 6 | -140 | 5832.16 | 5884.16 | **52.00** |
| 35 | SCXGOLFW | C00003808 | 2026-02-18 | 2026-02-23 | 4 | 2 | -60 | 3653.01 | 3704.01 | **51.00** |
| 36 | PCXBAR | 436-2253306 | 2025-02-13 | 2025-02-17 | 4 | 2 | -100 | 1334.15 | 1384.65 | **50.50** |
| 37 | COLXAFRI | OZ250011 | 2025-01-20 | 2025-01-27 | 7 | 3 | -120 | 4285.20 | 4335.60 | **50.40** |
| 38 | SCXGOLFW | C00003417 | 2025-02-14 | 2025-02-17 | 3 | 3 | -90 | 2271.31 | 2319.64 | **48.33** |
| 39 | SCXGOLFB | C00003415 | 2025-02-13 | 2025-02-17 | 4 | 6 | -90 | 5972.05 | 6020.38 | **48.33** |
| 40 | SCXGOLFB | 8221384 | 2025-06-05 | 2025-06-06 | 0 | 6 | -300 | 4460.68 | 4507.49 | **46.81** |
| 41 | SCXGOLFW | C00003763 | 2026-01-01 | 2026-01-06 | 4 | 6 | -90 | 2318.20 | 2365.00 | **46.80** |
| 42 | COLXAFRI | OZ260006 | 2026-01-15 | 2026-01-20 | 4 | 3 | -120 | 2525.37 | 2570.97 | **45.60** |
| 43 | PCFUSA | 9592 | 2025-06-11 | 2025-06-13 | 1 | 3 | -150 | 9161.21 | 9206.31 | **45.10** |
| 44 | SCXGOLFW | C00003895 | 2026-04-29 | 2026-05-04 | 4 | 3 | -90 | 2049.32 | 2094.32 | **45.00** |
| 45 | COLXLNFW | 2700023 | 2026-01-14 | 2026-01-18 | 3 | 3 | -60 | 3971.28 | 4015.68 | **44.40** |
| 46 | COLBFL | C042 LH S | 2025-06-03 | 2025-06-10 | 6 | 3 | -150 | 7861.62 | 7905.57 | **43.95** |
| 47 | COLXLNFW | 2700244 | 2026-03-16 | 2026-03-19 | 2 | 3 | -90 | 6055.48 | 6098.69 | **43.21** |
| 48 | PCXOMRI | 680 | 2025-02-25 | 2025-02-27 | 2 | 6 | -150 | 3759.71 | 3800.95 | **41.24** |
| 49 | SCXGOLFW | C00003710 | 2025-10-31 | 2025-11-04 | 3 | 3 | -120 | 1083.06 | 1121.70 | **38.64** |
| 50 | PCFRUT | 10-2409275 | 2026-02-07 | 2026-02-09 | 1 | 3 | -5 | 10379.66 | 10415.91 | **36.25** |
| 51 | SCXGOLFW | C00003850 | 2026-03-17 | 2026-03-18 | 0 | 3 | -90 | 1358.21 | 1394.22 | **36.01** |
| 52 | COLXLNFW | 2600592 | 2025-07-11 | 2025-07-14 | 2 | 6 | -400 | 1580.33 | 1615.52 | **35.19** |
| 53 | COLXAFRI | OZ250124 | 2025-08-15 | 2025-08-18 | 3 | 2 | -120 | 1157.75 | 1192.91 | **35.16** |
| 54 | PCXGAF | 1696 | 2025-09-16 | 2025-09-19 | 2 | 3 | -80 | 208.23 | 241.83 | **33.60** |
| 55 | PCFUP | 92 | 2026-03-07 | 2026-03-13 | 5 | 3 | -20 | 9413.16 | 9445.14 | **31.98** |
| 56 | COLCICE | 132-23 | 2025-05-22 | 2025-06-02 | 10 | 3 | -100 | 1812.59 | 1843.70 | **31.11** |
| 57 | PCRUICON | 28-2-25 | 2025-02-28 | 2025-03-10 | 10 | 2 | -25 | 780.00 | 810.00 | **30.00** |
| 58 | COLXSHA | 63 | 2026-03-07 | 2026-03-11 | 3 | 3 | -75 | 1821.67 | 1851.66 | **29.99** |
| 59 | SCXGOLFW | C00003680 | 2025-08-27 | 2025-09-05 | 8 | 3 | -100 | 710.37 | 738.38 | **28.01** |
| 60 | PCFUSA | 9632 | 2025-06-27 | 2025-07-03 | 6 | 3 | -50 | 7061.90 | 7089.62 | **27.72** |
| 61 | COLXTOG2 | 18978 19-5-26 | 2026-05-19 | 2026-05-22 | 2 | 3 | -50 | 1924.99 | 1952.49 | **27.50** |
| 62 | SCXGOLFW | C00003352 | 2025-01-05 | 2025-01-13 | 8 | 3 | -30 | 1759.96 | 1786.96 | **27.00** |
| 63 | PCFRUT | 18-2255615 | 2025-03-20 | 2025-03-24 | 4 | 3 | -20 | 6212.72 | 6238.96 | **26.24** |
| 64 | PCXOMRI | 689 | 2025-03-05 | 2025-03-07 | 2 | 3 | -50 | 805.69 | 830.69 | **25.00** |
| 65 | COLSEMPC | 113-2388036 | 2026-01-19 | 2026-01-26 | 6 | 3 | -150 | 23950.80 | 23975.54 | **24.74** |
| 66 | SCXGOLFW | C00003814 | 2026-02-23 | 2026-03-02 | 6 | 3 | -60 | 3932.62 | 3956.62 | **24.00** |
| 67 | COLXGREE | 17946 | 2026-04-01 | 2026-04-07 | 5 | 3 | -40 | 17699.58 | 17723.17 | **23.59** |
| 68 | COLXAFRI | OZ260005 | 2026-01-15 | 2026-01-20 | 4 | 3 | -60 | 2272.19 | 2294.99 | **22.80** |
| 69 | COLBFL | C130 DE Tues | 2025-11-13 | 2025-11-18 | 4 | 3 | -60 | 8692.37 | 8715.16 | **22.79** |
| 70 | COLBFL | C125 SU DE | 2025-11-04 | 2025-11-11 | 6 | 3 | -5 | 9846.35 | 9869.09 | **22.74** |
| 71 | COLFLCEU | 5044172 | 2025-10-16 | 2025-10-22 | 5 | 3 | -100 | 14607.21 | 14629.22 | **22.01** |
| 72 | COLXLNFW | 2600062 | 2025-01-31 | 2025-02-03 | 3 | 3 | -80 | 2778.09 | 2799.69 | **21.60** |
| 73 | COLXLNFW | 2600306 | 2025-04-09 | 2025-04-11 | 2 | 3 | -80 | 5466.17 | 5486.97 | **20.80** |
| 74 | SCXGOLFW | C00003987 | 2026-08-09 | 2026-08-17 | 7 | 3 | -40 | 373.06 | 393.07 | **20.01** |
| 75 | PCXOMRI | 972 | 2026-05-19 | 2026-05-22 | 2 | 3 | -100 | 1040.41 | 1059.41 | **19.00** |
| 76 | COLXLNFB | 2600090 | 2025-02-14 | 2025-02-18 | 4 | 3 | -50 | 5048.34 | 5066.85 | **18.51** |
| 77 | COLXLNFW | 2600824 | 2025-12-11 | 2025-12-15 | 3 | 3 | -37 | 91.61 | 109.37 | **17.76** |
| 78 | PCFUSA | 9977 | 2025-10-02 | 2025-10-06 | 3 | 3 | -50 | 2902.69 | 2920.17 | **17.48** |
| 79 | COLZFLXC | 102217 | 2026-03-06 | 2026-03-10 | 3 | 3 | -150 | 5512.67 | 5529.18 | **16.51** |
| 80 | COLXLNFW | 2700387 | 2026-05-04 | 2026-05-05 | 0 | 3 | -30 | 2434.41 | 2450.91 | **16.50** |
| 81 | PCXGAF | 1683 | 2025-07-22 | 2025-07-28 | 5 | 6 | -40 | 539.12 | 553.16 | **14.04** |
| 82 | COLBFL | C028 LH S | 2025-05-06 | 2025-05-09 | 2 | 3 | -10 | 8288.21 | 8302.01 | **13.80** |
| 83 | COLXLNFW | 2600045 | 2025-01-26 | 2025-01-30 | 4 | 3 | -20 | 4720.19 | 4732.99 | **12.80** |
| 84 | COLFLCEU | 5043938 | 2025-05-31 | 2025-06-06 | 5 | 3 | -100 | 9375.30 | 9388.02 | **12.72** |
| 85 | COLCICE | 172-23 | 2025-11-13 | 2025-12-01 | 17 | 3 | -50 | 998.30 | 1006.60 | **8.30** |
| 86 | PCFUP | 274 | 2025-10-19 | 2025-10-21 | 1 | 3 | -3 | 8834.35 | 8842.54 | **8.19** |
| 87 | COLXLNFW | 2700299 | 2026-04-02 | 2026-04-03 | 0 | 3 | -40 | 3913.96 | 3921.96 | **8.00** |
| 88 | COLXGREE | 17736 | 2026-03-11 | 2026-03-13 | 1 | 3 | -10 | 9456.71 | 9462.35 | **5.64** |
| 89 | COLXAFRI | OZ260039-40 | 2026-03-08 | 2026-03-12 | 3 | 3 | -20 | 2534.70 | 2538.80 | **4.10** |
| 90 | PCXBAR | 550 | 2026-02-12 | 2026-02-16 | 3 | 3 | -5 | 327.74 | 329.84 | **2.10** |
| 91 | COLXGREE | 11733 Poeldijk | 2025-04-17 | 2025-04-22 | 4 | 2 | 0 | 15911.67 | 15911.68 | **0.01** |
| 92 | SCXGOLFB | C00003719 | 2025-11-14 | 2025-11-20 | 5 | 2 | 0 | 1070.42 | 1070.42 | **0.00** |
| 93 | COLZFLXC | 102750 | 2026-06-10 | 2026-06-15 | 4 | 2 | 0 | 2619.46 | 2619.46 | **0.00** |
| 94 | COLXGREE | 11725 poeldijk | 2025-04-16 | 2025-04-22 | 6 | 2 | 0 | 16558.08 | 16558.08 | **0.00** |
| 95 | COLZFLXC | 101068 | 2025-09-13 | 2025-09-15 | 1 | 2 | 0 | 387.74 | 387.74 | **0.00** |
| 96 | COLXGREE | 11398 Poeldijk | 2025-03-24 | 2025-03-25 | 1 | 2 | 0 | 27194.44 | 27194.44 | **0.00** |
| 97 | COLXGREE | 11435 Poeldijk | 2025-03-26 | 2025-03-28 | 2 | 2 | 0 | 17710.52 | 17710.52 | **0.00** |
| 98 | COLXGREE | 18155 | 2026-04-25 | 2026-04-28 | 2 | 2 | 0 | 25378.39 | 25378.39 | **0.00** |
| 99 | COLCICE | 150-23 | 2025-08-08 | 2025-08-13 | 4 | 4 | 0 | 3508.93 | 3508.93 | **0.00** |
| 100 | COLZFLXC | 102269 | 2026-03-25 | 2026-03-27 | 1 | 2 | 0 | 3426.66 | 3426.66 | **0.00** |
| 101 | PCFUP | 265 | 2025-10-12 | 2025-10-14 | 1 | 2 | 0 | 5387.46 | 5387.46 | **0.00** |
| 102 | COLBFL | C049 FF S | 2025-06-22 | 2025-06-23 | 0 | 2 | 0 | 7.80 | 7.80 | **0.00** |
| 103 | COLOZFL | C743 - TK | 2025-10-14 | 2025-10-17 | 3 | 2 | 0 | 6417.91 | 6417.90 | **-0.01** |
| 104 | COLZFLXC | 102292 | 2026-04-03 | 2026-04-10 | 6 | 2 | 0 | 715.91 | 715.89 | **-0.02** |
| 105 | COLZFLXC | 102309 | 2026-04-11 | 2026-04-20 | 8 | 4 | 0 | 145.73 | 145.71 | **-0.02** |
| 106 | PCFUSA | 9473 | 2025-05-02 | 2025-05-06 | 3 | 4 | 0 | 8785.66 | 8785.63 | **-0.03** |
| 107 | COLSEMPC | 115 | 2026-01-26 | 2026-01-29 | 2 | 4 | 0 | 19861.25 | 19861.16 | **-0.09** |
| | | | | | | | | | **totaal** | **7739.96** |

### Samengevat per leverancier

| leverancier | leveringen | bedrag |
|---|---:|---:|
| COLXLNFW | 17 | 1594.48 |
| COLOZFL | 2 | 1240.01 |
| SCXGOLFW | 13 | 843.20 |
| PCFUSA | 9 | 726.82 |
| PCXGAF | 3 | 593.64 |
| SCXGOLFB | 4 | 350.14 |
| PCXOMRI | 5 | 319.25 |
| COLFLCEU | 3 | 312.12 |
| COLXAFRI | 6 | 263.06 |
| COLXGREE | 9 | 249.34 |
| COLZFLXC | 8 | 234.08 |
| PCFUP | 5 | 202.01 |
| PCFRUT | 4 | 178.65 |
| COLXSHA | 2 | 176.21 |
| COLCICE | 4 | 130.41 |
| COLBFL | 5 | 103.28 |
| COLXTOG2 | 2 | 97.50 |
| PCXBAR | 2 | 52.60 |
| PCRUICON | 1 | 30.00 |
| COLSEMPC | 2 | 24.65 |
| COLXLNFB | 1 | 18.51 |
| **totaal** | **107** | **7739.96** |

### De tien grootste, met hun correctieredenen

**1. COLOZFL — levering C711 - gribholm** (factuur 2025-09-27, leverdatum 2025-09-27)

Portal 9713.40 tegen PDF 10953.42, verschil **1240.02**. Bestand: `C711 - gribholm-389811.pdf`

| reden | regels | stelen | bedrag |
|---|---:|---:|---:|
| Retour van klant door inferieure kwaliteit | 2 | -2000 | -1240.00 |

**2. PCXGAF — levering 1745** (factuur 2026-06-12, leverdatum 2026-06-12)

Portal -22.55 tegen PDF 523.45, verschil **546.00**. Bestand: `PCXGAF - 06_12_2026 05_15_00 - 1745 - 405288.PDF`

| reden | regels | stelen | bedrag |
|---|---:|---:|---:|
| Niet geleverd | 4 | -1050 | -546.00 |
| null | 1 | 0 | 0.00 |

**3. COLXLNFW — levering 2700475** (factuur 2026-05-27, leverdatum 2026-05-27)

Portal 2553.47 tegen PDF 3001.98, verschil **448.51**. Bestand: `COLXLNFW - 05_27_2026 11_00_00 - 2700475 - 404034.PDF`

| reden | regels | stelen | bedrag |
|---|---:|---:|---:|
| Niet geleverd | 2 | -1150 | -448.50 |
| null | 1 | 0 | 0.00 |

**4. COLXLNFW — levering 2700497** (factuur 2026-06-05, leverdatum 2026-06-05)

Portal 3342.58 tegen PDF 3726.58, verschil **384.00**. Bestand: `COLXLNFW - 06_05_2026 11_00_00 - 2700497 - 404700.PDF`

| reden | regels | stelen | bedrag |
|---|---:|---:|---:|
| Niet geleverd | 2 | -1200 | -384.00 |
| null | 1 | 0 | 0.00 |

**5. SCXGOLFW — levering C00003942** (factuur 2026-06-03, leverdatum 2026-06-03)

Portal 133.24 tegen PDF 478.84, verschil **345.60**. Bestand: `SCXGOLFW - 06_03_2026 10_45_00 - C00003942 - 404639.PDF`

| reden | regels | stelen | bedrag |
|---|---:|---:|---:|
| Niet geleverd | 2 | -1920 | -345.60 |
| null | 1 | 0 | 0.00 |

**6. COLFLCEU — levering 5044489** (factuur 2026-03-06, leverdatum 2026-03-07)

Portal 13939.99 tegen PDF 14217.38, verschil **277.39**. Bestand: `5044489-398247.pdf`

| reden | regels | stelen | bedrag |
|---|---:|---:|---:|
| Te veel geleverd aan klant | 2 | -1900 | -277.40 |

**7. SCXGOLFB — levering C00003828** (factuur 2026-03-06, leverdatum 2026-03-06)

Portal 1485.91 tegen PDF 1740.91, verschil **255.00**. Bestand: `C00003828-398195.pdf`

| reden | regels | stelen | bedrag |
|---|---:|---:|---:|
| Prijscorrectie | 2 | 0 | 0.00 |
| Retour Pick Pickopdrachten | 2 | -1500 | -255.00 |

**8. PCXOMRI — levering 684** (factuur 2025-02-27, leverdatum 2025-02-27)

Portal 2857.63 tegen PDF 3039.64, verschil **182.01**. Bestand: `684-374138.pdf`

| reden | regels | stelen | bedrag |
|---|---:|---:|---:|
| Niet Retour, Weggooi Klant | 2 | -400 | -182.00 |
| null | 1 | 0 | 0.00 |

**9. PCFUSA — levering 9480** (factuur 2025-05-09, leverdatum 2025-05-09)

Portal 8882.97 tegen PDF 9064.40, verschil **181.43**. Bestand: `9480-378655.pdf`

| reden | regels | stelen | bedrag |
|---|---:|---:|---:|
| Niet Retour, Weggooi Klant | 2 | -200 | -181.40 |
| null | 1 | 0 | 0.00 |

**10. COLXLNFW — levering 2600192** (factuur 2025-03-13, leverdatum 2025-03-13)

Portal 864.81 tegen PDF 1032.80, verschil **167.99**. Bestand: `2600192-374878.pdf`

| reden | regels | stelen | bedrag |
|---|---:|---:|---:|
| Retour van klant door inferieure kwaliteit | 2 | -480 | -168.00 |

---

*Reproduceerbaar: de partij staat in de portal als `Lot.lotNumber = '3979999'`
(`fabricPartId = 5865363`), de levering als `SalesSheet.invoiceNumber = 'C00003987'`.
De bronrijen staan in `marts.fct_orders` op `part_id = 5865363`.*
