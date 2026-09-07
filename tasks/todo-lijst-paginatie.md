# Paginatie voor Shipments en Lots

> **Aanleiding:** een kweker miste zijn levering van 2 mei 2025. Die stond gewoon in de
> database — `/api/shipments` haalde `take: 200` op zonder paginatie, en voor
> SCXGOLFW (Del Golfo, 422 afrekeningen) valt rij 200 exact op 26-11-2025. 222
> leveringen onzichtbaar. Veertien leveranciers zitten boven de 200.
> `/api/lots` heeft dezelfde cap.

## Wat er mis is, precies

1. **De lijst kapt stilzwijgend af.** Geen paginatie, geen telling, geen melding.
   Een lijst die afkapt zonder het te zeggen leest als "meer is er niet".
2. **Zoeken en filteren gebeuren client-side** over de opgehaalde 200. Zoeken op
   een afrekening buiten die 200 geeft "geen resultaten" — wat leest als
   "bestaat niet".
3. **De CSV-export exporteert diezelfde 200.** Wie de historie van een
   leverancier exporteert, krijgt zonder waarschuwing een afgekapt bestand.

Punt 3 is de reden dat de export mee moet in deze wijziging: paginatie zonder
export-fix maakt de export juist erger (dan is het één pagina in plaats van 200).

## Ontwerp

**Shipments.** De status is afgeleid (`resolveShipmentStatus`) uit drie
aggregaten, dus server-side op status filteren vraagt die aggregaten over de
hele scope — en dan is een `LIMIT` in SQL niets goedkoper, want Postgres moet
voor het totaal en het filter tóch alles aggregeren. Daarom: één ruwe query die
per afrekening de drie getallen meegeeft, `resolveShipmentStatus` in JS als
enige definitie, en filteren/sorteren/snijden in JS.

Gemeten (test, warm): 100–150 ms voor de grootste leveranciers — goedkoper dan
de huidige `take: 200` met includes (214 ms).

| leverancier | afrekeningen | transacties | query |
|---|---|---|---|
| MPFLAN | 526 | 7.602 | 99–113 ms |
| COLXLNFW | 514 | 22.785 | 136–145 ms |
| COLBFL | 224 | 21.780 | 123–255 ms |

**Lots.** `Lot.status` staat opgeslagen, dus gewone Prisma-paginatie met
`skip`/`take` + `count`.

**Sorteren op een unieke sleutel.** `deliveryDate` is niet uniek, dus overal
`{ id: "asc" }` erachter (CLAUDE.md: anders geeft `OFFSET` een rij op twee
pagina's of op geen).

## Taken

- [x] Meten: kost van de aggregatie per leverancier
- [x] `/api/shipments`: `page`/`limit`/`search`/`status`, respons `{ items, page, totalPages, total }`
- [x] `/api/lots`: idem, filter en zoek in de `where`
- [x] Gedeelde `ListPagination` (bereikregel + paginakiezer), vertaald
- [x] i18n-sleutels EN/NL
- [x] `shipments-content.tsx` omzetten: paginastate, debounce, geen client-side filter meer
- [x] `lots-content.tsx` idem
- [x] CSV-export over de hele gefilterde verzameling in plaats van de pagina
- [x] Geen fetch zonder `supplierId` (het scherm toont daar toch de leverancierskiezer)
- [x] `npm run check` + `npm run build`
- [x] CLAUDE.md: de API-tabel beweert nu al "with pagination" voor beide routes — dat werd hiermee pas waar

## Review

Gebouwd zoals ontworpen. Wat het oplevert, gemeten door de draaiende route heen
(SCXGOLFW, Del Golfo):

| | voor | na |
|---|---|---|
| bereikbare afrekeningen | 200 | 422 (9 pagina's) |
| oudste zichtbare levering | 26-11-2025 | 01-01-2025 |
| zoeken op C00003576 | niets gevonden | 1 resultaat, 02-05-2025 |
| partijen | 200 | 4.211 (85 pagina's) |

Drie dingen die onderweg bleken:

- **De aggregatie over de hele scope is goedkoper dan wat hij vervangt.** Dat was
  niet de verwachting: één query die álle afrekeningen van een leverancier
  aggregeert klinkt duurder dan er 200 ophalen. Maar de oude route haalde bij die
  200 ook alle partijen en kostenregels op. Warm: 100–150 ms tegen 214 ms.
- **Sorteren op alleen `deliveryDate` had rijen laten verdwijnen.** De datum is
  niet uniek — bij SCXGOLFW staan er twee leveringen op 24-11-2025, precies op
  de oude grens. Nagemeten met `id` erachter: alle 422 en alle 4.211 rijen komen
  over alle pagina's samen exact één keer voor.
- **De invulling van `{from}-{to}` moest in één pass.** De eerste versie
  vervangde per waarde, waardoor een ingevulde waarde opnieuw als plaatshouder
  kon worden gelezen. Met getallen kan dat niet misgaan, maar de check die ik
  ervoor schreef viel er meteen over, dus is het nu één regex-pass.

**Niet gedaan, bewust:** een leverancier van `commercie` mag nog steeds elke
`supplierId` opvragen zonder scope-controle — dat stond zo in beide routes en
staat er nog. Het is een aparte kwestie, geen paginatie.

**Niet visueel gecontroleerd:** de Chrome-extensie kreeg `localhost` niet te
pakken (de tab bleef op `chrome://newtab`). De routes zijn end-to-end door de
draaiende Next-server geprikt en de vertaalsleutels van de voetregel staan in
`scripts/checks/list-pagination.ts`, maar de opmaak van de voetregel zelf is nog
niet met eigen ogen gezien.
