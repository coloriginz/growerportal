# Leveringen onder de verkeerde leverancier — gemeten en structureel opgelost

> **Kern:** Fabric is de bron voor de toewijzing van een levering aan een leverancier. De portal
> volgde hem daar niet in: `Lot.supplierId` en `SalesSheet.supplierId` werden bij het bijwerken
> nooit meegeschreven, dus eenmaal onder een leverancier aangemaakt verhuisde een levering nooit.
>
> **Status:** gemeten en gerepareerd op 26-08-2026. Het laatste geval is op 29-08-2026 afgehandeld,
> met een omgekeerde ontwerpkeuze: een levering die Fabric elders toeschrijft wordt nu verwijderd
> in plaats van gemeld.

---

## De meting

Alle 7.879 leveringen met een `parthdr_id` vergeleken: `rel_id_leverancier` uit
`marts.fct_partijen` tegen de leverancier van de `SalesSheet`.

| | |
|---|---|
| komt overeen | 7.868 |
| **wijkt af** | **2** |
| niet (meer) in `fct_partijen` | 9 |
| leveringen met partijen van meer dan één leverancier | 0 |

Die laatste regel is de belangrijkste: de toewijzing is per levering eenduidig, dus "volg Fabric"
is een goed gedefinieerde regel en geen keuze per partij.

De twee afwijkingen:

- **19883 Van Dijk** (12-06-2026) stond onder MDHAGED, Fabric geeft hem aan MDHAGE — beide bestaan
  in de portal. **Opgelost**: de import heeft hem verplaatst, afrekening én partij staan nu onder
  MDHAGE.
- **INT000072** (18-06-2026, 8 partijen) stond onder COLXAFRI, Fabric geeft hem aan relatie 29778,
  **Ole Engai Growers**, die in de portal geen leverancier is. **Opgelost op 29-08-2026**: de
  levering is uit de portal gehaald. Zie "De keuze die is teruggedraaid".

## De structurele fix

In `src/app/api/import/lots/route.ts`:

1. **`SalesSheet.supplierId` gaat mee** in de bijwerking én in de `ON CONFLICT`. Bestaande
   afrekeningen lopen langs het bijwerkpad, dus alleen de `ON CONFLICT` aanpassen doet niets — dat
   was de eerste poging en die verplaatste niets.
2. **`Lot.supplierId` en `Lot.salesSheetId` gaan mee**, op dezelfde twee plekken en om dezelfde
   reden. De partij volgt zijn afrekening.
3. **Wegverhuizen naar een onbekende relatie wordt gemeld.** Wordt een partij overgeslagen omdat de
   leverancier ontbreekt en heeft de portal die levering al, dan is dat geen onbekende relatie maar
   een herbestemming. Dat komt apart in `ImportBatch.details.reattributedAway`, in de vorm
   `{ relId: { leveringen, van: [leverancierscodes] } }`. Geverifieerd op een ongescopete ronde over
   18-06-2026: `{"29778":{"van":["COLXAFRI"],"leveringen":1}}`.

Botsen op `(lotNumber, supplierId)` kan in theorie wanneer een partij verhuist. Gemeten over 67.393
partijen komt geen enkel partijnummer bij twee leveranciers voor, dus dat risico is theoretisch.

**Vanaf nu corrigeert het zichzelf**: past Fabric een toewijzing aan, dan volgt de portal bij de
eerstvolgende lots-ronde over dat venster.

## De keuze die is teruggedraaid — 29-08-2026

Punt 3 hierboven was half. "Melden en laten staan" berustte op de gedachte dat het activeren van de
relatie de verhuizing vanzelf zou regelen. Dat zet de zaak op zijn kop: het maakt het opschonen van
Africalla's beeld afhankelijk van een beslissing over een ándere partij, waar Africalla part noch
deel aan heeft. Africalla en Ole Engai zijn niet gerelateerd — de een is leverancier, de ander niet —
en de toewijzing was ooit een invoerfout die in de bron is rechtgezet.

Het was bovendien niet alleen een verkeerd getal. De gekoppelde PDF heet
`COLXOLE - 06_18_2026 07_45_00 - INT000072 - 405644.PDF`: de afrekening staat zelf op naam van Ole
Engai en stond in de portal onder `Document.supplierId` van COLXAFRI, dat één actief account heeft.
Een inzagelek op de omzet, kosten en prijzen van een derde.

De regel is daarom omgedraaid en symmetrisch gemaakt met wat de route al deed bij het binnenkomen:
**hoort de levering volgens Fabric bij een relatie die de portal niet voert, dan voert de portal die
levering niet.** Partijen en het gekoppelde document gaan expliciet mee (ze cascaderen geen van
beide vanzelf). `planReattributionRemoval()` in `src/lib/sync/reattribution.ts` draagt de beslissing
plus een bovengrens van 25 leveringen per ronde; daarboven wordt er niets verwijderd en wel gemeld,
want zoveel herbestemmingen tegelijk wijzen op een kapotte ronde en niet op een gecorrigeerde bron.
Gedekt door `scripts/checks/reattribution.ts`. Melden blijft: naast `reattributedAway` nu ook
`reattributedRemoved` en `reattributedKept`.

Toegepast door de partijen van relatie 29778 door `/api/import/lots` te sturen, zodat de reparatie
meteen het bewijs is dat de route werkt: `reattributedRemoved: 1`, COLXAFRI van 256 naar 255
leveringen, 3.484 naar 3.476 partijen, 249 naar 248 documenten, nul losgekoppelde partijen. De
portalbrede hercontrole over alle 7.878 leveringen geeft nu nul afwijkingen.

Wordt Ole Engai later alsnog als leverancier aangemaakt, dan haalt een backfill de levering gewoon
opnieuw op — dan onder de juiste naam.

## Wat nog openstaat

- [x] ~~Beslissing over INT000072.~~ Afgehandeld op 29-08-2026: de levering is uit de portal
      gehaald, los van de vraag of Ole Engai ooit leverancier wordt. Die vraag staat daarmee niet
      langer iets in de weg.
- [ ] **De blob van het verwijderde document opruimen.** De `Document`-rij is weg, de PDF staat nog
      in de blobopslag onder een url die nergens meer wordt getoond. Een blob weggooien vanuit een
      importroute is een onomkeerbare nevenwerking, dus dat is bewust een losse handeling.
- [ ] **`reattributedAway` tonen in het overgeslagen-paneel.** Het staat nu in `details` en is dus
      terug te vinden, maar het paneel leest alleen `skippedSuppliers`. Deze melding verdient een
      eigen regel, want hij vraagt om een andere handeling dan "misschien een kweker aanmaken".
- [ ] **De 9 leveringen die niet in `fct_partijen` voorkomen.** Onderzocht is dit niet. Kandidaten:
      partijen die uit het warehouse zijn verwijderd, of afrekeningen die de portal ooit zonder
      partijen heeft aangemaakt.
