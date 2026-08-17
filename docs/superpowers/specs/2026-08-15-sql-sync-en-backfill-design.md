# Ontwerp: van DAX naar SQL, met portal-gestuurde sync en backfill

> **Status:** deels vervangen. Stap 0 (T5) is geslaagd op 15 augustus 2026 — zie
> [§3](#3-voorwaarde-vooraf-t5-de-inkomende-webhook-werkt). Op dat resultaat is een ruimer ontwerp
> gemaakt: [2026-08-15-portal-gestuurde-sync-design.md](2026-08-15-portal-gestuurde-sync-design.md).
> Dáár staat nu de architectuur, het datamodel, de backfill en de fasering.
>
> **Wat hier nog geldt:** de testladder T1–T5 met uitkomsten (§2, §3), de onderbouwing van de
> endpoint-volgorde (§6), en de analyse van correcties die buiten elk venster vallen (§9).
> **Wat vervangen is:** §4 (architectuur), §5 (componenten en contract), §8 (brokgrootte — de portal
> hakt, per maand) en §11 (fasering).
> **Datum:** 15 augustus 2026
> **Aanleiding:** de import draait op DAX-queries via Power Automate. De payload uit
> `marts.fct_salesheets_costs` is al bewezen via SQL (T1–T3 in
> [power-automate-sql-fabric.md](../../power-automate-sql-fabric.md)); de HTTP-push erna faalde op de
> kolomnamen en werkt sinds `c053418`. De backfill is nog handwerk met losse CSV's.
> **Context:** de portal is nog niet in gebruik door kwekers. Er kan ruim getest, leeggegooid en
> opnieuw opgebouwd worden zonder dat iemand daar last van heeft.

---

## 1. Wat dit oplost

Drie dingen aan de huidige keten:

1. **De backfill is handwerk.** CSV's uit Power BI exporteren, in `private_input/PBI/backfill`
   zetten, en `scripts/backfill-remaining.ts` draaien. Niet herhaalbaar en niet in te plannen.
2. **Een gepauzeerde flow is onzichtbaar.** Op 12 augustus stond de test-flow stil; de portal
   merkte daar drie dagen niets van, omdat `ImportBatch` pas ontstaat wanneer er data binnenkomt.
   Geen run betekent nu geen spoor.
3. **De kolomnamen zijn DAX-vormig.** Dat is opgelost in PR #6 — `normalizeImportKeys()` accepteert
   sinds 13 augustus zowel `[Shkost ID]` als `shkost_id`. De ontvangkant hoeft dus niet mee te
   veranderen met de bron.

   Op 15 augustus kwam daar een derde spelling bij. De SQL Server-connector serialiseert zijn
   `ResultSets` via een DataSet, en die XML-codeert kolomnamen met een spatie: een view die aliast
   naar `[Shkost ID]` komt binnen als `Shkost_x0020_ID`. `canonicalKey()` streepte de underscores weg
   maar liet `x0020` als letterlijke tekst staan, dus geen enkele sleutel matchte en alle 4.141 rijen
   vielen af. Sinds `c053418` worden `_xHHHH_`-escapes eerst gedecodeerd. **Reken hierop bij de andere
   vier endpoints:** elke view die naar leesbare namen aliast raakt dit. Wil je het bij de bron
   voorkomen, alias dan naar `shkost_id` in plaats van `[Shkost ID]`.

---

## 2. Genomen beslissingen

| onderwerp | keuze | overweging |
|---|---|---|
| **Regie** | de portal triggert Power Automate via een webhook | de portal bepaalt wat er opgehaald wordt; Power Automate doet het zware werk waar Vercel-functies te kort voor draaien |
| **Detectie** | vast tijdvenster op `levering_datum`, gelijk aan nu | één ding tegelijk veranderen. Sleutelvergelijking kan later, zie [§9](#9-later-mogelijk-sleutelvergelijking) |
| **Venstergrootte** | SQL staat bewust breder dan DAX; **getal nog vastleggen**, zie hieronder | het verschil in rijaantallen is verklaard, de waarde staat nergens |
| **Query** | in de Power Automate-flow, met het bestand in `scripts/sql/` als bron van waarheid | volledige eigen regie over de query; het bestand in de repo dekt het gemis aan versiebeheer af |
| **Rollout** | direct omzetten, geen parallelle vergelijking | er zijn geen gebruikers, dus er valt niets te beschermen |
| **Brokgrootte** | **nog open** | zie [§8](#8-open-punt-wie-hakt-een-grote-backfill-in-stukken) — het contract dwingt hier niets af, dus de keuze is uitgesteld zonder gevolgen |

### Het venster is nog geen getal

De twee bronnen leveren aantoonbaar niet hetzelfde op. In de run van 15 augustus stuurde de
DAX-stap 2.496 kostenregels en de SQL-stap 4.141, in dezelfde cyclus. Dat verschil is **bewust**: de
SQL-query staat op een breder tijdvenster. Het is dus geen fout, maar de waarde staat nergens
vastgelegd — niet die van DAX en niet die van SQL.

Leg beide alsnog vast, want [§10](#10-testaanpak) leunt erop. Stap 2 van de testaanpak vergelijkt
test (SQL) met productie (DAX) en gaat er stilzwijgend van uit dat dezelfde bronperiode wordt
opgehaald. Zolang de vensters verschillen is elk verschil in rijaantallen verwacht en zegt de
vergelijking niets. Twee manieren om het DAX-venster te achterhalen: de query in de flow uitlezen, of
het afleiden uit `MIN(levering_datum)` over één binnengekomen batch.

---

## 3. Voorwaarde vooraf (T5): de inkomende webhook werkt

> **Geslaagd op 15 augustus 2026.** Het hele ontwerp hing op deze trigger; die twijfel is weg.

De trigger *"When an HTTP request is received"* is gewoon beschikbaar in de tenant. Geen
premium-blokkade, geen DLP-weigering — de twee risico's die hier stonden zijn geen van beide
uitgekomen. Getest met een flow die `{ "van": "2026-08-01", "tot": "2026-08-15" }` aanneemt en die
twee waarden doorgeeft; ze kwamen allebei aan in de run.

| aanroep | antwoord |
|---|---|
| POST met geldige handtekening | `202 Accepted` in 419 ms, run `08584147832591736472967323627CU12` |
| GET met geldige handtekening | `400 Bad Request` — de trigger accepteert alleen POST |
| POST met verminkte handtekening | `401 AuthorizationFailed` |

Die laatste regel is de rechtvaardiging voor *"Who can trigger the flow?"* op `Anyone`: de
handtekening authenticeert echt. De alternatieven ("Any user in my tenant", "Specific users") eisen
een Entra-token bij elke aanroep, en dat betekent een app-registratie plus client-credentials-flow
aan de Vercel-kant. Onnodig zwaar voor server-to-server verkeer met een geheime URL.

### Instellingen die werken

- **Who can trigger the flow:** `Anyone`
- **Method** en **Relative path:** leeg. Leeg betekent POST-only, en een relative path werkt alleen
  als Method óók ingevuld is. We hebben het niet nodig: vijf flows, elk met een eigen URL.
- **Geen Response-actie.** De trigger antwoordt dan met `202 Accepted` en draait door. Dat is precies
  wat [§4](#4-architectuur) wil — een Response-actie zou de portal laten wachten tot de SQL klaar is,
  en dat haalt de Vercel-functietimeout niet.
- De flow slaat niet op met alleen een trigger; er moet minstens één actie onder staan.

### De webhook-URL is een geheim

Hij draagt de handtekening in de querystring, dus wie hem heeft kan de flow starten. Hij hoort in de
Vercel-env-vars als `PA_WEBHOOK_<ENDPOINT>_URL` — niet in de repo, niet in `scripts/sql/`, en niet in
een gespreks- of ticketlog.

De URL van de testflow ís door zo'n log gegaan. Die flow is daarom wegwerp en zijn sleutel wordt
geroteerd; hij wordt voorlopig alleen op test gebruikt. De vijf echte flows krijgen hun URL
rechtstreeks van Power Automate naar Vercel, zonder tussenstop.

### Terugval, mocht dit ooit alsnog omvallen

Tenantbeleid kan veranderen. Gebeurt dat, keer dan de besturing om: Power Automate houdt zijn eigen
schema en begint elke run met `GET /api/sync/next -> { "van": ..., "tot": ... }`. De portal bepaalt
dan nog steeds *wat* er opgehaald wordt, alleen niet *wanneer*, en er is geen premium voor nodig.
Backfill werkt ook: zet een andere periode klaar en de eerstvolgende run pikt hem op.

---

## 4. Architectuur

```
Vercel Cron (elke 4 uur)
   |
   +-> POST /api/sync/run                          [portal]
          |  bepaalt het venster
          |  opent per endpoint een ImportBatch (status: running)
          |
          +-> POST <webhook-url>  { van, tot }     [Power Automate]
                 |  SQL op wh_transform
                 |
                 +-> POST /api/import/<endpoint>   [portal]
                        upsert + ImportBatch afronden
```

De kern van de omkering: **het schema verhuist van Power Automate naar de portal.** Nu bepaalt de
flow wanneer hij draait en merkt de portal niets als hij stilstaat. Straks vuurt de portal en legt
hij vóóraf een batch op `running` vast. Komt er geen afronding, dan blijft die batch openstaan en is
de stilte zichtbaar.

---

## 5. Componenten

| onderdeel | verantwoordelijkheid |
|---|---|
| `vercel.json` cron | wanneer er gesynchroniseerd wordt |
| `POST /api/sync/run` | venster bepalen, batches openen, webhooks aanroepen in de juiste volgorde |
| vijf Power Automate-flows | één per endpoint: SQL draaien en doorsturen |
| `scripts/sql/sync-<endpoint>.sql` | bron van waarheid per query |
| `/api/import/*` | **ongewijzigd** |

Vijf losse flows in plaats van één met een schakelaar: elke query is anders, de volumes lopen uiteen
(growers 2.793 rijen per run tegen lots 583), en een fout in één endpoint hoort de rest niet te
blokkeren. Losse flows zijn ook apart uit te zetten tijdens het testen.

### Het contract

De webhook krijgt niets anders dan een periode:

```json
{ "van": "2026-08-01", "tot": "2026-08-15" }
```

Daarmee zijn de dagelijkse sync, een gerichte backfill en een volledige herbouw **hetzelfde
mechanisme met andere parameters**. Dat is ook waarom [§8](#8-open-punt-wie-hakt-een-grote-backfill-in-stukken)
open kan blijven: die keuze raakt het contract niet.

---

## 6. Volgorde van de endpoints

Dit is een harde afhankelijkheid, geen voorkeur:

```
suppliers -> growers -> lots -> orders -> costs
```

`lots` zoekt de leverancier op via `Supplier.fabricId` en **slaat de partij stilzwijgend over** als
die niet bestaat (`src/app/api/import/lots/route.ts`, `if (!supplierId) { skipped += rows.length }`).
Draai je de herbouw in de verkeerde volgorde, of met een leverancier die nog niet is aangezet, dan
verdwijnt die data zonder spoor. Dat is precies wat er bij COLXROOD en COLXBAK is gebeurd: 317
salessheet-mails van 83 codes, waarvan veertien echte leveranciers die wel in `FabricRelation` staan
maar niet als `Supplier` zijn aangemaakt.

`/api/sync/run` moet die volgorde afdwingen en niet vijf webhooks parallel afvuren.

Het aantal overgeslagen rijen hoort geteld en weggeschreven te worden in `ImportBatch.details`, per
`rel_id`. Nu is het onzichtbaar.

---

## 7. Foutafhandeling

Uitgangspunt: **stilte moet zichtbaar zijn.**

| wat er misgaat | wat de portal ziet |
|---|---|
| webhook onbereikbaar of geweigerd | de POST faalt direct → batch op `error` met de HTTP-status |
| flow start, SQL faalt | geen terugkomst → batch blijft op `running` |
| SQL slaagt, POST terug faalt | idem |
| payload klopt niet | `summariseImportError` noemt het ontbrekende veld bij naam (PR #6) |
| één endpoint faalt, rest slaagt | elk endpoint heeft een eigen batch, dus per stuk zichtbaar |

De openstaande `running`-batch is het signaal. Daar hoort **geen opruim-cron** bij: bereken het bij
het lezen. Een batch die langer dan dertig minuten op `running` staat toont de admin-pagina als
vastgelopen. Dat scheelt een tweede geplande taak en een tweede plek waar iets kan blijven hangen.

**Herhalen is veilig.** Alle vijf de endpoints doen upserts op de Fabric-sleutels, dus dezelfde
periode twee keer ophalen levert hetzelfde resultaat. Dat maakt een backfill bruikbaar: bij twijfel
opnieuw draaien.

---

## 8. Open punt: wie hakt een grote backfill in stukken?

Een volledige herbouw is 336.000 transacties. Dat past niet in één call — niet qua body, niet qua
functietijd. Twee varianten, bewust nog niet gekozen:

- **De portal stuurt de brokken aan.** Loopt zelf door de periode, bijvoorbeeld maand voor maand.
  Elke brok is een eigen `ImportBatch`, dus je ziet welk stuk faalde en herhaalt alleen dat stuk.
- **Power Automate lust intern.** Eén opdracht met de volledige periode, de flow hakt hem zelf op.
  Eenvoudiger contract, minder verkeer, maar de portal ziet geen voortgang en een fout halverwege is
  een black box.

Het contract uit [§5](#het-contract) is in beide gevallen hetzelfde, dus deze keuze is later te maken
zonder dat er iets aan de endpoints verandert. Beslissen vóór stap 3 van de fasering.

---

## 9. Later mogelijk: sleutelvergelijking

Het vaste venster laat één gat open. `fct_salesheets_costs` heeft geen kolom met het moment van
laatste wijziging, alleen `levering_datum`. Een correctie die vandaag op een levering van vorig jaar
wordt doorgevoerd valt daardoor buiten elk venster. Bewezen effect: de herrekende transactieheffing
wijkt bij 111 van de 222 gecontroleerde salessheets af van de salessheet — 110 keer hoger in Fabric,
één keer lager.

Met het vaste venster wordt de **backfill het mechanisme dat dit repareert**. Hij is dus niet alleen
om een gat te dichten na uitval, maar structureel onderdeel van de aansluiting op de bron. Plan hem
periodiek in.

De duurzame oplossing is een tweetrapsdetectie: eerst een lichte query die alleen sleutel plus bedrag
ophaalt (`shkost_id`, `salesheet_amount`), lokaal vergelijken, daarna alleen de afwijkingen volledig
opvragen. Dat vangt correcties op oude leveringen én verwijderde rijen, zonder afhankelijk te zijn
van het datateam. Een `laatst_gewijzigd`-kolom op de marts-tabellen zou het goedkoper maken; die
vraag staat sinds 12 augustus open.

---

## 10. Testaanpak

1. ~~**T5 — webhook.**~~ Geslaagd op 15 augustus, zie
   [§3](#3-voorwaarde-vooraf-t5-de-inkomende-webhook-werkt).
2. **Per endpoint, test tegen productie.** Test wordt via SQL gevuld, productie draait nog op DAX.
   Twee gescheiden databases, dus rijaantallen en bedragen zijn regelrecht te vergelijken — **maar
   alleen als beide hetzelfde tijdvenster ophalen**, en dat is nu niet zo (zie
   [§2](#het-venster-is-nog-geen-getal)). Leg de vensters eerst gelijk, anders vergelijk je twee
   periodes en lijkt elk verschil een fout.
3. **Reconciliatie tegen de bron.** De scripts in `scripts/recon-*.js` liggen klaar. Draai ze na de
   overstap opnieuw voor PCFUP en COLBFL en kijk of de cijfers bewegen.
4. **Generale repetitie van de herbouw.** Gooi op test de acht Fabric-tabellen leeg, backfill alles
   vanaf 2023, vergelijk de aantallen met productie. Dat valideert de backfill én de toekomstige
   herbouwfunctionaliteit in één keer, en het is de enige manier om te weten of het volume in de
   praktijk doorkomt.

---

## 11. Fasering

| stap | inhoud | stand |
|---|---|---|
| 0 | T5 webhook-test | **af** — 15 augustus |
| 1 | `costs` omzetten (T3 al bewezen), venster en trigger valideren, DAX-kostenstap op test uit | loopt |
| 2 | overige vier endpoints, in de volgorde van [§6](#6-volgorde-van-de-endpoints) | |
| 3 | generale repetitie herbouw op test | |
| 4 | productie omzetten, DAX-flows uit | |

### Nu meteen, in stap 1

**Op test draaien de kosten twee keer per cyclus.** Op 15 augustus liep om 16:58:08 de DAX-stap
(2.496 rijen) en negen seconden later de SQL-stap (4.141 rijen). Beide doen upserts op
`fabricShkostId` in dezelfde tabel en beide herberekenen de salessheet-totalen. Vóór `c053418` viel
dat niet op, want de SQL-stap faalde altijd. Zolang de bronnen hetzelfde rekenen merk je niets — de
laatste run wint — maar lopen ze uiteen, dan hangt het resultaat af van de volgorde waarin de stappen
toevallig eindigen. Zet de DAX-kostenstap op test uit nu de SQL-versie werkt.

De data zelf is na die dubbele run wel gecontroleerd en gezond: bij nul salessheets wijkt
`totalCosts` af van de som van de kostenregels, bij nul wijkt `netResult` af van turnover − costs, en
alle 54.997 kostenregels hebben een `fabricShkostId`.

### Vóór stap 3

Anders herhaalt de herbouw bestaande fouten:

- **Het stille overslaan in de lots-import** moet tellen en loggen ([§6](#6-volgorde-van-de-endpoints)).
- **De import-API-key roteren.** Die staat in commit `b35a896` in de git-historie. Nieuwe waarde in
  Vercel, in de lokale `.env` en in de flows.
- **De handtekening van de testwebhook roteren** ([§3](#de-webhook-url-is-een-geheim)).
- **De growers-flow controleren.** Hij stond tussen 12 en 15 augustus stil op beide omgevingen; op
  15 augustus draaide hij weer mee in de testronde (2.799 rijen, 4 bijgewerkt). De flow zelf werkt
  dus, maar of het schema uit zichzelf loopt of dat die run handmatig was, is niet vastgesteld.

---

## 12. Wat hier niet in zit

- **De herbouwfunctionaliteit zelf.** Dit ontwerp levert de backfill waar een herbouw op steunt, maar
  het leegmaken van de acht Fabric-tabellen en het opnieuw koppelen van de salessheet-PDF's is een
  eigen ontwerp. Let daarbij op: van de 25 gevulde tabellen zijn er maar acht herbouwbaar uit
  Fabric. De 2.479 salessheet-documenten komen per e-mail binnen en staan in Vercel Blob — die
  overleven een herbouw alleen als de Document-tabel met rust gelaten wordt.
- **Views of stored procedures in het warehouse.** Op termijn robuuster dan de query in de flow, maar
  het kost eigen regie over de query. Te heroverwegen als de queries stabiel zijn.
- **De openstaande vragen aan het datateam** over de transactieheffing en de correctiegrondslag. Zie
  [kosten-warehouse-vs-salessheet.md](../../kosten-warehouse-vs-salessheet.md).
