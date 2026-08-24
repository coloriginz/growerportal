# Ontwerp: portal-gestuurde sync, backfill en onboarding

> **Status:** ontwerp, nog niet gebouwd.
> **Datum:** 15 augustus 2026
> **Vervangt:** de architectuur uit
> [2026-08-15-sql-sync-en-backfill-design.md](2026-08-15-sql-sync-en-backfill-design.md) (§4, §5 en §8).
> Dat document blijft gelden voor de testladder T1–T5, de onderbouwing van de endpoint-volgorde en de
> analyse van correcties buiten het venster.
> **Voortgekomen uit:** T5 slaagde op 15 augustus. Daarmee verviel de vraag *of* de portal de regie kan
> voeren, en werd de vraag *hoeveel* regie.

---

## 1. Wat dit oplost

Vier dingen aan de keten zoals die nu draait.

1. **Het schema staat op de verkeerde plek.** Power Automate vuurt elke vier uur. Wil je dat wijzigen,
   dan moet je de flow in. Staat hij stil, dan merkt de portal er niets van — een `ImportBatch`
   ontstaat pas als er data binnenkomt, dus geen run betekent geen spoor.
2. **De query's staan buiten versiebeheer.** Ze leven in de Power Automate-UI. Wie ze wil aanpassen
   moet die UI in, wat betekent dat een bugfix in de query handwerk is en dat niemand achteraf kan
   zien wat er precies gedraaid heeft.
3. **Backfill is handwerk.** CSV's exporteren uit Power BI, in `private_input/PBI/backfill` zetten,
   `scripts/backfill.ts` draaien. Niet herhaalbaar, niet in te plannen, en het script bevat een
   hardgecodeerde API-sleutel (`scripts/backfill.ts:23`).
4. **Een leverancier aanzetten levert een lege portal op.** Er is geen mechanisme om de historie van
   één leverancier alsnog op te halen. Dat is precies wat er nodig is op het moment dat een kweker
   toegang krijgt.

---

## 2. Het uitgangspunt

**De portal voert de regie, Power Automate voert uit.** Power Automate weet niet wát het ophaalt en
niet waaróm — het krijgt een query, draait hem, en duwt het resultaat naar het adres dat erbij zit.
Alle kennis over vensters, volgorde, tempo en filters zit in de portal, in code, in de repo.

Dat is geen esthetische voorkeur. Het levert drie dingen op die anders niet kunnen:

- een query aanpassen is een commit, geen handwerk in een UI
- een backfill voor één leverancier is een `WHERE`-clausule, geen nieuwe flow
- wat er gedraaid heeft is terug te vinden, want de query is opgebouwd door versiebeheerde code

---

## 3. Genomen beslissingen

