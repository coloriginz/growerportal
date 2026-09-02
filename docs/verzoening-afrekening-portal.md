# De afrekening naast de portal, partij voor partij

*Gemeten op de testomgeving, 1 september 2026.*

## Waarom

De controle op nettoresultaat in **Admin → Import Status → Data Quality** vindt de
leveringen waar de portal en de afrekening niet hetzelfde zeggen. Ze zegt niet
waar in die levering het misgaat. Elke vondst van de afgelopen weken kwam van
iemand die een partij openklapte, de PDF ernaast legde en de regels vergeleek.

`scripts/recon-salessheet-lines.ts` doet dat werk nu voor het hele archief. Het
leest de partijtabel van elke sales sheet, legt hem naast de partijen en
boekingen van de portal, en geeft elk verschil een naam. De opbrengst is niet de
lijst met verschillen — die is grotendeels verklaarbaar — maar wat er ná die
naamgeving overblijft.

Uitkomst in `private_input/verzoening-regelniveau.xlsx`. Tabblad **Onverklaard**
staat vooraan; elke rij draagt leverancier, kweker, levering, leverdatum,
factuurdatum en partijnummer, zodat een geval direct terug te vinden is.

## Wat er eerst moest kloppen

Drie aannames bleken fout en zijn gemeten in plaats van aangenomen. Ze staan hier
omdat ze ook voor elke volgende analyse gelden.

**De portal telt álle boekingen op een partij, niet alleen de originele.** Fabric
overschrijft een gecorrigeerde orderregel niet maar boekt hem tegen en opnieuw:
partij 3695766 draagt 1.260 stelen, −1.260 en +900. Alleen "origineel" tellen
geeft 1.260 stelen en EUR 617,40 waar de afrekening 900 stelen en EUR 441
afdrukt. Het saldo over de drie is precies wat er op het blad staat.

**Zes kanalen dragen geld, vierentwintig niet.** Over het hele archief — 4.630
bladen, 46.922 partijen — komen dertig omschrijvingen voor. Alleen "Direct
sales", "VBA", "FHN", "FHR", "Production" en "VPL" dragen ooit een bedrag; de
andere vierentwintig staan samen 27.483 keer op een blad en dragen samen EUR
1,24. Daarom is de scheiding een whitelist en geen lijst uitzonderingen: een
onbekende omschrijving valt aan de correctiekant en komt naar boven als
steelverschil in plaats van stilletjes de bedragen te vervuilen.

**Er zijn twee opmaken.** De gewone drukt per regel de bruto-omzet af en zet de
kosten in een eigen blok eronder. Een tweede opmaak — 229 van de 4.041
leveringen, vooral COLZFLXC en COLSEMPC — verrekent de kosten al per regel en
drukt helemaal geen kostenblok af. Op levering COLSEMPC 128 telt de afrekening
EUR 27.579,55 waar de portal EUR 40.850,25 omzet en EUR 13.270,72 kosten apart
houdt; het nettoresultaat is aan beide kanten gelijk. Daar zijn alleen de stelen
vergelijkbaar. Te herkennen aan de drie kenmerken samen: geen kostenblok op het
blad, omzet en netto zijn hetzelfde getal, en de portal kent voor die levering
wél kosten.

## Twee parserfouten die verschillen verzonnen

Beide zijn gerepareerd en afgedekt in `scripts/checks/salessheet-pdf-lines.ts`.

Een partij waarvan de veilingkosten de opbrengst overtreffen drukt een negatieve
gemiddelde prijs af (`-0,022`). De kopregel eiste een prijs zonder teken, sloeg
door naar de prijs van de vólgende partij en slokte die partij helemaal op: op
`102115-396161.pdf` nam partij 3858159 het aangevoerde aantal en de regels van
3858160 over, en 3858160 kwam er niet uit.

Bij een levering over meerdere bladen herhaalt de factuurkop zich boven aan elk
blad, mét de leverdatum. Een regelmatch kon in die kop beginnen en doorlopen tot
de prijs van de eerste echte regel eronder — waarmee die regel verdween. Kanalen
dragen geen cijfers en de kop bestaat uit niets anders; dat is de scheiding.

Het aandeel partijen waarvan de regels optellen tot het aangevoerde aantal ging
van 96,0% naar 99,6%.

## Wat de vergelijking oplevert

Over het hele archief op test:

| | |
|---|---|
| afrekeningen gelezen | 4.041 |
| waarvan geen partijtabel herkend | 5 |
| partijen vergeleken | 46.151 |
| **komt overeen op de steel en de cent** | **45.793 (99,2%)** |
| wijkt af | 374 |
| **onverklaard** | **42**, bij 15 leveranciers |

