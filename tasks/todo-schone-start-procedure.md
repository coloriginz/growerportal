# Schone start: van lege database naar volledige portal

> **Doel:** de volgorde vastleggen waarin een lege database gevuld wordt, zodat het één keer goed
> gaat en niet elke keer opnieuw uitgevonden hoeft te worden. Eerst op test beproeven, daarna op
> productie.
>
> **Aanleiding:** alle reparaties van deze week moeten in de basisroutes zitten, niet in de losse
> herstelscripts. Anders reproduceert de eerste backfill precies de fouten die we net hebben
> weggehaald.

---

## Stand van zaken: waar zit welke reparatie?

| bevinding | zit in de importroute | alleen in een script |
|---|---|---|
| kostenbedragen onafgerond opslaan | ja (`import/costs` + schema) | |
| leeg kostenbedrag verwerpt geen ronde meer | ja (`import/costs`) | |
| ingetrokken kostenregels opruimen | ja (`import/costs`, verzoening) | |
| levering volgt de leverancier uit Fabric | ja (`import/lots`) | |
| levering met tegenstrijdige leveranciers weigeren | ja (`import/lots`) | |
| orderregel die zijn partij tegenspreekt weigeren | ja (`import/orders`) | |
| backfill start bij de eerste consignatiepartij | ja (`sync/backfill-start`) | |
| PDF-koppeling controleert leverdatum en leverancier | ja (`shipments/import-email`) | |
| **historie navullen na een herziening** | **nee** | `repair-zero-orders.ts`, `repair-costs.ts` |

Die laatste is bewust: het schuivende syncvenster komt niet terug op oude periodes. Na een schone
start is dat geen probleem — de backfill haalt alles één keer op — maar zodra het warehouse
historie herziet, loopt de portal weer achter. Dat vraagt een terugkerende ronde, geen eenmalige.

## De volgorde

- [ ] **1. Leveranciers.** `/api/import/suppliers`, of activeren vanuit het Fabric-relatiescherm.
      Zonder leverancier gooit de lots-import partijen stilzwijgend weg.
- [ ] **2. Kwekers.** Vóór de partijen, om dezelfde reden.
- [ ] **3. Per leverancier een backfill** — kwekers, dan per kwartaal partijen, orderregels, kosten.
      De startdatum wordt sinds deze week per leverancier opgehaald uit Fabric, dus lege kwartalen
      vallen vanzelf af. Let op: de wachtrij pakt één job tegelijk, dus dit duurt.
- [ ] **4. Controleren vóór het koppelen.** `scripts/recon-pdf-fabric-portal.ts` draait de
      drieweg-vergelijking; die hoort dicht bij nul uit te komen op omzet en kosten. Wijkt het af,
      dan is er iets met de backfill en niet met de PDF's.
- [ ] **5. Salessheets koppelen in één batch.** `scripts/link-salessheet-pdfs.ts` over het hele
      archief. Die duwt alles door `/api/shipments/import-email`, dezelfde route als de e-mailstroom,
      dus de datum- en leverancierscontrole gelden.
- [ ] **6. Koppelingen auditen.** `scripts/audit-salessheet-links.ts` leest elke gekoppelde PDF
      terug en vergelijkt de leverdatum. Hoort nul afwijkingen te geven. Geeft het er wel, dan is de
      koppelroute niet streng genoeg en moet dát gerepareerd worden, niet de data.

## Wat er nog moet gebeuren voordat dit kan

- [ ] **Een terugkerende inhaalronde.** Nu is dat handwerk. Kandidaat: een derde `SyncSchedule`-rij
      die maandelijks een kwartaal uit het verleden opnieuw ophaalt, zodat herzieningen vanzelf
      binnenkomen in plaats van pas bij de volgende reconciliatie.
- [ ] **Partijen-backfill.** Orders en kosten zijn deze week portalbreed opnieuw opgehaald, partijen
      niet. Steellengtes, colli, kwaliteitscodes en correcties dateren dus nog van vóór de
      reparaties, en de leveranciertoewijzing verhuist pas als er een lots-ronde langskomt.
- [ ] **Beslissen over `Grower.supplierId`** (zie `todo-kweker-bij-meerdere-leveranciers.md`). Bij
      een schone start is dat het moment om het model goed te zetten, want dan is er nog niets om te
      migreren.

## Niet doen

- Niet koppelen vóór de backfill klaar is. De koppeling matcht op referentie plus leverdatum; staan
  de leveringen er nog niet, dan mislukt de koppeling stil en moet het archief opnieuw langs.
