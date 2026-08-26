# Een kweker kan bij meerdere leveranciers horen, het model kan dat niet

> **Kern:** 1.364 kwekers in `marts.fct_partijen` leveren via meer dan één `rel_id_leverancier`.
> Dat is geen datafout maar de werkelijkheid: één kwekerij verhandelt via meerdere relaties. Het
> portalmodel kan het niet aan — `Grower.fabricId` is globaal uniek en `Grower.supplierId` is één
> verplicht veld, dat bij het aanmaken één keer wordt gezet en daarna nooit meer bijgewerkt.
>
> **Status:** gemeten 26-08-2026, niet opgelost. Vraagt een modelbeslissing, geen bewaking.

---

## Wat er misgaat

De kweker krijgt de leverancier van de orderregel die hem toevallig het eerst aanmaakte
(`growerPairs` in `src/app/api/import/orders/route.ts`, een `Map.set` waar de laatste wint; het
aanmaakpad zet `supplierId` en het bijwerkpad raakt alleen de naam aan).

**Wat er níet misgaat: er lekt geen data.** `/api/sales` bakent partijen af op `Lot.supplierId` en
zoekt de kwekernaam pas daarna op id op. De omzetcijfers zijn dus van de juiste leverancier.

**Wat er wél misgaat: de kwekerfilter is onvolledig.** `src/app/api/sales/filters/route.ts:19`
bakent de lijst af op `Grower.supplierId`. Levert kweker G via leverancier A én B, dan staat G maar
bij één van beide in de filterlijst; de ander kan niet op zijn eigen kweker filteren. Ook de
kwekerteller op het aggregaat-dashboard (`src/app/api/dashboard/route.ts:297`) telt langs dezelfde
scheve as.

## Eerst: hoe groot is het echt?

1.364 gedeelde kwekers in Fabric is de bovengrens, niet de last. Wat telt is hoeveel leveranciers
in de portal er daadwerkelijk een filteroptie door missen. Beide vragen zijn portalkant en kosten
seconden — draai ze voordat je een van de opties kiest.

- [ ] **Hoeveel partijen hangen aan een kweker die aan een ándere leverancier is gestempeld?**
      ```sql
      SELECT COUNT(*) FROM "Lot" l JOIN "Grower" g ON g.id = l."growerId"
      WHERE g."supplierId" <> l."supplierId";
      ```
- [ ] **Hoeveel leveranciers raakt dat, en om hoeveel kwekers gaat het per leverancier?**
      ```sql
      SELECT l."supplierId", COUNT(DISTINCT l."growerId") AS kwekers, COUNT(*) AS partijen
      FROM "Lot" l JOIN "Grower" g ON g.id = l."growerId"
      WHERE g."supplierId" <> l."supplierId"
      GROUP BY l."supplierId" ORDER BY 2 DESC;
      ```
- [ ] Raakt het één of twee leveranciers met een handvol kwekers, dan is dit een randgeval en kan
      het blijven liggen. Raakt het de helft, dan is de filterlijst structureel onbetrouwbaar en
      weegt de migratie ruim op tegen het ongemak.

## De beslissing

- [ ] **Optie A — een `Grower` per kweker per leverancier.** `@@unique([fabricId, supplierId])` in
      plaats van `fabricId @unique`. Sluit aan op wat de code al aanneemt (`Lot.growerId`, filteren
      op `supplierId`) en houdt de filterlijst kloppend. Kost een migratie: bestaande kwekers
      splitsen en de partijen naar de juiste rij herwijzen.
- [ ] **Optie B — `Grower` globaal maken en `supplierId` laten vallen.** Conceptueel het zuiverst:
      een kwekerij ís niet van een leverancier. Vraagt dat de filterlijst via de partijen wordt
      afgeleid (`SELECT DISTINCT growerId FROM Lot WHERE supplierId = ?`) in plaats van via een
      kolom op `Grower`. Raakt drie plekken en geen migratie van rijen, wel van betekenis.

Optie B is waarschijnlijk de juiste — het probleem is dat het model een relatie als eigenschap
opslaat — maar het is een beslissing over wat een kweker *is*, en die hoort niet in een importronde
genomen te worden.

## Waarom hier geen bewaking op zit

De twee andere tegenspraken (`gemengdeLeveringen` in de lots-import, `supplierMismatch` in de
orders-import) komen in de bron nul keer voor; dat zijn vangnetten die niets kosten. Deze komt
1.364 keer voor en is legitiem. Elke ronde melden zou ruis zijn, geen signaal — het model moet
veranderen, niet de import.
