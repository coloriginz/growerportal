# Ontwerp: van DAX naar SQL, met portal-gestuurde sync en backfill

> **Status:** ontwerp, nog niet gebouwd. Stap 0 (T5) is blokkerend.
> **Datum:** 15 augustus 2026
> **Aanleiding:** de import draait op DAX-queries via Power Automate. De payload uit
> `marts.fct_salesheets_costs` is al bewezen via SQL (T1–T3 in
> [power-automate-sql-fabric.md](../../power-automate-sql-fabric.md)), maar de HTTP-push erna
> faalde en de backfill is nog handwerk met losse CSV's.
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

---

## 2. Genomen beslissingen

| onderwerp | keuze | overweging |
|---|---|---|
| **Regie** | de portal triggert Power Automate via een webhook | de portal bepaalt wat er opgehaald wordt; Power Automate doet het zware werk waar Vercel-functies te kort voor draaien |
| **Detectie** | vast tijdvenster op `levering_datum`, gelijk aan nu | één ding tegelijk veranderen. Sleutelvergelijking kan later, zie [§9](#9-later-mogelijk-sleutelvergelijking) |
| **Venstergrootte** | **eerst vaststellen**, zie hieronder | "gelijk aan nu" is nog geen getal |
| **Query** | in de Power Automate-flow, met het bestand in `scripts/sql/` als bron van waarheid | volledige eigen regie over de query; het bestand in de repo dekt het gemis aan versiebeheer af |
| **Rollout** | direct omzetten, geen parallelle vergelijking | er zijn geen gebruikers, dus er valt niets te beschermen |
| **Brokgrootte** | **nog open** | zie [§8](#8-open-punt-wie-hakt-een-grote-backfill-in-stukken) — het contract dwingt hier niets af, dus de keuze is uitgesteld zonder gevolgen |

### Het venster is nog geen getal

"Gelijk aan nu" moet nog een waarde krijgen, want de twee bronnen leveren aantoonbaar niet hetzelfde
op. De DAX-query levert gemiddeld 2.061 kostenregels per run; de SQL-variant uit T3 met een venster
van 45 dagen leverde er 3.983. Wat het venster van de huidige DAX-query precies is, staat nergens
vastgelegd.

Stel dat vast vóór stap 1 van de fasering, anders vergelijk je in [§10](#10-testaanpak) twee
verschillende periodes met elkaar en lijkt elk verschil een fout. Twee manieren: de DAX-query in de
flow uitlezen, of het venster afleiden uit `MIN(levering_datum)` over één binnengekomen batch.

---

## 3. Voorwaarde vooraf (T5): werkt de inkomende webhook?

Sluit aan op de testladder T1–T4. **Bouw niets voordat dit slaagt**, want het hele ontwerp hangt op
deze trigger.

Te testen: een flow met de trigger *"When an HTTP request is received"*, aangeroepen met body
`{ "van": "2026-08-01", "tot": "2026-08-15" }`, die die twee waarden doorgeeft aan de SQL-actie.

Twee dingen kunnen dit blokkeren, allebei tenantbeleid waar wij niet over gaan:

- **Licentie.** De Request-trigger is een premium connector. Zonder Power Automate Premium op het
  account waaronder de flow draait verschijnt hij niet, of faalt het opslaan.
- **DLP.** Dezelfde soort beleid die "Execute a SQL query" kan blokkeren kan ook inkomende
  HTTP-triggers uitzetten. Dat T1–T3 mochten draaien zegt hier niets over.

Slaagt het, leg dan meteen vast: **de webhook-URL is een geheim.** Hij draagt een handtekening in de
querystring, dus wie hem heeft kan de flow starten. Hij hoort in de Vercel-env-vars — niet in de
repo, en niet in `scripts/sql/`.

### Terugval als T5 faalt

**Omgekeerde besturing (voorkeur).** Power Automate houdt zijn eigen schema, maar begint elke run
met een vraag aan de portal:

```
GET /api/sync/next  ->  { "van": "2026-08-01", "tot": "2026-08-15" }
```

De portal bepaalt dan nog steeds *wat* er opgehaald wordt, alleen niet *wanneer*. Backfill werkt
ook: zet een andere periode klaar en de eerstvolgende run pikt hem op. Kost één uitgaande call in de
flow en heeft geen premium nodig. Vrijwel gelijkwaardig aan het origineel.

**Terug naar het huidige model.** Vast venster in de flow, backfill als losse handmatige flow. Dan
verdwijnt de regie en blijft een gepauzeerde flow onzichtbaar — tenzij de portal bijhoudt wanneer
hij een run *verwacht* en alarmeert als die uitblijft.

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

1. **T5 — webhook.** Blokkerend, zie [§3](#3-voorwaarde-vooraf-t5-werkt-de-inkomende-webhook).
2. **Per endpoint, test tegen productie.** Test wordt via SQL gevuld, productie draait nog op DAX.
   Twee gescheiden databases met dezelfde bronperiode, dus rijaantallen en bedragen zijn regelrecht
   te vergelijken. Geen dubbele schrijfacties, dus een verschil is een echt verschil.
3. **Reconciliatie tegen de bron.** De scripts in `scripts/recon-*.js` liggen klaar. Draai ze na de
   overstap opnieuw voor PCFUP en COLBFL en kijk of de cijfers bewegen.
4. **Generale repetitie van de herbouw.** Gooi op test de acht Fabric-tabellen leeg, backfill alles
   vanaf 2023, vergelijk de aantallen met productie. Dat valideert de backfill én de toekomstige
   herbouwfunctionaliteit in één keer, en het is de enige manier om te weten of het volume in de
   praktijk doorkomt.

---

## 11. Fasering

| stap | inhoud |
|---|---|
| 0 | T5 webhook-test — **blokkerend** |
| 1 | `costs` omzetten (T3 al bewezen), venster en trigger valideren |
| 2 | overige vier endpoints, in de volgorde van [§6](#6-volgorde-van-de-endpoints) |
| 3 | generale repetitie herbouw op test |
| 4 | productie omzetten, DAX-flows uit |

Drie dingen staan hier los van maar moeten opgelost zijn **vóór stap 3**, anders herhaalt de herbouw
bestaande fouten:

- **De growers-flow draait sinds 12 augustus 18:01 niet meer**, op geen van beide omgevingen. De
  andere vier draaien wel. Oorzaak onbekend.
- **Het stille overslaan in de lots-import** moet tellen en loggen ([§6](#6-volgorde-van-de-endpoints)).
- **De import-API-key roteren.** Die staat in commit `b35a896` in de git-historie. Nieuwe waarde in
  Vercel, in de lokale `.env` en in de flows.

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
