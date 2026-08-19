# Ontwerp: backfill per leverancier vanaf een instelbare basisdatum

> **Status:** ontwerp, nog niet gebouwd.
> **Datum:** 20 augustus 2026
> **Bouwt op:** [2026-08-15-portal-gestuurde-sync-design.md](2026-08-15-portal-gestuurde-sync-design.md) —
> de sync-motor met zijn wachtrij, ketenvolgorde en opruimer.
> **Aanleiding:** een leverancier aanzetten haalt alleen binnen wat toevallig in het rollende venster
> valt. Zijn historie komt nooit, want het venster schuift alleen vooruit.

---

## 1. Het probleem in één voorbeeld

Op 18 augustus is `GCPDFAAL` aangezet vanuit het overgeslagen-paneel. Er kwamen 146 partijen binnen en
dat zag eruit als een volledige reparatie. Het waren de partijen van die week; de rest van zijn historie
stond er niet, en zou er ook nooit komen.

Het onderstel voor de oplossing ligt er al. `SyncJob` heeft een kolom `supplierFabricId`, alle vier de
query-builders accepteren hem en bouwen er een `WHERE`-clausule mee — ook de lastige gevallen, kosten
via een subquery op `parthdr_id` en kwekers via `rel_id_kweker` — en de dispatcher geeft het veld door.
Er is alleen nooit iets geweest dat hem vult. Een aansluiting zonder stekker.

---

## 2. Genomen beslissingen

| onderwerp | keuze | overweging |
|---|---|---|
| **Basisdatum** | één instelling voor alle leveranciers, `Setting`-rij `sync.backfillStartDate` | een datum per leverancier is een verfijning waar nu geen vraag achter zit |
| **Brokgrootte** | kalenderkwartaal | gemeten: het zwaarste kwartaal van de zwaarste kandidaat is 6.372 orderregels, ruim onder de payload-grens |
| **Voorrang** | `priority`-kolom op `SyncJob`, gewone ronde gaat voor | de dagelijkse sync mag nooit stilvallen voor werk aan het verleden |
| **Trigger** | automatisch bij aanzetten, ná een bevestiging die de kosten toont | een leverancier aanzetten zonder historie is zelden de bedoeling, maar één klik mag geen uren werk veroorzaken zonder dat je het weet |
| **Bestaande leveranciers** | dezelfde backfill als knop op de leverancierspagina | nodig voor bestaande gaten en voor elk gat dat een storing achterlaat |
| **Bij een fout** | rest van de run annuleren, en hervatten vanaf het gestrande kwartaal | een gat middenin een backfill ziet niemand; een gestopte backfill wel |

---

## 3. De basisdatum

Eén rij in `Setting` onder `sync.backfillStartDate`, met waarde in ISO-vorm (`2024-01-01`).

**Niet in `/api/admin/settings`.** Die route geeft 403 zodra `isTest` onwaar is en controleert geen rol —
hij is gebouwd voor de e-mailinstellingen van de testomgeving. Deze instelling moet juist op productie
werken en hoort admin-only te zijn. Daarom een eigen `GET/PUT /api/sync/settings`, naast de schedules,
waar hij op het scherm ook thuishoort.

**Op het scherm** een datumveld op het Schedules-tabblad, met dezelfde soort waarschuwing als de
venstervelden al kennen: hoeveel kwartalen het wordt. `2024-01-01` levert "11 kwartalen per leverancier"
op. Weigeren doen we niet, waarschuwen wel — dezelfde lijn als bij `windowDays`.

Fabric heeft consignatie-partijen vanaf september 2021. Een datum daarvóór levert lege kwartalen op:
verspilling, geen fout, en de waarschuwing zegt het.

**Validatie:** een datum, niet in de toekomst. Ontbreekt de instelling, dan kan er geen backfill
aangemaakt worden en zegt de bevestiging dat — geen stilzwijgend uitvallen naar een gegokte datum.

---

## 4. Wat een backfill is