De 42 onverklaarde gevallen zijn wat er te onderzoeken valt. Het grootste is
EUR 360; samen wegen ze EUR 173 (plus en min door elkaar). De rest heeft een naam:

| Reden | Partijen | Leveranciers | Stelen | Bedrag |
|---|---:|---:|---:|---:|
| partij heeft geen enkele transactie in de portal | 162 | 20 | −178.850 | −36.462,42 |
| orderregel bijgesteld na het printen van de afrekening | 86 | 21 | −17.922 | −6.828,95 |
| onverklaard | 42 | 15 | 15.745 | 173,34 |
| afrekening haalt een retour niet van de omzet af, de portal wel | 28 | 10 | −24.355 | −3.308,02 |
| verkoop geboekt na het printen van de afrekening | 23 | 8 | 12.305 | 969,20 |
| partij ontbreekt in de portal | 16 | 2 | — | — |
| verkoop staat onder een andere partij van dezelfde levering | 10 | 3 | 0 | 0,00 |
| partijcorrectie geboekt na de afrekening | 5 | 3 | 8.200 | −31,55 |
| partijcorrectie staat als eigen regel op de afrekening | 2 | 1 | −120 | −136,60 |

Verschil is *portal min afrekening*: negatief betekent dat de portal minder toont
dan het papier dat de kweker heeft. Bij de netto-opmaak blijft het bedrag leeg;
daar telt alleen het steelverschil.


## De mechanismen, en wat ze betekenen

### Partij zonder enkele verkoop in de portal

De afrekening verkoopt de partij, de portal heeft er geen enkele transactie bij
staan. Los van de PDF's gemeten: **299 partijen op afgerekende leveringen
dragen 232.135 aangevoerde stelen en geen enkele verkoop.**

Fabric heeft die verkopen deels wél. Van 299 `part_id`'s leverde
`marts.fct_orders` er 204 met orderregels terug, samen 34.550 afgerekende stelen
en EUR 4.070. Levering 20488 van PCXELHAI (13 juli 2026) is daarvan het grootste
blok: zes partijen, 30.550 stelen, EUR 3.735 — in Fabric aanwezig, in de portal
afwezig. Dat is een synchronisatiegat en met een backfill op te halen.

Voor de overige 95 partijen heeft `marts.fct_orders` niets. De afrekening die de
kweker in handen heeft, verkoopt ze wel. Dat is een vraag voor het datateam, geen
portalfout.

### Afrekening haalt een retour niet van de omzet af, de portal wel

Beide kanten kennen de correctie; ze verschillen over het geld. De afrekening
drukt zo'n regel af voor EUR 0,00 en laat de omzet staan; de portal boekt hem
tegen, stelen én bedrag.

Levering 2600593 (COLXLNFW) meet het uit: de afrekening telt EUR 3.909,90 omzet,
de portal EUR 1.809,90, de kosten zijn aan beide kanten EUR 1.085,07 tot op de
cent. Nettoresultaat op het blad EUR 2.824,83, in de portal EUR 724,84. Partij
3718394 laat het mechanisme zien: 8.000 stelen verkocht voor EUR 1.088, daarna
tegengeboekt onder reden 112 (*Return pick orders*), en de afrekening zet er
"Return: customer rejection −8.000 voor EUR 0,00" naast zonder de omzet aan te
raken.

**De kweker is op het blad afgerekend.** De portal laat hem EUR 2.100 minder
zien dan hij heeft ontvangen. Welke van de twee klopt is een vraag voor het
datateam; dat ze verschillen is een feit.

De tegenboekingen portalbreed, naar reden:

| Reden | Omschrijving | Regels | Stelen | Bedrag |
|---|---|---:|---:|---:|
| 54 | Return from customer due to inferior quality | 608 | −398.625 | −142.275,01 |
| 104 | Not returned, customer disposal | 1.106 | −210.918 | −111.240,76 |
| 56 | Not delivered | 140 | −29.407 | −40.722,42 |
| 65 | Too few delivered to customer | 236 | −11.776 | −5.379,72 |
| 93 | Return: buyback from customer | 52 | −19.440 | −4.626,90 |
| 112 | Return pick orders | 56 | −19.020 | −4.212,82 |
| 106 | Too many delivered to customer | 56 | −8.692 | −2.719,71 |
| 55 | Return: delivered too late | 18 | −24.420 | −2.707,40 |

### Verkoop staat onder een andere partij van dezelfde levering