| onderwerp | keuze | overweging |
|---|---|---|
| **Regie** | portal bouwt de query, Power Automate voert uit | zie [§2](#2-het-uitgangspunt) |
| **Klok** | Vercel Cron elke 5 minuten → `POST /api/sync/tick` | Vercel Pro, dus die frequentie mag. Een gemiste tick is onschadelijk: de volgende pakt het op |
| **Terugweg** | asynchroon; Power Automate post naar `/api/import/<endpoint>` | de portal wacht nergens op en kan niet omvallen door een trage query |
| **Uitzondering** | een tweede flow beantwoordt kleine vragen synchroon | nodig voor `MIN(levering_datum)` en rijtellingen vooraf. Zie [§6](#6-de-twee-flows) |
| **Frequentie** | één ketting, twee schema's: korte ronde en nachtronde | volgorde blijft gegarandeerd omdat het één doorloop is |
| **Query-opslag** | TypeScript-functies in `src/lib/sync/queries/` | bestanden onder `scripts/` zijn niet leesbaar vanuit een Vercel-functie. Zie [§7](#7-de-querys) |
| **Backfill-venster** | eerst `MIN(levering_datum)` opvragen, dan brokken maken | haalt precies de historie die bestaat |
| **Brokgrootte** | de portal hakt, per maand | beantwoordt het open punt uit §8 van het vorige ontwerp |
| **Omgeving** | vlag `env` in de payload, afgeleid van de deployment | Power Automate houdt twee base-URL's en kiest. Zie [§6](#het-contract) |
| **Tempo** | hoogstens één job tegelijk onderweg | volgt uit de volgorde-eis; geen aparte rem nodig |

---

## 4. Architectuur

```
Vercel Cron (elke 5 minuten)
   |
   +-> POST /api/sync/tick                                    [portal]
          |  1. is er een ronde due volgens SyncSchedule?
          |  2. zo ja: zet de endpoints als SyncJobs klaar
          |  3. pak de volgende job, bouw de SQL
          |  4. ruim vastgelopen jobs op
          |
          +-> POST <flow: haal op>                            [Power Automate]
          |      { env, endpoint, batchId, query }
          |      <- 202 Accepted, direct
          |         |
          |         |  SQL op wh_transform
          |         |
          |         +-> POST <base voor env>/api/import/<endpoint>
          |                { <endpoint>: [...], batchId }     [portal]
          |                   upsert, ImportBatch afronden, job op done
          |
          +-> POST <flow: vraag>                              [Power Automate]
                 { env, query }
                 <- 200 met de rijen, synchroon
```

De **tick** is het enige onderdeel dat een schema kent. Hij draait elke vijf minuten en doet meestal
niets: kijken of er iets due is, en zo niet weer weg.

Verwar zijn frequentie niet met die van de rondes. De tick is de hartslag; `SyncSchedule` bepaalt wat
er daadwerkelijk draait. Bij een korte ronde van een uur betekent dat hoogstens vijf minuten speling,
en die vijf minuten zijn ook de bovengrens waarmee een vastloper wordt opgemerkt — de drempel van
vijftien minuten uit [§10](#10-foutafhandeling-en-tempo) veronderstelt dat de tick vaker langskomt dan
die drempel.

**Vercel Cron draait op UTC.** `atTime` in `SyncSchedule` staat in Europe/Amsterdam, dus de tick
rekent om. Anders verschuift de nachtronde een uur bij de overgang naar wintertijd.

De tick is afgeschermd met `CRON_SECRET`, zoals Vercel het aanlevert in de `Authorization`-header.

De **wachtrij** is waar de volgorde en het tempo in zitten. Eén job is één endpoint over één venster,
eventueel gefilterd op één leverancier. Dat ene model dekt alle drie de gevallen:

| geval | jobs |
|---|---|
| korte ronde | `lots`, `orders`, `costs` over het rollende venster |
| nachtronde | alle vijf, in volgorde |
| onboarding | alle vijf, per maand gehakt, met `rel_id_leverancier` als filter |

---

## 5. Datamodel

```prisma
model SyncJob {
  id               String    @id @default(uuid())
  runId            String    // groepeert de jobs van één ronde
  sequence         Int       // volgorde binnen die ronde
  endpoint         String    // suppliers | growers | lots | orders | costs
  windowFrom       DateTime
  windowTo         DateTime
  supplierFabricId Int?      // alleen bij onboarding
  source           String    // schedule | nightly | backfill
  status           String    // pending | dispatched | done | failed | cancelled
  attempts         Int       @default(0)
  importBatchId    String?
  lastError        String?
  createdAt        DateTime  @default(now())
  dispatchedAt     DateTime?
  completedAt      DateTime?

  @@index([status, createdAt])
  @@index([runId, sequence])
}

model SyncSchedule {
  name         String    @id   // "short" | "nightly"
  enabled      Boolean   @default(true)
  intervalMin  Int?            // korte ronde: elke N minuten
  atTime       String?         // nachtronde: "03:00" in Europe/Amsterdam
  endpoints    String[]        // welke endpoints, in volgorde
  windowDays   Int             // hoe ver het rollende venster terugkijkt
  lastRunAt    DateTime?
}
```

`SyncSchedule` krijgt precies twee regels. Dat is het instelscherm.

`windowDays` staat hier expliciet, want tot nu toe zat het venster verstopt in de query en was het
nergens vastgelegd — het punt dat in het vorige ontwerp openstond.

**Waarom niet het bestaande `Setting`-model:** dat is een platte `key`/`value`-tabel waarvan de API
alleen in de testomgeving werkt (`isTest`-guard) en geen rolcheck heeft. Daar hoort geen
productiefunctionaliteit op.

### De koppeling tussen heen- en terugweg

Nu maakt elke import-route zijn eigen `ImportBatch` aan zodra er data binnenkomt. Een run bestaat dus
pas als hij slaagt, en stilte is onzichtbaar.

Straks maakt de portal de batch aan bij het versturen, geeft het id mee, en gebruikt de import-route
dat id in plaats van een nieuwe te maken. Komt er niets terug, dan staat er een openstaande batch met
een job ernaast die na vijftien minuten op `failed` gaat.

`batchId` is **optioneel**. Zonder id doet de route precies wat hij nu doet, zodat de oude DAX-flows
en de nieuwe keten naast elkaar kunnen draaien tijdens de overstap.

---

## 6. De twee flows

Power Automate krijgt twee flows en verder niets.

| flow | trigger | inhoud | antwoord |
|---|---|---|---|
| **vraag** | When an HTTP request is received | SQL-actie + Response-actie | de rijen, synchroon |
| **haal op** | idem | SQL-actie + HTTP-post naar de portal | `202 Accepted`, direct |

**vraag** is bedoeld voor één regel antwoord: `MIN(levering_datum)` voor een leverancier, of een
rijtelling vóór een grote brok. De portal wacht daarop, en dat mag omdat het antwoord per definitie
klein is. Deze flow post nergens naartoe, dus `env` heeft er geen routerende betekenis; hij gaat mee
zodat de run-historie van beide flows op dezelfde manier te lezen is.

**Klein antwoord is niet hetzelfde als goedkope vraag.** Op 16 augustus liep een `COUNT(*)` met een
rekenkundige vergelijking over `marts.fct_orders` sinds 1 juli in een 504 na ruim twee minuten — één
regel antwoord, maar een volledige scan eronder. Systeemviews doen hetzelfde: `INFORMATION_SCHEMA.COLUMNS`
en `.TABLES` geven allebei een 502 door deze connector; kolommen opzoeken gaat met `SELECT TOP 1 *` en
dan naar de sleutels kijken. Voor de onboarding-backfill betekent dit: `MIN(levering_datum)` gefilterd
op één leverancier is prima, maar een telling over de hele tabel niet. Begrens elke vraag op een
leverancier of een periode, of laat hem via de haal-flow lopen.

**haal op** verplaatst alle echte data. De portal wacht nooit.

### Het contract

```json
{
  "env": "test",
  "endpoint": "costs",
  "batchId": "3f7a…",
  "query": "SELECT shkost_id AS \"Shkost ID\", … FROM marts.fct_salesheets_costs WHERE …"
}
```

**`env` bepaalt waar de rijen heen gaan.** Power Automate houdt twee base-URL's vast en kiest:

```
env = test        ->  https://growerportal.test.apps.coloriginz.com
env = production  ->  https://growerportal.apps.coloriginz.com
```

De portal stuurt dus nooit een URL mee. Zou hij dat wel doen, dan kan iedereen met de webhook-URL
Power Automate laten posten waar hij maar wil. Nu is het een witte lijst die in Power Automate zelf
vastligt.

**`env` komt uit de omgevingsvariabele van de deployment en is nooit een parameter van de aanroep.**
Anders kan één verkeerde call testdata naar productie duwen. Lokale ontwikkeling (`development`)
verstuurt niets: de tick draait daar in dry-run en logt wat hij zou doen, want Power Automate kan
`localhost` toch niet bereiken.

**`endpoint` wordt in de flow gecontroleerd.** Omdat het pad uit de call komt, hoort er een
`Condition` in die het toetst aan de vijf toegestane waarden en anders afbreekt. Zonder die controle
kan iemand met de webhook-URL laten posten naar een willekeurig pad onder de base-URL, mét de
import-sleutel eronder. Veel schade is dat niet — andere routes eisen een sessie — maar het is één
actie om de deur te sluiten.

### Wat dit betekent voor de webhook-URL's

Twee flows, twee URL's, per omgeving dezelfde (de flows bedienen beide omgevingen via `env`). Ze
horen in de Vercel-env-vars als `PA_WEBHOOK_ASK_URL` en `PA_WEBHOOK_FETCH_URL`, en nergens anders.
De testflow uit T5 is wegwerp; zijn handtekening wordt geroteerd.

---

## 7. De query's

Per endpoint één functie in `src/lib/sync/queries/`:

```typescript
export function costsQuery({ from, to, supplierFabricId }: QueryWindow): string {
  return `
    SELECT shkost_id AS "Shkost ID", parthdr_id AS "Parthdr ID", …
    FROM marts.fct_salesheets_costs
    WHERE levering_datum >= '${isoDate(from)}'
      AND levering_datum <  '${isoDate(to)}'
      ${supplierFabricId ? `AND rel_id_leverancier = ${Number(supplierFabricId)}` : ""}
  `;
}
```

**Waarom geen `.sql`-bestanden.** Het vorige ontwerp wees `scripts/sql/sync-<endpoint>.sql` aan als
bron van waarheid. Dat werkt niet: een Vercel-functie kan niet zomaar bestanden van het filesystem
lezen — dezelfde reden waarom de e-maillogo's base64 in de code staan. Er is een uitweg via
`outputFileTracingIncludes`, maar die is fragiel en je merkt het gemis pas op productie.

Het principe blijft overeind: de query staat in de repo, is te reviewen in een diff, en te wijzigen
zonder Power Automate aan te raken.

**De parameters zijn getypeerd, niet tekstueel.** Geen plaatshouders die vervangen worden, maar
argumenten. Die `Number()` om `supplierFabricId` is het enige wat tussen een leveranciers-id en
willekeurige SQL staat, en daarom staat hij daar.

**De kolomnamen krijgen aliassen met spaties** (`AS "Shkost ID"`), zoals nu. Dat mag: sinds `c053418`
decodeert `canonicalKey()` de `_x0020_`-codering die de SQL-connector eroverheen legt. Aliassen naar
`shkost_id` mag ook — beide komen aan.

---

## 8. De ketting en de volgorde

```
suppliers -> growers -> lots -> orders -> costs
```

Dit is een harde afhankelijkheid. `lots` zoekt de leverancier op via `Supplier.fabricId` en **slaat de
partij stilzwijgend over** als die niet bestaat. Zo raakten COLXROOD en COLXBAK 317 salessheets kwijt.

De wachtrij dwingt dit af: een job wordt pas verstuurd als de vorige in dezelfde ronde `done` is. De
volgorde is daarmee geen afspraak meer maar een eigenschap van het systeem.

### Twee schema's

| ronde | endpoints | frequentie |
|---|---|---|
| kort | `lots`, `orders`, `costs` | elk uur (instelbaar) |
| nacht | alle vijf | 's nachts, één keer |

Stamdata verandert zelden; elk uur 673 leveranciers en 2.799 kwekers ophalen is verspilling.

**Dit is veilig omdat het venster rollend is.** Verschijnt er overdag een nieuwe leverancier in
Fabric, dan gooit `lots` zijn partijen weg. Maar zodra de nachtronde de leverancier heeft aangemaakt,
valt diezelfde partij de volgende korte ronde nog stééds binnen het venster en komt hij alsnog
binnen. Het herstelt zichzelf, **zolang `windowDays` ruimer is dan de tijd tussen twee nachtrondes**.
Bij 45 dagen tegen 24 uur is dat met grote marge het geval.

**Er is ook een bovengrens, en die is hard.** Op 18 augustus kwam de nachtronde niet meer rond: de
orders-query leverde 15.229 rijen over acht dagen en Power Automate kwam daarmee simpelweg niet terug —
geen foutmelding, geen 202-met-nasleep, de job bleef op `dispatched` tot de opruimer hem na een kwartier
terugzette. Gemeten: 6.573 rijen slaagt in 16 seconden, 6.626 in 8, en 11.128 ging de dag ervoor nog
net goed. Ergens tussen elf- en vijftienduizend rijen houdt de flow ermee op.

Daarom heeft `orders` op test een uitzondering van 3 dagen gekregen. Dat is dezelfde
`windowOverrides`-kaart als bij `costs`, alleen in de andere richting: kosten hebben een bréder venster
nodig, orderregels een smaller. En het is een grens die meebeweegt — de dichtheid groeide in één dag met
ruim een derde, dus dit is geen instelling die je één keer goed zet.

**Wat dat betekent voor de bewaking.** Een te groot venster faalt stil: de flow komt niet terug, de job
blijft hangen, en pas de opruimer maakt er iets zichtbaars van. Loopt een endpoint herhaaldelijk in die
opruimer, dan is een te grote payload de eerste verdenking — niet een storing bij Fabric.

Die voorwaarde is de reden dat `windowDays` een instelling is en geen constante: wie hem onder de
stamdata-frequentie zet, breekt de zelfherstellende eigenschap.

---

## 9. Backfill

Eén mechanisme, twee aanleidingen: een leverancier die aangezet wordt, of een periode die opnieuw
opgehaald moet worden.

### Onboarding van een leverancier

1. De portal vraagt via de **vraag**-flow: `SELECT MIN(levering_datum) FROM … WHERE rel_id_leverancier = ?`
2. Eerst één ronde `suppliers` + `growers`, ongefilterd op datum
3. Daarna brokken van één maand, van de eerste levering tot vandaag, elk met de drie
   datumgebonden endpoints `lots → orders → costs` en de leverancier als filter
4. De brokken lopen door dezelfde wachtrij, dus achter de reguliere sync aan

**Stamdata zit niet in de brokken.** `suppliers` en `growers` kennen geen `levering_datum`, dus ze per
maand ophalen is zinloos — je zou dezelfde 673 leveranciers dertig keer binnenhalen. Ze gaan één keer
vooraf, en juist die volgorde is essentieel: zonder de leverancier en zijn kwekers gooit `lots` elke
brok stilzwijgend weg.

Een handmatige begindatum blijft mogelijk voor het geval je het antwoord wilt overrulen.

### Waarom per maand

Een volledige herbouw is 336.000 transacties. Dat past niet in één call, niet qua body en niet qua
functietijd. Per maand is klein genoeg om te slagen en groot genoeg om niet in honderden calls uiteen
te vallen. Blijkt een maand te groot, dan kan de portal via de vraag-flow eerst tellen en verder
opdelen.

### Een gefaalde brok stopt de rest niet

Brokken zijn onafhankelijk — maart 2024 heeft niets nodig van februari. Een gefaalde brok blijft op
`failed` staan met zijn foutmelding, en het overzicht laat zien welke maanden opnieuw moeten. Binnen
één brok geldt de volgorde onverkort.

### Backfill blijft structureel nodig

`fct_salesheets_costs` heeft geen kolom met het moment van laatste wijziging, alleen
`levering_datum`. Een correctie die vandaag op een levering van vorig jaar wordt doorgevoerd valt
daardoor buiten elk rollend venster. Bewezen effect: de herrekende transactieheffing wijkt bij 111 van
de 222 gecontroleerde salessheets af. De backfill is dus niet alleen een reparatie na uitval maar een
vast onderdeel van de aansluiting op de bron. Plan hem periodiek in.

---

## 10. Foutafhandeling en tempo

**Een ronde breekt af bij de eerste fout.** Faalt `lots`, dan worden `orders` en `costs` op
`cancelled` gezet. Orders die verwijzen naar partijen die er niet zijn worden stil weggegooid; een
halve ronde die je ziet is beter dan een hele die gaten trekt. De volgende tick begint een nieuwe
ronde en het rollende venster zorgt dat er niets verloren is.

**Opnieuw proberen is veilig.** Alle vijf de endpoints doen upserts op de Fabric-sleutels, dus
dezelfde brok twee keer ophalen levert hetzelfde resultaat. Drie pogingen, met de tick als klok.

**Vastlopers.** Een job die langer dan vijftien minuten `dispatched` is zonder resultaat is dood: de
flow is gevallen, de SQL liep vast, of de terugpost kwam nooit aan. De tick ruimt hem op en zet de
bijbehorende batch op `error`. Dat is het gat waar nu niets zit — een batch die crasht buiten de
try/catch blijft vandaag eeuwig op `running` staan.

**Het tempo volgt uit de volgorde.** Er staat er hoogstens één tegelijk uit. Een backfill komt pas aan
de beurt als er geen reguliere ronde loopt, dus een herbouw kan de dagelijkse sync nooit verdringen.

| wat er misgaat | wat de portal ziet |
|---|---|
| webhook onbereikbaar of geweigerd | de POST faalt direct → job en batch op `error` met de HTTP-status |
| flow start, SQL faalt | geen terugkomst → na 15 minuten `failed` |
| SQL slaagt, terugpost faalt | idem |
| payload klopt niet | `summariseImportError` noemt het ontbrekende veld bij naam |
| een ronde staat stil | `lastRunAt` loopt achter op het interval → zichtbaar als overdue |

---

## 11. Wat er in bestaande code verandert

**De omhulling van de import-routes wordt één keer geschreven.** De vijf routes zijn samen 1.913
regels waarin hetzelfde patroon vijf keer letterlijk herhaald staat: auth, batch openen, normaliseren,
valideren, batch afsluiten, foutafhandeling. Ze moeten nu allemaal een optionele `batchId` accepteren.
Dat vijf keer apart inbouwen is hoe zulke duplicatie ontstaat. De omhulling verhuist naar
`src/lib/import-batch.ts`, waarna elke route alleen nog zijn eigen upsert-logica bevat.

**Het stille overslaan in de lots-import gaat tellen en loggen**, per `rel_id`, in
`ImportBatch.details`. Dit moet af vóór de eerste backfill, anders herhaalt een herbouw precies de
fout waardoor COLXROOD en COLXBAK data kwijtraakten en zie je het opnieuw niet.

**`growers` komt in het admin-scherm.** `ENDPOINTS` in `imports-content.tsx:72` staat op vier
waarden, terwijl de route wel batches met `endpoint: "growers"` wegschrijft. Die runs zijn nu
onzichtbaar in de KPI-kaarten en het filter.

**De import-API-sleutel wordt geroteerd.** Hij staat hardgecodeerd in `scripts/backfill.ts:23` en
daarmee in de git-historie. Nieuwe waarde in Vercel, in de lokale `.env` en in de flows.

---

## 12. Bediening

Eén pagina onder admin, naast het bestaande import-overzicht:

- **Schema's** — twee regels bewerken: aan/uit, interval, tijdstip, endpoints, venster
- **Wachtrij** — wat staat er open, wat loopt er, wat is er mislukt, met de foutmelding
- **Handmatig** — nu draaien, of een backfill over een periode inplannen

Op de leverancierspagina komt één knop: **historie ophalen**. Die vraagt de eerste levering op, laat
zien hoeveel maanden dat wordt, en zet de brokken klaar na bevestiging.

---

## 13. Testaanpak

Er zijn geen tests in dit project en dit ontwerp voert er geen testsuite naast in. Wat wel kan:

1. **De query-bouwers zijn pure functies.** Venster en filter erin, string eruit — te controleren met
   een klein script zonder database of netwerk.
2. **De tick-beslissing is ook puur.** Gegeven de instellingen en `lastRunAt`: moet er iets draaien?
   Idem te controleren.
3. **De keten op test.** Eén ronde handmatig afvuren, controleren of de jobs in volgorde lopen en of
   `ImportBatch` netjes afsluit. Daarna een backfill op één leverancier.
4. **Reconciliatie tegen de bron.** De scripts in `scripts/recon-*.js` liggen klaar. Draai ze na de
   overstap opnieuw voor PCFUP en COLBFL.

Let bij stap 4 op: test draait dan op SQL en productie nog op DAX, met verschillende vensters. Leg de
vensters gelijk vóór je de uitkomsten naast elkaar legt, anders lijkt elk verschil een fout.

---

## 14. Fasering

| stap | inhoud |
|---|---|
| 1 | `SyncJob` en `SyncSchedule`, de tick, `vercel.json`, dry-run op lokaal |
| 2 | de twee flows in Power Automate, `dispatch.ts`, de query-bouwer voor `costs` |
| 3 | `import-batch.ts` en de optionele `batchId` in alle vijf de routes |
| 4 | de overige vier query-bouwers, korte ronde en nachtronde op test |
| 5 | backfill-mechanisme en de knop op de leverancierspagina |
| 6 | admin-bediening |
| 7 | productie omzetten, DAX-flows uit |

Vóór stap 5: het stille overslaan moet tellen en loggen ([§11](#11-wat-er-in-bestaande-code-verandert)).

**Op test draaien de kosten nu twee keer per cyclus** — de oude DAX-stap en de nieuwe SQL-stap, negen
seconden na elkaar. Zet de DAX-stap uit zodra de nieuwe keten `costs` overneemt.

---

## 15. Buiten scope

- **Power Automate helemaal weghalen.** `scripts/fabric-query.js` bewijst dat Node rechtstreeks met
  het Fabric-endpoint kan praten over 1433 met een Entra-token; de hele reconciliatie is er doorheen
  gegaan. Wat ontbreekt is een service principal — het script logt nu in met device code op een
  persoonlijk account, en dat kan een server niet. Zie `tasks/todo.md` 0a–0e, inclusief de
  tenant-instelling "Service principals can use Fabric APIs". Komt die er, dan vervalt de hele
  Power Automate-laag en blijft de rest van dit ontwerp staan: `dispatch.ts` is de naad waar je
  de uitvoerder vervangt. Dat is ook de terugval als Microsoft de afgekeurde actie
  "Execute a SQL query" ooit uitzet.
- **De herbouwfunctionaliteit zelf.** Dit ontwerp levert de backfill waar een herbouw op steunt, maar
  het leegmaken van de acht Fabric-tabellen en het opnieuw koppelen van de salessheet-PDF's is een
  eigen ontwerp. Let op: van de 25 gevulde tabellen zijn er maar acht herbouwbaar uit Fabric. De
  2.479 salessheet-documenten komen per e-mail binnen en staan in Vercel Blob — die overleven een
  herbouw alleen als de `Document`-tabel met rust gelaten wordt.
- **Sleutelvergelijking in plaats van een vast venster.** De duurzame oplossing voor correcties op
  oude leveringen is een tweetrapsdetectie: eerst sleutel plus bedrag ophalen, lokaal vergelijken,
  dan alleen de afwijkingen volledig opvragen. Zolang die er niet is, is de periodieke backfill het
  mechanisme dat dit repareert.
- **Views of stored procedures in het warehouse.** Op termijn robuuster dan de query in de call, maar
  het kost eigen regie over de query.
