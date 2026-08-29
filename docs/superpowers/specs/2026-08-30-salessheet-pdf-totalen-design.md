# De sales sheet naast de berekening leggen

> **Kern:** de portal berekent omzet, kosten en nettoresultaat uit orderregels en
> kostenregels. De sales sheet-PDF die de kweker krijgt, drukt diezelfde bedragen
> af. Die twee horen gelijk te zijn en niets controleert dat. Dit ontwerp leest de
> bedragen uit de PDF, slaat ze op naast de berekende, en leidt daar een oordeel uit af.
>
> **Status:** ontworpen 30-08-2026, goedgekeurd, in aanbouw.

---

## Waarom

De portal leidt `SalesSheet.totalTurnover`, `totalCosts` en `netResult` af uit wat
de import binnenhaalt. Alles wat daar misgaat — een ingetrokken orderregel, een
nulregel die het warehouse pas weken later vult, een hernummerde `shkost_id` —
verschuift die getallen zonder dat er iets omvalt. Elke fout uit de afgelopen weken
was van die soort: niets kapot, alleen bedragen die te laag of te hoog stonden, en
alleen te vinden door iemand die toevallig een sales sheet ernaast legde.

De sales sheet is de enige onafhankelijke bron die de portal al in huis heeft. Hij
is niet uit dezelfde gegevens afgeleid — hij komt uit het factuursysteem — en hij
is wat de kweker daadwerkelijk heeft gekregen. Als die twee uiteenlopen is er iets
mis, en welke van de twee fout is doet er voor de signalering niet toe.

## Wat de proef uitwees

800 PDF's uit `private_input/salessheets` gelezen (29-08-2026), 743 Engels en 57
Nederlands, nul onleesbaar.

| | |
|---|---|
| Omzet uit de PDF gehaald | 100% |
| Nettoresultaat rechtstreeks gelezen | 100% |
| Kostentotaal gelezen | 86,4% — de rest heeft geen kostenregel, en dat *is* nul |
| Netto exact gelijk aan de portal | 81,1% |
| Verschil onder EUR 1 | 13,4% |
| Verschil vanaf EUR 1 | 5,5% |

Drie dingen die het ontwerp bepalen:

**Het netto is de enige grootheid die aan beide kanten hetzelfde betekent.** Bij een
all-in-levering (`isInclusief`, 241 van 7.878) drukt de sales sheet alleen het netto
af en heeft hij geen kostenregels, terwijl de portal bruto omzet én kosten apart uit
Fabric heeft. Omzet met omzet vergelijken levert daar duizenden euro's schijnverschil
op. Het label `To be received by supplier` staat er echter wél, met hetzelfde bedrag —
dus de controle heeft de all-in-vlag helemaal niet nodig.

**De bedragen staan vóór hun label.** `EUR 2.370,30 Total nett turnover`, niet andersom.
Alleen bij de kosten staat het bedrag erachter: `Total costs EUR 873,57`. Dat is hoe
pdfjs de tabelcellen uitrolt.

**De controle vindt meteen echte fouten.** Een deel van de grote verschillen heeft de
vorm `pdf +1.350,16` tegen `portal -1.350,17`: leveringen waar de portal wel kosten
heeft maar geen omzet. De kweker heeft dat geld gekregen; de portal toont het
tegenovergestelde.

## Wat we bouwen

### 1. Vier kolommen op `SalesSheet`

```prisma
pdfTurnover  Decimal?  @db.Decimal(12, 2)  // "Total nett turnover" / "Totale netto omzet"
pdfCosts     Decimal?  @db.Decimal(12, 2)  // "Total costs" / "Totale kosten"
pdfNetResult Decimal?  @db.Decimal(12, 2)  // "To be received by supplier" / "Te ontvangen door leverancier"
pdfParsedAt  DateTime?
```

Zelfde precisie als de berekende totalen, zodat een vergelijking geen precisieverschil
kan uitvinden.

`pdfParsedAt` draagt geen bedrag en is toch onmisbaar: zonder dat veld zijn "nog nooit
gelezen" en "gelezen, maar er stond niets" allebei `null`, en dan is een parserprobleem
niet van een leeg document te onderscheiden.

Omzet en kosten worden opgeslagen maar dragen geen oordeel. Ze bestaan om te kunnen
zien wáár een verschil zit als het netto uiteenloopt. Bij een all-in-levering zeggen ze
niets — daar is `isInclusief` relevant, puur om te weten dat je ze moet negeren.

### 2. De extractie, in de bestaande parser

`src/lib/salessheet-pdf-parser.ts` opent de PDF al voor de leverdatum. Dezelfde tekst
levert de drie bedragen, dus het kost geen extra werk per document. `ParsedSalesSheetPdf`
krijgt er drie velden bij.

Labels in beide talen, met het bedrag ervóór behalve bij kosten:

| bedrag | Engels | Nederlands |
|---|---|---|
| omzet | `Total nett turnover` | `Totale netto omzet` |
| kosten | `Total costs` | `Totale kosten` |
| netto | `To be received by supplier`, `To be paid by supplier`, `Nett payable / receivable to/from OZ import` | `Te ontvangen door leverancier`, `Te betalen door leverancier` |

Bedragen staan in Nederlandse notatie (`1.763,10`) en negatieve bedragen tussen haakjes
(`(EUR 193,78)`).

**De btw-regel op Nederlandse sales sheets.** Binnenlandse leveranciers krijgen btw
bovenop het netto: `54,00 EUR 654,00 BTW: NETTO RESULTAAT INCL. BTW`. Het vergelijkbare
bedrag is dat vóór de btw — `Te ontvangen door leverancier` — nooit het bedrag bij
`NETTO RESULTAAT INCL. BTW`. Dat label staat daarom níét in de lijst hierboven.

