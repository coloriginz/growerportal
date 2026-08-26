# Uitzoeken: negatieve herzieningen na de ordersreparatie

> **Aanleiding:** de reparatierun van 25-08-2026 (`tasks/repair-zero-orders-volledig.md`) zette de
> portal gelijk aan wat Fabric nu heeft. Meestal betekende dat méér stelen en meer omzet — netto
> +2.826.518 stelen en +EUR 1.097.035,47 — maar bij een handvol kwartalen ging het de andere kant op.
> Dat het warehouse historie *navult* is begrepen en vastgelegd. Dat het omzet naar beneden bijstelt
> is iets anders en is niet onderzocht.
>
> **Status:** open. Niet blokkerend, maar wel voordat iemand deze cijfers als afgerekend beschouwt.

---

## Wat er gezien is

Rondes waar de portal ná de herimport lager uitkwam dan ervoor:

| ronde | nulregels | stelen | omzet |
|---|---|---|---|
| COLLATZC 2026 Q2 | 10 → 5 | −21.550 | −EUR 5.299,75 |
| MPOARAV 2026 Q1 | 25 → 26 | −4.200 | −EUR 9.960,00 |
| PCXRONEN 2026 Q2 | 2 → 0 | −7.500 | −EUR 1.177,40 |
| MPOXEIJC 2026 Q2 | 6 → 8 | −4.980 | −EUR 1.478,40 |
| COLFLCEU 2026 Q2 | 35 → 3 | +3.050 | −EUR 2.621,20 |
| MPPAEONN 2026 Q2 | 42 → 32 | +8.204 | −EUR 4.692,56 |

De laatste twee zijn de interessantste: meer stelen én minder omzet in dezelfde ronde.

Daarnaast namen bij acht rondes de nulregels toe (MPPAEONN 2026 Q3: 23 → 57, COLXGREE 2026 Q1:
25 → 34, COLXTOG2 2026 Q2: 2 → 10). Allemaal in recente kwartalen. **Dat deel is waarschijnlijk
geen probleem:** dat zijn regels die net binnen zijn en nog niet afgewikkeld, precies het patroon
dat in CLAUDE.md staat. Een volgende reparatieronde pakt ze op. Het hoort wel bevestigd te worden
in plaats van aangenomen.

## Te beantwoorden

- [ ] Is de daling een echte herziening in Fabric, of een artefact van de herimport?
      Beginnen bij COLLATZC 2026 Q2, de grootste.
- [ ] Zo echt: waar komt hij vandaan? Kandidaten om te toetsen, niet om aan te nemen:
      creditering of terugboeking, een partij die van consignatie naar FOB/CIF is omgeboekt
      (die valt dan uit `CONSIGNMENT_PURCHASE_TYPES` en dus uit de import), een orderregel die
      naar een andere leverancier of kweker is verplaatst, of een splitsing die tot minder rijen
      leidde.
- [ ] Meer stelen én minder omzet tegelijk (COLFLCEU, MPPAEONN) wijst op een prijsherziening
      naast een volumeherziening. Apart bekijken.
- [ ] Klopt de aanname dat de toegenomen nulregels in recente kwartalen onafgewikkelde regels zijn?
      Toetsen door van een paar de `vor_aantal` en `afrekenprijs_per_steel` in Fabric op te vragen.

## Aanpak

De portal heeft geen "vorige stand" meer — de herimport heeft die overschreven. Wat er wél is:

- `tasks/repair-zero-orders-volledig.md` en de logregels per ronde: de saldi voor en na.
- De sales sheets zelf. **Henk Pieter kan de PDF's van de betrokken leveringen aanleveren**;
  dat is de enige onafhankelijke bron over wat er destijds is afgerekend en het snelste bewijs of
  de nieuwe of de oude stand klopt.
- `marts.fct_orders` via `scripts/fabric-query.js`, met `bronfeit_extra` en `reden_id` — die twee
  velden zeggen iets over correcties en zijn hier nog niet gebruikt.
- `ImportBatch` van de reparatierun: per ronde staat vast welke batch wat schreef.

Volgorde: eerst COLLATZC 2026 Q2 op regelniveau naast de sales sheets leggen, dan pas de rest.
Eén geval helemaal begrijpen is meer waard dan zes half.

## Niet doen

- Niets terugdraaien voordat vaststaat welke stand klopt. Fabric is de bron; als de daling echt is,
  is de portal nu goed en was hij eerder fout.
