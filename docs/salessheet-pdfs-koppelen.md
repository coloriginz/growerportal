# Salessheet-PDF's koppelen aan afrekeningen

> Bijgewerkt: 20 augustus 2026. Beschrijft `scripts/link-salessheet-pdfs.ts`: het hulpmiddel dat een
> lokale map met salessheet-PDF's koppelt aan afrekeningen die nog geen PDF hebben.

## Waarvoor dit bestaat

De portal heeft twee wegen waarlangs een salessheet-PDF binnenkomt. De gewone weg is de e-mailstroom:
Power Automate stuurt een mail met bijlagen naar `POST /api/shipments/import-email`, die de PDF leest,
de afrekening zoekt en het `Document` aanmaakt. Daarnaast ligt er een historisch archief van duizenden
PDF's op schijf, in `private_input/salessheets`. Dit script duwt dat archief door precies dezelfde
route.

Dat is een bewuste keuze. De koppeling wordt beslist door de leverdatum die op de PDF staat — zie
`processAttachment` in `src/app/api/shipments/import-email/route.ts`. Zou het script zelf koppelen,
dan bestonden er twee opvattingen over wat een geldige koppeling is, en de tweede is altijd degene die
vergeten wordt bij te werken.

## Draaien

```bash
npx tsx scripts/link-salessheet-pdfs.ts                     # dry run: rapporteert, schrijft niets
npx tsx scripts/link-salessheet-pdfs.ts --limit=20 --apply  # eerst een proefje van 20 bestanden
npx tsx scripts/link-salessheet-pdfs.ts --apply             # de echte run
```

**Dry run is de standaard.** Zonder `--apply` gaat er geen enkel verzoek uit. Dat is de veilige stand,
want een echte run schrijft naar Vercel Blob en die bytes komen er niet vanzelf weer uit.

| Optie | Betekenis |
|---|---|
| `<map>` | wortelmap met PDF's, recursief doorzocht. Standaard `private_input/salessheets`. |
| `--apply` | verstuur echt. |
| `--limit=N` | verstuur hooguit N bestanden. |
| `--api-base=URL` | doelportal. Standaard `$API_BASE`, anders de testomgeving. |
| `--batch-bytes=N` | maximum aan base64 per verzoek. Standaard 3.000.000. |
| `--report=PAD` | rapportbestand. Standaard `private_input/link-salessheet-pdfs-<datum>-<tijd>.json`. |

Nodig in `.env`: `DATABASE_URL` (Neon HTTP-driver) en `IMPORT_API_KEY`. `API_BASE` bepaalt naar welke
omgeving je schrijft; laat hem weg en je schrijft naar test.

## Wat de dry run laat zien

```
Found 4630 PDF file(s).
Portal: 7788 sales sheet(s), 5290 without a PDF, 2498 file name(s) already attached.

Classification:
  already_linked           2074
  to_send                  1592
  no_free_sales_sheet       798
  unreadable_name           166

To send: 1592 file(s), 239.0 MB raw (318.7 MB base64) in 116 request(s).
Largest request: 2.995.408 base64 bytes over 14 file(s); measured body 2.997.158 bytes (67% of the 4.5 MB Vercel limit).
```

De vier oordelen:

- **`already_linked`** — een `Document` met exact deze bestandsnaam hangt al aan een afrekening.
- **`to_send`** — de referentie uit de bestandsnaam hoort bij minstens één afrekening zonder PDF.
- **`no_free_sales_sheet`** — er is een referentie gelezen, maar geen afrekening zonder PDF die erbij
  past. Meestal een PDF van een levering die de portal niet heeft.
- **`unreadable_name`** — uit de bestandsnaam valt geen referentie te halen. In het huidige archief
  zijn dit 83 losse `<nummer>.pdf` en 83 `duurzaamheidsrapportage_<nummer>.pdf`; dat laatste zijn
  duurzaamheidsrapportages en geen salessheets.

Het rapport in `private_input/` bevat per bestand het oordeel, de gelezen referentie en — na een echte
run — wat de route ermee gedaan heeft (`linked`, `skipped` met reden, of `failed`).

