# Backfill: startdatum per leverancier uit Fabric

> **Doel:** bij het activeren en backfillen van een leverancier eerst aan Fabric vragen wanneer
> diens eerste consignment-partij binnenkwam, en de backfill vanaf dat kwartaal plannen in plaats
> van vanaf de globale startdatum. Scheelt lege kwartaalrondes bij nieuw ge-onboarde leveranciers.
>
> **Status:** ingepland, nog niet gebouwd. Wacht tot de reparatierun van
> `scripts/repair-zero-orders.ts` klaar is — bouwen raakt `src/lib/sync/` en dat hot-reload de
> dev-server die die run bedient.

---

## Waarom

`enqueueBackfill()` plant vandaag vanaf één globale datum (`sync.backfillStartDate`) voor iedere
leverancier. Voor een leverancier die twee weken levert zijn dat zes of zeven kwartalen die
gegarandeerd niets opleveren, elk goed voor drie jobs door een wachtrij die er één tegelijk pakt.

## Gemeten (25-08-2026)

- `SELECT MIN(leverdatum) FROM marts.fct_partijen WHERE rel_id_leverancier = ? AND inkooptype_code IN ('CONS')`
  kost **0,8–1,0 s** warm. De 35,7 s bij de eerste meting was koude start van de verbinding, niet de
  query. Past ruim binnen de 20 s van `ask()` (`src/lib/sync/dispatch.ts:12`).
- Over de 58 huidige leveranciers bij startdatum 2025-01-01: 406 → 365 kwartalen, 1.276 → 1.153 jobs.
- Waar het echt scheelt: COLXIMA (eerste partij 10-07-2026) 1 i.p.v. 7 kwartalen, MDHAGED en
  MPJCKARA 2 i.p.v. 7, MPOHER en COLSEMPC 3 i.p.v. 7.

## De valkuil

**De globale datum blijft een ondergrens, geen vervanging.** COLXGREE's eerste consignment-partij is
30-08-2023; puur op de eerste partij plannen maakt die backfill juist groter (7 → 12 kwartalen).
Dus `start = max(globale datum, kwartaal van eerste partij)`.

---

## Stappen

- [x] **1. Query.** `firstDeliveryQuery(supplierFabricId)` in `src/lib/sync/queries/`, met
      `consignmentSql("inkooptype_code")` uit `src/lib/sync/purchase-type.ts` zodat de verzameling
      inkooptypes op één plek blijft. Geeft één rij met één kolom terug.
      → `src/lib/sync/queries/first-delivery.ts`; weigert een onbruikbaar id in plaats van het
      leveranciersfilter te laten vallen.
- [x] **2. Resolver.** `resolveBackfillStart(supplierFabricId, globalStart)` — nieuw, naast
      `quarterChunks` in `src/lib/sync/backfill.ts` of in een eigen bestand. Roept `ask()` aan,
      past de ondergrens toe en geeft terug wat het werd én waarom:
      `{ start: Date | null, source: "fabric" | "setting", firstDelivery: Date | null }`.
      `start: null` betekent: geen consignment-partij, niets te backfillen.
      → eigen bestand `src/lib/sync/backfill-start.ts`; `backfill.ts` blijft netwerkvrij en
      exporteert alleen `quarterStart` erbij.
- [x] **3. Aanroepers.** `POST /api/sync/backfill` en `POST /api/admin/fabric-relations` lossen de
      startdatum op en geven hem door. `enqueueBackfill()` blijft een zuivere wachtrijfunctie —
      geen netwerkaanroep in de queue-logica.
- [x] **4. Antwoord.** De resolutie mee terug in de POST-response, naast de bestaande `plan`.
      → `start: { from, quarter, source, firstDelivery }` via `describeStart()`.
- [x] **5. Scherm.** In de backfill-kaart en het overgeslagen-paneel tonen vanaf welk kwartaal er
      gepland is en waarom ("eerste levering 10-07-2026" of "globale startdatum").
      → kaart: "From 2026 Q3 — first delivery"; de reden is daar afgeleid uit het vroegste venster
      tegenover de globale datum, want hij staat nergens opgeslagen. Melding na het starten
      (leverancierspagina én overgeslagen-paneel) noemt kwartaal, reden en datum. De bevestiging
      vooraf zegt er nu bij dat zijn kwartalen een bovengrens zijn.
- [x] **6. Opmerking bijwerken.** `src/lib/sync/settings.ts` zegt nu dat een datum per leverancier
      "een verfijning is waar nu geen vraag achter zit". Dat klopt straks niet meer.
- [x] **7. CLAUDE.md.** Regel bij de sync-sectie over hoe de startdatum tot stand komt.

## Randgevallen die het moeten halen

- [x] Vraag-flow geeft 502/504 of loopt in de timeout → terugvallen op de globale datum,
      `source: "setting"`. Een leverancier on-boarden mag niet stranden op een haperende flow.
      Een antwoord dat er wél is maar onleesbaar valt hier ook onder: dat gooit en wordt terugval,
      geen stille "geen partij".
- [x] `MIN` is leeg (relatie zonder consignment-partij) → niets in de wachtrij zetten en dat melden,
      in plaats van 22 jobs die allemaal leeg terugkomen. → 409 met reden, of `backfillError` bij
      activeren; de leverancier wordt wél aangemaakt.
- [x] Eerste levering ouder dan de globale datum → globale datum wint.
- [x] `resolveSyncEnv()` geeft `null` in development, dus lokaal valt hij altijd terug. Alleen op
      test en productie echt te beproeven.

## Verificatie

- [x] `scripts/checks/backfill.ts` uitbreiden met de ondergrens, de lege `MIN` en de terugval.
      Pure functies, geen netwerk — dus `resolveBackfillStart` de ask als parameter laten aannemen,
      of de rekenkern apart zetten. Draait mee in `npm run check`.
      → ask is injecteerbaar (`askRows`); `scripts/checks/queries.ts` beproeft daarnaast de query
      zelf, inclusief de vijandige ids.
- [ ] Op test een recent ge-onboarde leverancier activeren (COLXIMA of MDHAGED) en nakijken dat de
      wachtrij één respectievelijk twee kwartalen krijgt in plaats van zeven.
- [ ] Een gevestigde leverancier (COLXGREE) controleren: moet onveranderd op de globale datum
      blijven staan, niet terugvallen naar 2023.

## Niet doen

- Geen datum per leverancier opslaan in `Setting`. De waarheid staat in Fabric; een tweede kopie
  loopt uit de pas zodra een leverancier eerdere historie krijgt.
- De einddatum niet aanraken: een backfill loopt altijd door tot het huidige kwartaal.
