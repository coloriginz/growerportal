/*
 * Wat er gebeurt met een levering die Fabric aan iemand anders toeschrijft.
 *
 * De lots-import gooit bij het binnenkomen elke partij weg waarvan de relatie
 * geen portalleverancier is. Bij het weggaan deed hij dat niet: een levering die
 * het warehouse herbestemde naar een niet-geactiveerde relatie bleef staan waar
 * hij ooit terechtkwam, en werd alleen gemeld. Die asymmetrie was niet ontworpen
 * maar over het hoofd gezien, en ze is duurder dan ze lijkt.
 *
 * Gemeten op 29-08-2026, één levering portalbreed: INT000072 stond onder
 * COLXAFRI (Africalla Kenya) terwijl `marts.fct_partijen` hem toeschrijft aan
 * relatie 29778 (Ole Engai Growers) — twee ongerelateerde partijen, ooit een
 * invoerfout die later in de bron is rechtgezet. De sales sheet-PDF eronder heet
 * `COLXOLE - ... - INT000072 - ...`: het document staat zelf op naam van Ole
 * Engai. Africalla kon daarmee de afrekening van een derde openen, met omzet,
 * kosten en prijzen erin. Melden alleen is voor zoiets geen antwoord.
 *
 * De regel is nu symmetrisch: hoort de levering volgens Fabric bij een relatie
 * die de portal niet voert, dan voert de portal die levering ook niet. Wordt de
 * relatie later geactiveerd, dan haalt een backfill hem gewoon opnieuw op — nu
 * wél onder de juiste leverancier.
 *
 * De bovengrens is de rem. Herbestemming is zeldzaam (één op 7.879 leveringen);
 * gaat het er ineens om tientallen, dan is er iets anders mis — een halve
 * leverancierstabel, een batch met verkeerde relatie-ids — en is niet
 * verwijderen het veilige antwoord. Dan alleen melden, luid.
 */

/** Hoeveel leveringen één ronde ten hoogste mag weghalen. */
export const REATTRIBUTION_REMOVAL_CAP = 25;

export type ReattributedSheet = {
  id: string;
  parthdrId: number;
  /** De leverancier waar hij nu nog onder staat, voor de melding. */
  supplierCode: string;
  /** De relatie waar Fabric hem aan toeschrijft. */
  relId: number;
};

export type ReattributionPlan =
  | { mode: "remove"; sheets: ReattributedSheet[] }
  | { mode: "report"; reason: string };

export function planReattributionRemoval(input: {
  sheets: readonly ReattributedSheet[];
  cap?: number;
}): ReattributionPlan {
  const cap = input.cap ?? REATTRIBUTION_REMOVAL_CAP;
  const sheets = input.sheets;

  if (sheets.length === 0) return { mode: "report", reason: "geen herbestemde leveringen" };

  if (sheets.length > cap) {
    return {
      mode: "report",
      reason:
        `${sheets.length} herbestemde leveringen in één ronde, boven de grens van ${cap} — ` +
        "niet verwijderd. Zoveel herbestemmingen tegelijk wijst eerder op een fout in de " +
        "ronde dan op een correctie in de bron",
    };
  }

  return { mode: "remove", sheets: [...sheets] };
}