Twee partijen die elkaar precies opheffen, op de steel en op de cent. Op levering
"cons 6" (PCFFARCO) komt partij 3595811 45.280 stelen en EUR 13.984,60 tekort en
heeft 3595812 precies dat te veel. Op leveringniveau valt het weg, dus de toets
op nettoresultaat ziet het nooit; een kweker die naar één partij kijkt ziet aan
beide kanten de verkeerde cijfers.

### Bijgesteld of verkocht na het printen

De orderregel is veranderd nadat het blad was gedrukt. De kweker houdt een
afrekening vast die de portal inmiddels tegenspreekt. Dit is hetzelfde
verschijnsel als in `docs/correcties-na-de-afrekening.md`, nu per partij
aanwijsbaar in plaats van als totaal.

## De kosten zijn niet de oorzaak — gemeten, niet beredeneerd

De voor de hand liggende verklaring voor een afwijkend nettoresultaat is dat de
kostenregels in de portal achterlopen op Fabric. Het warehouse herziet immers
kostenbedragen en het schuivende syncvenster komt er nooit op terug. Die
verklaring is op 1 september 2026 getoetst met een volledige backfill.

`scripts/repair-costs.ts --apply` over **alle 58 geactiveerde leveranciers, 244
kwartaalrondes, 1 januari 2025 tot heden** — de hele historie die de
testomgeving draagt. Elke ronde haalde de kostenregels opnieuw uit Fabric en
stuurde ze door `/api/import/costs`, die zowel bijwerkt als intrekt wat niet meer
in de payload zit.

**Bijgesteld: EUR 0,00. In alle 244 rondes.** De kostenregels in de portal komen
regel voor regel en cent voor cent overeen met wat Fabric vandaag zegt. Er is aan
die kant geen achterstand. (Vijf rondes vielen eerst uit op een leeg antwoord van
Fabric — hetzelfde verschijnsel dat onder *Querying Fabric* in `CLAUDE.md` staat,
waar een gefilterde query zonder foutmelding niets teruggeeft. De guard weigerde
terecht; na herhaling gaven ze gewoon hun 247, 658, 779, 992 en 362 regels.)

Daarmee verschuift de vraag. Het verschil zit niet tussen Fabric en de portal maar
tussen Fabric en het gedrukte document. Van de 219 afwijkende leveringen:

| | Leveringen |
|---|---:|
| verschil zit puur op de omzet | 152 |
| verschil zit puur op de kosten | 60 |
| beide, of geen kosten uit de PDF gelezen | 7 |

Van die 60 zijn er 30 van de laatste twee maanden — de afrekening is gedrukt, de
kostenregels staan nog niet in Fabric, en dat lost zichzelf op. Van de andere 30
is er precies één die groot en verklaarbaar is: **COLOZFL C656** draagt in de
portal (en in Fabric) een regel *Vrachtkosten Herkomstland* van EUR 899,42 die
niet op de afrekening staat, en het hele gat is EUR 894,87. De rest loopt van
EUR 4 tot EUR 70 en is per stuk niet aan één kostenregel toe te wijzen.

De 152 aan de omzetkant zijn het verhaal van de partijen en orderregels hierboven.
Geen enkele kostenronde raakt die.

`scripts/export-turnover-differences.ts` doet hetzelfde voor de omzet
(`private_input/omzetverschillen.xlsx`): 250 leveringen boven een cent, samen
EUR 28.441, met elke partij van die leveringen op een tweede tabblad. De 229
leveringen met de netto-opmaak worden overgeslagen — die drukken geen bruto-omzet
af, dus daar valt niets te vergelijken. Elk verschil krijgt een klasse uit de
database, zonder de PDF te lezen: **84 leveringen (EUR 9.586) waar de tegenboekingen
het gat precies dekken** — het retourmechanisme hierboven, en de grootste
samenhangende groep — 15 met een partij zonder enkele verkoop, 3 waar het gat precies
één partij groot is, 39 met tegenboekingen die het gat niet dekken, en 109 die aan
niets zijn toe te wijzen, waarvan er 30 boven een euro uitkomen.

`scripts/export-cost-differences.ts` zet alle leveringen met een kostenverschil in
een werkboek (`private_input/kostenverschillen.xlsx`), met een drempel van één cent
in plaats van de euro van de nettocontrole: 348 leveringen, samen EUR 49.292, met de
kostenregels van elke levering op een tweede tabblad. Daarvan zijn er 280 centenwerk,
35 boven een euro, 29 nog wachtend op hun kostenregels en 4 zonder regels. Twee
patronen springen eruit: leveringen waar precies één regel het hele gat is — COLOZFL
C656 met *Vrachtkosten Herkomstland* EUR 899,42 en COLXLNFW 2600377 en 2600419 met
*Verwerkingskosten* — en acht leveringen van COLXLNFB waar de afrekening stelselmatig
EUR 23 tot EUR 108 méér kosten afdrukt dan de portal berekent, telkens met twee
`VERW_INK`-regels en zonder dat het gat aan één ervan gelijk is.