## Waarom het herhaalbaar is

Het script matcht eerst en verplaatst pas daarna bytes. Het leest alleen bestandsnamen, vraagt de
database welke referenties nog een afrekening zonder PDF hebben, en verstuurt uitsluitend die
bestanden. Dat maakt hem idempotent op twee manieren:

- **Tweede run zonder dat er iets veranderd is:** wat gekoppeld raakte staat inmiddels in
  `already_linked` en wat geen vrije afrekening heeft in `no_free_sales_sheet`. Er blijft niets over.
- **Halverwege afgebroken:** de al gekoppelde bestanden vallen bij de volgende run vanzelf af, de rest
  gaat alsnog mee. Er is geen voortgangsbestand nodig; de database is de voortgang.

De controle op bestandsnaam (`already_linked`) staat er náást de controle op vrije afrekeningen, en
niet in plaats daarvan. Afrekeningnummers hergebruiken per jaar, dus referentie `13` heeft vaak vijf
afrekeningen naast zich waarvan er één de PDF al heeft. Zonder de naamcontrole zou `13-370932.pdf`
elke run opnieuw meegaan om elke run opnieuw op de datumcontrole te stranden.

## Opnieuw beginnen na een flush van de datatabellen

Gaan de datatabellen vóór livegang leeg en worden de afrekeningen opnieuw uit Fabric geladen, dan zijn
de `Document`-rijen ook weg en hangt er nergens meer een PDF. Er is dan niets bijzonders te doen:

1. Laat de import de afrekeningen opnieuw opbouwen (`suppliers → growers → lots → orders → costs`).
2. Draai de dry run en kijk of het aantal `to_send` klopt met het aantal afrekeningen zonder PDF.
3. Draai met `--apply`.

De oude blobs van vóór de flush blijven achter in Vercel Blob zonder dat er nog een `Document` naar
wijst. Dat kost opslag maar breekt niets; opruimen kan later.

## Porties

De body gaat als base64 en wordt daarmee een derde groter dan de PDF's zelf, en Vercel kapt een
request af rond 4,5 MB. Het script vult daarom porties op grootte en niet op aantal: 3 MB base64 per
verzoek, met daarnaast een plafond van 20 bestanden omdat de route per bijlage een PDF parseert en een
blob-upload doet. De dry run meet de zwaarste portie ook echt op, inclusief JSON-omhulling, zodat een
te krappe limiet niet pas bij verzoek 80 blijkt.

`src/app/api/shipments/import-email/route.ts` draagt daarom `maxDuration = 300`, net als de
import-routes onder `src/app/api/import/`.

## De bestandsnaam-parser

`src/lib/salessheet-filename-parser.ts` kent drie vormen, in deze volgorde geprobeerd:

1. **rijk** — `COLCICE - 04_23_2026 00_15_00 - 212-28 - 401546.PDF`: leverancier, leverdatum,
   referentie en ons factuurnummer.
2. **simpel** — `135-23-380914.pdf`: alleen cijfers en streepjes.
3. **ruim** — `C002 Blom-371364.pdf`, `CL00125-371114.pdf`, `OZ250072-378954.pdf`: alles ná het
   laatste streepje is ons factuurnummer als het uit minstens vier cijfers bestaat, alles ervóór is de
   referentie, letters en spaties toegestaan.

Die derde vorm is in augustus 2026 toegevoegd. Daarvóór eiste de simpele vorm `/^\d[\d-]+\d$/` en
vielen 1.387 archiefbestanden categorisch af, terwijl ze alle 1.387 op een bestaande
`SalesSheet.invoiceNumber` aansluiten. De ruime regel is losser dan strikt nodig — hij leest ook een
bestand dat toevallig op `-<vier cijfers>` eindigt — en dat mag, omdat de bestandsnaam maar een
aanwijzing is: koppelen gebeurt pas na een treffer in de database én een exacte match op de leverdatum
uit de PDF. De afwegingen staan uitgeschreven bij `parseSalesSheetFilenameLoose`.

`scripts/checks/salessheet-filename.ts` bewaakt alle drie de vormen en draait mee in `npm run check`.
