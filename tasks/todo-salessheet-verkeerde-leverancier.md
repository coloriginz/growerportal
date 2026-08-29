# Salessheet-PDF's gekoppeld aan de levering van een andere leverancier

> **Kern:** 45 van de 3.892 gekoppelde salessheets dragen een PDF waarvan de bestandsnaam een
> ándere leverancierscode noemt dan de leverancier van de afrekening. De kweker kan dus de
> afrekening van een concurrent downloaden.
>
> **Status:** oorzaak gevonden en in de basisroutes gerepareerd op 29-08-2026; 83 foute koppelingen
> losgemaakt op test, waar nu nul koppelingen fout zijn. **Op productie staan er nog 67 fout.** Wat nog openstaat staat onderaan. Dit is dezelfde klasse als §5 van
> `docs/reconciliatie-pcfup-colbfl.md`, maar nu portalbreed geteld — en die 45 uit de kop zijn
> alleen de gevallen die je aan de bestandsnaam ziet; de volledige audit vond er 83.

---

## Omvang

| levering | PDF van | aantal |
|---|---|---|
| PCFRUT | COLXROOD | 19 |
| COLSEMPC | PCXRONEN | 9 |
| COLXSHA | COLXROOD | 6 |
| PCFUP | PCXRONEN | 6 |
| overig (5 combinaties) | | 5 |

Voorbeeld: `PCXRONEN - 07_06_2026 08_45_00 - 124 - 406550.PDF` hangt aan shipment **124** van
**COLSEMPC**.

Dit is de ondergrens: de telling herkent alleen de rijke Power Automate-bestandsnaam, waar de
leverancierscode vooraan staat. De digits-only vorm (`135-23-380914.pdf`) en de losse vorm dragen
die code niet, dus daar is een verkeerde koppeling niet aan de naam te zien.

## Bewijs: de zes PCFUP-uitschieters zijn allemaal verkeerd gekoppeld

De drieweg-recon van 27 augustus hield twaalf leveringen over met een omzetverschil boven EUR 50,
waarvan zes PCFUP-leveringen uit februari en maart 2025 die samen vrijwel het hele verschil
droegen. Alle zes blijken een PDF te dragen die niet bij die levering hoort:

| shipment | leverancier op de PDF | PDF-leverdatum | portal-leverdatum | soort fout |
|---|---|---|---|---|
| 47 | Shachlav Flowers, Israël | 07-02-2026 | 06-02-2025 | andere leverancier |
| 53 | Flora United (PCFUP) | 12-02-2026 | 09-02-2025 | verkeerd jaar |
| 56 | Flora United (PCFUP) | 15-02-2026 | 13-02-2025 | verkeerd jaar |
| 90 | Flora United (PCFUP) | 05-03-2026 | 06-03-2025 | verkeerd jaar |
| 95 | Saidi-Ronen, Israël | 06-03-2026 | 09-03-2025 | andere leverancier |
| 113 | Semperflora, Zuid-Afrika | 19-01-2026 | 20-03-2025 | andere leverancier |

**Fabric en de portal hadden dus gelijk.** Bij alle twaalf uitschieters lopen die twee tot op de
cent gelijk; het verschil zat in het document waartegen werd afgezet.

Dit verklaart ook waarom PCFUP in 2026 Q1 maar 23% dekking heeft: de PDF's van 2026 hangen aan de
leveringen van 2025. Shipment 53 van 2026 (leverdatum 12-02-2026) staat in de portal zonder PDF,
terwijl `53-397168.pdf` — zíjn afrekening — aan shipment 53 van 2025 hangt. De 2026-PDF's zijn
opgesoupeerd door de 2025-leveringen.

## Oorzaak — gevonden op 29-08-2026

**Eerste analyse was fout.** Ik dacht dat de koppelroute de leverancierscode uit de bestandsnaam
negeerde. Dat doet hij niet: hij bakent er wel degelijk op af, en hij controleert ook de leverdatum.
De echte oorzaak zit een laag dieper.

`salessheet-pdf-parser.ts` las de leverdatum *positioneel* — het tekstitem rechts van het label
"Deliverydate" / "Datum levering", op basis van de `transform`-coördinaten van elk item. De
referentie en het factuurnummer werden regel-gebaseerd gelezen. Vielen die coördinaten weg, dan
kwamen referentie en factuurnummer er gewoon uit maar de datum niet, en dan sloeg de route de
datumcontrole over en koppelde op het nummer alleen.

Dat gebeurde structureel op twee plekken:

1. **Op Vercel** ontbrak `/api/shipments/import-email` in `outputFileTracingIncludes`, waardoor de
   route pdfjs helemaal niet had. Elke parse faalde daar.
2. **Bij het koppelen in porties** viel de positionele uitlezing om: hetzelfde bestand los verstuurd
   gaf `date_mismatch:13:2025-01-04`, in een portie van veertien gaf het `ambiguous_no_date`.

En het bleef onzichtbaar doordat de route een falende parse opving met een lege `catch`. De
weigeringsreden werd `ambiguous_no_date` — dat klinkt als een eigenschap van het document, terwijl
het een storing in onze code was.

## Wat er gerepareerd is

