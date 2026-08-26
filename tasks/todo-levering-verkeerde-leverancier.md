# Leveringen onder de verkeerde leverancier — gemeten en structureel opgelost

> **Kern:** Fabric is de bron voor de toewijzing van een levering aan een leverancier. De portal
> volgde hem daar niet in: `Lot.supplierId` en `SalesSheet.supplierId` werden bij het bijwerken
> nooit meegeschreven, dus eenmaal onder een leverancier aangemaakt verhuisde een levering nooit.
>
> **Status:** gemeten en gerepareerd op 26-08-2026. Eén geval wacht op een beslissing.

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
- **INT000072** (18-06-2026, 8 partijen) staat onder COLXAFRI, Fabric geeft hem aan relatie 29778,
  **Ole Engai Growers**, die in de portal geen leverancier is. Zie hieronder.

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
eerstvolgende lots-ronde over dat venster. Ook voor Ole Engai — activeren is genoeg, de verhuizing
gebeurt daarna vanzelf.

## Wat nog openstaat

- [ ] **Beslissing over INT000072.** Is Ole Engai Growers een eigen leverancier die geactiveerd moet
      worden, of een kweker die onder COLXAFRI hoort? Zolang dit niet is beslist ziet COLXAFRI acht
      partijen die volgens Fabric niet van hem zijn. Activeren lost het op zonder verder werk.
- [ ] **`reattributedAway` tonen in het overgeslagen-paneel.** Het staat nu in `details` en is dus
      terug te vinden, maar het paneel leest alleen `skippedSuppliers`. Deze melding verdient een
      eigen regel, want hij vraagt om een andere handeling dan "misschien een kweker aanmaken".
- [ ] **De 9 leveringen die niet in `fct_partijen` voorkomen.** Onderzocht is dit niet. Kandidaten:
      partijen die uit het warehouse zijn verwijderd, of afrekeningen die de portal ooit zonder
      partijen heeft aangemaakt.