### 3. Het oordeel, als pure functie

`src/lib/salessheet-match.ts`:

```ts
resolveSalesSheetMatch({ pdfNetResult, pdfParsedAt, hasPdf, computedNetResult })
  -> "match" | "mismatch" | "unread" | "unlinked"
```

- `unlinked` — er hangt geen PDF aan deze levering. Niets te zeggen.
- `unread` — er hangt er een, hij is gelezen (`pdfParsedAt` gevuld), maar er kwam geen
  netto uit. Dat is onze storing en hoort als zodanig zichtbaar te zijn.
- `match` / `mismatch` — het verschil ligt onder of boven de drempel.

Vier uitkomsten en geen `null`, om dezelfde reden als bij `resolveShipmentStatus()`:
een afwezig antwoord en een negatief antwoord zijn verschillende dingen en horen niet
op dezelfde waarde uit te komen.

**Drempel: EUR 1**, als geëxporteerde constante zodat hij in één regel te verzetten is.
Onderbouwing: 13,4% van de leveringen wijkt onder een euro af, en dat is de bekende
afronding — `SalesSheetCost.amount` draagt vijf decimalen en de sales sheet telt op vóór
hij afrondt. Op nul verdrinkt het signaal in centen; op tien mis je echte kleine fouten.

Het oordeel wordt afgeleid en nooit opgeslagen. Herrekent de import de totalen — en dat
doet elke ronde — dan verschuift het oordeel automatisch mee. Een opgeslagen verschil zou
verouderen op precies de momenten dat het ertoe doet.

### 4. Schrijven en wissen

Schrijven gebeurt in `/api/shipments/import-email`, op het moment van koppelen. Dat is
de enige plek waar een PDF aan een levering wordt vastgeknoopt; de backfill loopt langs
dezelfde route.

**Wissen gebeurt overal waar `pdfDocumentId` op null gaat.** Dit is geen detail. Op
29-08-2026 bleef `ourInvoiceNumber` staan nadat een foute PDF was losgemaakt, waardoor de
levering het factuurnummer van een andere bleef dragen. Blijft `pdfNetResult` van een
verkeerde PDF staan, dan levert dat een blijvende valse mismatch op — een signaal dat naar
zichzelf wijst. De vier velden gaan mee in `scripts/audit-salessheet-links.ts` en in
`verwijderLeveringen()` in de lots-route.

Een mislukte parse zet wél `pdfParsedAt` en laat de bedragen leeg, en houdt de koppeling
nooit tegen: de leverdatum beslist of er gekoppeld wordt, de bedragen zijn bijvangst.

### 5. Tonen

`/api/admin/shipment-issues` krijgt een derde type naast `missing-pdf` en `stem-gap`:
`pdf-mismatch`. Het endpoint heeft al paginering, zoeken en een typefilter.

Die route bouwt zijn query als `Prisma.Sql`-object en geeft dat als argument mee in plaats
van als tagged template. Dat is noodzaak, geen stijl: met een genest fragment breekt de
SWC-compilatie van Next hem en antwoordt Postgres met `42601 syntax error at or near "$1"`.
Die vorm blijft.

De rij toont beide bedragen en het verschil, zodat je zonder doorklikken ziet welke kant
op het uiteenloopt.

### 6. De inhaalslag

`scripts/backfill-pdf-totals.ts`, dry-run standaard, in de vorm van
`audit-salessheet-links.ts`: werklijst is elke levering met een PDF en zonder
`pdfParsedAt`; het bestand komt uit het lokale archief of met `--blob` uit de opslag.

Zonder deze slag dekt de controle op productie vrijwel niets — daar hangt 4,6% van de
leveringen aan een PDF en er komen er weinig bij. Op test gaat het om ~3.600 documenten,
op productie om 364.

### 7. Testen

`scripts/checks/salessheet-match.ts` dekt de pure functie: de vier uitkomsten, de drempel
precies op en net over een euro, een negatief resultaat, en het gespiegelde geval
(`pdf +1.350` tegen `portal -1.350`) dat de proef opleverde.

Belangrijker is de labelherkenning, want daar gaat het stuk als een lay-out verandert —
zoals in augustus met `marts.fct_salesheets_costs` gebeurde. Daarom worden een handvol
**echte tekstfragmenten** als fixtures vastgelegd: Engels, Nederlands, een all-in-levering
en een Nederlandse met btw-regel. Zo is de extractie te toetsen zonder PDF-bestanden.

## Buiten scope

**Bedragen op regelniveau.** De PDF drukt per partij en per orderregel bedragen af, en die
zijn tegen `Lot` en `Transaction` te leggen. Veel grotere klus, veel kleinere opbrengst: een
verschil op regelniveau komt vrijwel altijd terug in het netto.

**Iets doen met een mismatch.** De uitkomst is een signaal voor intern, meer niet. Hij
blokkeert de leveringsstatus niet en is niet zichtbaar voor de kweker. Dat kan later, als
blijkt hoe vaak en waarom het afwijkt.

## Volgorde van uitvoeren

1. Schema uitbreiden, `prisma db push` naar test
2. Parser uitbreiden + fixtures vastleggen
3. `salessheet-match.ts` + check
4. Koppelroute schrijft de velden; loskoppelen wist ze
5. `shipment-issues` uitbreiden + scherm
6. Inhaalslag schrijven en op test draaien
7. Meten wat eruit komt, en de drempel toetsen aan wat er dan zichtbaar wordt

Productie krijgt de schemawijziging en de inhaalslag pas na akkoord; zonder `db push` daar
zou een merge naar `main` een ontbrekende kolom opleveren.