## Wat er nog niet klopt in de portal

### Kosten die er nog niet zijn, maken het nettoresultaat te hoog

**32 leveringen dragen EUR 44.991 aan kosten op de PDF en EUR 0,00 in de portal.**
28 daarvan zijn van de laatste twee weken van augustus 2026; slechts 4 (samen EUR
103) zijn ouder dan zestig dagen. Het is dus een kwestie van tijd, niet van
verdwenen data: de afrekening wordt gedrukt voordat de kostenregels in de mart
staan.

Ondertussen liegt het scherm. PCFUSA levering 10555 toont een nettoresultaat van
EUR 12.505,67 waar de kweker EUR 4.284,80 zal ontvangen. Even zo voor 10562 (EUR
14.230,79 tegen EUR 5.449,19) en 10574 (EUR 11.335,65 tegen EUR 3.174,37).

De statuslogica weet dit al — zonder kostenregels is een levering niet
*Completed* — maar het nettoresultaat wordt er gewoon naast gezet alsof het
definitief is. Voorstel: toon het nettoresultaat van een levering zonder
kostenregels niet als eindbedrag, of zet er zichtbaar bij dat de kosten nog
ontbreken.

### Een tegenboeking zag eruit als een verkoop *(opgelost)*

De partijpagina beloofde in haar eigen type zeven velden die `Transaction` niet
heeft: `isCorrection`, `correctionType`, `qualityCode`, `qualityNote` en
`s1`/`s2`/`s3`. Alle zeven waren `undefined`. Een tegenboeking werd daardoor als
gewone verkoop getoond en drie kolommen bleven altijd leeg. Partij 3695766 liet
1.260, −1.260 en 900 stelen zien, alle drie als "Persoonlijk", zonder dat iets
verried dat de eerste twee tegen elkaar wegvallen. `bronFeitExtra` is wat ze
onderscheidt.

### De reden van een correctie stond er als nummer *(opgelost)*

`CorrectionReasonCode` draagt de namen al, in het Nederlands en het Engels. De
partijpagina drukte het nummer af: "22" waar de tabel *Verwerking: te weinig in
doos* zegt — dezelfde gebeurtenis die de afrekening afdrukt als "Handling: less
in box". De pagina zoekt de naam nu op, in de taal van de lezer.

De partijcorrecties portalbreed, naar reden:

| Reden | Omschrijving | Aantal | Volume |
|---|---|---:|---:|
| 22 | Processing: too few in box | 7.824 | −486.638 |
| 23 | Processing: too many in box | 2.584 | 240.542 |
| 95 | Inventory correction shortage | 1.326 | −148.260 |
| 29 | Processing: quality | 1.208 | −639.698 |
| 107 | Processing: different product/length in box | 1.146 | −102.084 |
| 47 | Too few delivered | 668 | −295.423 |
| 96 | Inventory correction surplus | 642 | 103.551 |
| 48 | Too many delivered | 481 | 243.701 |
| 99 | Return: rejection by customer | 462 | 423.358 |
| 110 | Poor Quality | 419 | −117.896 |

## Het werkboek

`private_input/verzoening-regelniveau.xlsx`, vijf tabbladen:

| Tabblad | Wat erin staat |
|---|---|
| **Onverklaard** | De verschillen die in geen bekend patroon passen, grootste bedrag eerst. Hier naar kijken. |
| **Alle verschillen** | Alles, inclusief de verklaarde. Filterbaar op reden. |
| **Per leverancier** | Eén regel per leverancier: aantal verschillen, waarvan onverklaard, en het saldo. |
| **Niet nagelopen** | De afrekeningen die niet zijn gelezen, met de reden. |
| **Samenvatting** | De cijfers hierboven, plus hoe de kolommen te lezen. |

Elke rij draagt leverancier, kweker, levering, ons factuurnummer, leverdatum,
factuurdatum van de PDF, partijnummer en product. Verschil is altijd *portal min
afrekening*: positief betekent dat de portal meer telt.

## Opnieuw draaien

```bash
npx tsx scripts/recon-salessheet-lines.ts --blob
npx tsx scripts/recon-salessheet-lines.ts --limit=200      # proefje
```

Zonder `--blob` worden alleen bestanden uit `private_input/salessheets` gelezen;
mét `--blob` wordt opgehaald wat daar niet staat. De parser zelf is afgedekt door
`scripts/checks/salessheet-pdf-lines.ts`, dat meeloopt in `npm run check`.