- [x] `next.config.ts`: `/api/shipments/import-email` toegevoegd aan `outputFileTracingIncludes`.
- [x] `salessheet-pdf-parser.ts`: `doc.destroy()` onder `try/finally`, zodat een mislukte PDF de
      volgende niet meesleept.
- [x] `salessheet-pdf-parser.ts`: terugval op regel-gebaseerde datumherkenning als de positionele
      leesmethode niets geeft. Alleen bij precies één kale `DD-MM-JJJJ` op de pagina — de
      factuurdatum draagt een tijd en valt dus af. Meerdere kandidaten betekent geen datum, want
      liever geen koppeling dan een gegokte.
- [x] `import-email/route.ts`: onderscheid tussen `pdf_unreadable` (onze storing, met foutmelding),
      `pdf_empty` (parse gaf geen enkel veld) en `ambiguous_no_date` (document zonder datum).
- [x] `link-salessheet-pdfs.ts`: nog vier bestanden per verzoek in plaats van twintig.
- [x] `scripts/audit-salessheet-links.ts`: nieuwe controle die elke koppeling terugleest en met
      `--apply` losmaakt wat niet klopt. Met `--check-urls` ook of het bestand in de blobopslag nog
      bestaat — een downloadknop die nergens heen gaat is erger dan geen knop.

## Nog open

- [ ] **Waarom de route omvalt vanaf zes bijlagen in één verzoek.** Gemeten: 1 en 3 werken, 6, 10 en
      14 geven HTTP 500 met een lege body. De verlaging naar vier bestanden per verzoek is een
      marge, geen verklaring. Daarvoor is de console van de dev-server nodig op het moment dat zo'n
      verzoek binnenkomt.
- [ ] **449 koppelingen zijn niet te controleren** tegen het lokale archief: die PDF's kwamen via de
      e-mailstroom binnen en staan alleen in de blobopslag. Om ook die te auditen moet het script de
      blob downloaden in plaats van het archief te lezen.

      **Deze blinde vlek heeft aantoonbaar een lek verborgen — 29-08-2026.** Levering INT000072 van
      COLXAFRI droeg `COLXOLE - 06_18_2026 07_45_00 - INT000072 - 405644.PDF`, de afrekening van Ole
      Engai Growers, met `Document.supplierId` op COLXAFRI en één actief account daar. De audit kon
      hem niet zien: het bestand staat niet in `private_input/salessheets`, en de audit leest het
      archief. Gevonden langs een heel andere weg — via de leveranciertoewijzing in Fabric, zie
      `todo-levering-verkeerde-leverancier.md`. Daarmee is dit punt geen opruimwerk meer maar de
      vraag hoeveel van die 449 hetzelfde probleem dragen; niemand weet dat nu.

      **Opgelost in het script, en toen gemeten — 29-08-2026.** `audit-salessheet-links.ts` heeft
      nu `--blob` (haalt bestanden op die niet in het archief staan) en draagt de leverancierscode
      uit de bestandsnaam als aparte aanwijzing in het rapport.

      Uitkomst op **test**: alle 4.024 leesbare koppelingen kloppen op leverdatum. Nul fout. De 35
      koppelingen waarvan de bestandsnaam een andere leverancier noemt, kloppen dus gewoon — de
      code in de naam is een aanwijzing en geen bewijs, en alleen daarop losmaken zou 35 goede
      koppelingen hebben gesloopt. Daarom staat die groep apart in het rapport en wordt hij niet
      losgemaakt.

      Uitkomst op **productie** (read-only nagerekend, 433 koppelingen, elk bestand uit de blob
      gehaald en uitgelezen): **67 koppelingen wijzen naar de verkeerde PDF**, geverifieerd op de
      leverdatum in het document zelf — steevast maanden tot een jaar naast de levering. Bij het
      merendeel noemt de bestandsnaam óók een andere leverancier (COLXROOD op PCFRUT, COLXBAK op
      COLXSHA, PCXRONEN op PCFUP, COLBUGL op PCFUP). 365 kloppen, 1 blob onbereikbaar.

      Productie heeft de reparatie van 29-08 dus nog niet gehad: daar is dit lek live. Het losmaken
      vraagt een expliciete beslissing, want het is een productiewijziging.

## Waarom dit meer weegt dan een verkeerd bestand

Elke andere fout in deze reeks ging over bedragen die niet klopten. Deze gaat over wie wát mag
zien: een leverancier krijgt een downloadknop naar de afrekening van een ander, met diens omzet,
kosten en kwekersnamen erin. Dat is een lek, geen afwijking.

## Bijvangst

Bij het uitzoeken bleek `private_input/recon-pdf-data.json` (de PDF-uitlezing van augustus 2026)
leverdatums te dragen die er een jaar naast zitten: PDF 398227 heet daar 06-03-2026 terwijl de
levering in de portal op 09-03-2025 staat. De koppeling PDF ↔ levering klopt wel — de portal heeft
exact hetzelfde bestand aan die levering hangen. Alleen de datumkolom uit dat bestand is onbruikbaar.
`scripts/recon-pdf-fabric-portal.ts` toont daarom de leverdatum van de portal en die van de PDF
naast elkaar.
