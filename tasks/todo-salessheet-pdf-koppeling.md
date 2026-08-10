# Fix: verkeerd gekoppelde salessheet-PDF's

> **Aanleiding:** `docs/reconciliatie-pcfup-colbfl.md` §5 — 8 van de 242 gecontroleerde PDF's zijn
> aan een andere levering gekoppeld. Kwekers kunnen daardoor een salessheet downloaden die niet bij
> hun levering hoort.

## Oorzaak

Twee importstappen botsen op elkaar:

1. `src/app/api/import/lots/route.ts:208-211` — `SalesSheet.invoiceNumber` is globaal `@unique`,
   terwijl KBT's `factnum` per jaar recyclet. Bij een botsing plakt de import `-${parthdrId}`
   achter het nummer: de salessheet "95" van 2026 wordt opgeslagen als `95-2254938`.
2. `src/app/api/shipments/import-email/route.ts:163-180` — het koppelen doet
   `findUnique({ where: { invoiceNumber: reference } })` met reference `"95"`. Dat treft altijd de
   eerst geïmporteerde salessheet en nooit die met het achtervoegsel.

Vandaar het patroon: factuurnummer klopt, jaar niet.

## Aanpak

De leverdatum uit de PDF als controle gebruiken. In de reconciliatie waren alle 170 koppelingen
die op factuurnummer plus leverdatum tot stand kwamen correct.

- [x] 1. `salessheet-pdf-parser.ts`: leverdatum extraheren
      Coördinaatgebaseerde aanpak overgenomen uit `scripts/recon-01-match-pdfs.js`: waarde rechts
      van het label. Twee sjablonen: "Deliverydate" (Engels) en "Datum levering" (Nederlands).
      Alleen dat laatste label toevoegen bracht de onleesbare datums van 637 naar 166 van 4.630.
- [x] 2. `import-email/route.ts`: koppelen met verificatie
- [x] 3. Verificatiescript tegen de echte PDF-corpus (4.630 bestanden)
- [x] 4. Herstelscript voor de bestaande foute koppelingen
- [x] 5. `npm run build` + lint + `tsc --noEmit`
- [ ] 6. PR naar `develop`

## Wat er is gebouwd

**`src/lib/salessheet-pdf-parser.ts`** — `ParsedSalesSheetPdf` heeft er een veld `deliveryDate`
bij (`YYYY-MM-DD`, of `null`). De waarde wordt op coördinaat naast het label gelezen, niet
regelgewijs: de kop van de salessheet staat in twee kolommen, waardoor een regelgewijze lezing
ongerelateerde waarden aan elkaar plakt. Bestaande reference-logica ongemoeid gelaten.

**`src/app/api/shipments/import-email/route.ts`** — koppelen in drie stappen:

1. Kandidaten verzamelen: `invoiceNumber = reference`, de `^reference-\d{5,}$`-varianten die de
   lots-import aanmaakt, en salessheets met hetzelfde `ourInvoiceNumber`.
2. Beperken tot de leverancier uit de bestandsnaam, mits dat kandidaten overlaat.
3. Alleen koppelen bij een exacte match op de leverdatum van de PDF. Delen twee kandidaten die
   datum, dan geeft ons eigen salessheetnummer de doorslag: een salessheet die al een ánder
   nummer draagt hoort bij een andere PDF.

Geen leesbare datum en precies één kandidaat → koppelen zoals voorheen, dus geen regressie op de
bestanden waar de oude methode al goed werkte. Meerdere kandidaten zonder datum → weigeren.
Weigeringen krijgen een sprekende reden (`date_mismatch:`, `ambiguous:`, `ambiguous_no_date:`) die
in de ingestion-log terechtkomt.

`ourInvoiceNumber` is bewust géén zelfstandige sleutel. De acht koppelingen uit
`reconciliatie-pcfup-colbfl.md` §5 waren juist via dat veld gelegd: een verkeerd gekoppelde PDF
schreef zijn eigen nummer op de salessheet, waardoor het veld de fout bevat die we willen vangen.

**`scripts/verify-salessheet-pdf-matching.ts`** — draait oude en nieuwe methode naast elkaar over
de corpus. **`scripts/fix-salessheet-pdf-links.ts`** — controleert bestaande koppelingen tegen de
leverdatum op de PDF en verplaatst of verbreekt ze; standaard dry-run, schrijft pas met `--apply`.

## Verificatie

Alle 4.630 PDF's in `private_input/salessheets` tegen 7.668 salessheets in de testdatabase:

| uitkomst | aantal |
|---|---|
| beide methoden dezelfde koppeling | 2.082 |
| beide geen koppeling | 2.280 |
| **hersteld — nieuwe methode wijst een andere salessheet aan** | **183** |
| **foute koppeling geweigerd** | **84** |
| regressie (oud goed, nieuw weigert) | **0** |
| nieuw koppelt waar oud niets vond | 1 |
| leverdatum onleesbaar | 166 |

Nul gevallen waarin de nieuwe methode koppelt aan een salessheet met een afwijkende leverdatum —
dat is de eigenschap waar het om gaat. De 166 onleesbare datums zijn grotendeels geen salessheets
maar duurzaamheidsrapportages en losse documenten in dezelfde mappen.

De fout blijkt veel breder dan de 8 uit de reconciliatie, die alleen over PCFUP en COLBFL ging. En
hij is ernstiger: `13-370932.pdf` hing aan salessheet "13" van **COLXSHA** terwijl de PDF van een
andere kweker is. Het is dus niet alleen een verkeerd jaar maar ook een lek tussen leveranciers.

`npm run build`, `npx eslint` en `npx tsc --noEmit` slagen.