Voor één leverancier, vanaf de basisdatum tot en met het lopende kwartaal, één `runId`:

| volgnummer | endpoint | venster |
|---|---|---|
| 0 | `growers` | geen (stamdata) |
| 1, 2, 3 | `lots`, `orders`, `costs` | eerste kwartaal |
| 4, 5, 6 | `lots`, `orders`, `costs` | tweede kwartaal |
| … | | |

**Kwekers één keer.** Die query kent geen datumvenster: hij pakt alle kwekers van deze leverancier via
zijn partijen. Eén job volstaat, en hij moet vóór alles komen — de lots-import gooit partijen weg
waarvan de kweker ontbreekt.

**Leveranciers helemaal niet.** Die bestaat al; dat is de aanleiding voor de backfill.

Voor elf kwartalen zijn dat **34 jobs**. De bestaande volgordebewaking — een job wacht tot alles met een
lager volgnummer in dezelfde run klaar is — regelt dat kwartaal na kwartaal wordt afgewerkt met binnen
elk kwartaal de juiste ketenvolgorde. Er komt geen nieuwe machinerie bij.

**Kalenderkwartalen, niet "elke negentig dagen vanaf de basisdatum".** Ze zijn leesbaar in het scherm
("2025 Q3") en een tweede backfill levert exact dezelfde vensters op, wat het vergelijken van twee
rondes mogelijk maakt.

**Het laatste kwartaal overlapt het rollende venster.** Dat is onschadelijk: alle imports zijn upserts.

**De kosten komen vanzelf goed.** De kosten-query filtert op `levering_datum`, niet op afrekendatum. De
kosten van een kwartaal komen dus mee ongeacht wanneer ze geboekt zijn — voor een backfill van het
verleden precies goed, want daar is alles allang afgerekend. Het brede `costs`-venster dat de nachtronde
nodig heeft is hier niet aan de orde.

---

## 5. Voorrang in de wachtrij

`SyncJob` krijgt `priority Int @default(0)`. Backfill-jobs krijgen `1`. De claim-query sorteert op
`priority` vóór de bestaande volgorde.

Dat is de hele wijziging. Staat er een gewone job te wachten, dan wordt die eerst gepakt. Komt de
nachtronde binnen terwijl een backfill loopt, dan maakt de backfill zijn huidige job af en wacht de rest
tot de ronde klaar is. Geen onderbreking halverwege een job, geen pauzeknop, geen tweede dispatcher.

Een extra `NOT EXISTS` om backfills tegen te houden is niet nodig: de sortering pakt een wachtende
gewone job per definitie eerst.

**Wat het in tijd betekent.** Op productie tikt de cron elke vijf minuten en gaat er één job per tick
doorheen. Vierendertig jobs is dus zo'n drie uur, mits er niets anders wacht. In de praktijk smeert dat
uit over een nacht. Dat is de prijs van "gewone ronde gaat voor", en die is bewust betaald.

---

## 6. De bevestiging

De Activate-knop in het overgeslagen-paneel doet straks twee dingen en laat eerst zien wat het tweede
kost: welke leverancier, vanaf welke datum, hoeveel kwartalen, hoeveel jobs, en de mededeling dat het
draait wanneer er geen geplande ronde wacht.

**Geen live rijtelling uit Fabric.** Dat zou informatiever zijn, maar het maakt de knop afhankelijk van
een flow die aantoonbaar uit kan vallen — op 19 augustus lag die anderhalve dag plat. Dan kun je geen
leverancier meer aanzetten omdat de schatting niet op te halen is.

**Nee zeggen is een geldig antwoord.** De leverancier wordt dan wél aangemaakt en de backfill niet.
Aanzetten en backfillen zijn twee handelingen die toevallig achter één knop zitten.

Dezelfde bevestiging verschijnt bij de backfill-knop op de leverancierspagina, waar het aanmaken al
gebeurd is.

---

## 7. Wat je ziet terwijl hij loopt

Vierendertig batches overspoelen de Data Sync-lijst. Daarom een kaart op het Schedules-tabblad zolang er
een backfill open staat: welke leverancier, welk kwartaal hij nu doet, hoeveel jobs klaar zijn van
hoeveel, en of hij op een gewone ronde staat te wachten.

In de batchlijst blijft `backfill` als bron zichtbaar, zodat er op gefilterd kan worden.

---

## 8. Als er iets misgaat

Een kwartaal dat faalt volgt de bestaande regels: drie pogingen, dan `failed`, en de rest van de run
wordt geannuleerd. Streng, en terecht — een gat middenin een backfill ziet niemand terug.

**Hervatten vanaf het gestrande kwartaal** is de toevoeging. De vensters staan al gematerialiseerd op de
geannuleerde jobs, dus hervatten is ze terugzetten op `pending` en de gefaalde job zijn pogingen
teruggeven. Zonder dat begin je na een storing in kwartaal negen weer bij kwartaal één.

Een backfill die al loopt voor dezelfde leverancier wordt niet nog eens aangemaakt: de knop weigert met
de melding dat er al een open backfill is.

---

## 9. Wat er in de code verandert

| bestand | wijziging |
|---|---|
| `prisma/schema.prisma` | `SyncJob.priority Int @default(0)` plus index; de bestaande `@@index([status, createdAt])` wordt `@@index([status, priority, createdAt])` |
| `src/lib/sync/backfill.ts` | nieuw: kwartaalindeling en het samenstellen van de joblijst — pure functies |
| `src/lib/sync/runner.ts` | `enqueueBackfill()`, `resumeBackfill()`; `claimNextJob()` sorteert op `priority` |
| `src/app/api/sync/settings/route.ts` | nieuw: `GET/PUT` op de basisdatum, admin-only |
| `src/app/api/sync/backfill/route.ts` | nieuw: `POST` start een backfill voor één leverancier, `GET` toont de open backfills |
| `src/app/api/sync/backfill/[runId]/route.ts` | nieuw: `POST` hervat een gestrande backfill |
| `src/app/api/admin/fabric-relations/route.ts` | `POST` accepteert een vlag om meteen een backfill klaar te zetten |
| `src/app/(portal)/admin/imports/schedules-tab.tsx` | het datumveld en de voortgangskaart |
| `src/app/(portal)/admin/imports/skipped-dialog.tsx` | de bevestiging vóór activeren |
| `src/app/(portal)/suppliers/[id]/supplier-detail.tsx` | de backfill-knop op een bestaande leverancier |

---

## 10. Testaanpak

De kwartaalindeling is een pure functie over een basisdatum en een moment, en krijgt een controlescript
onder `scripts/checks/` in de bestaande vorm: een basisdatum middenin een kwartaal begint bij het begin
van dat kwartaal, het lopende kwartaal telt mee, een datum in de toekomst levert niets op, en de
joblijst staat in ketenvolgorde met kwekers vooraan.

De voorrang is te controleren zonder Fabric: zet een backfill en een gewone ronde tegelijk klaar en
kijk welke job `claimNextJob()` teruggeeft.

De rest is integratie en wordt op test geverifieerd met een echte, kleine leverancier — `COLXIMA` heeft
106 partijen sinds 2024 en is daarmee klein genoeg om in één zitting af te ronden en groot genoeg om
meerdere kwartalen te raken.

---

## 11. Wat hier niet in zit

- **Een basisdatum per leverancier.** Eén datum tot iemand het mist.
- **Automatisch signaleren dát er een gat is.** De sync weet wanneer hij stuk was; die brug slaan we
  als de vraag zich voordoet.
- **Meerdere jobs tegelijk.** De wachtrij dispatcht er bewust één; dat veranderen raakt veel meer dan
  dit ontwerp.
- **Backfill voor fust en afrekening-pdf's.** Dit gaat alleen over de vijf sync-endpoints.
