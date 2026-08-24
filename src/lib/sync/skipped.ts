/**
 * Eén Fabric-relatie waarvan de lots-import partijen heeft overgeslagen omdat
 * er nog geen `Supplier` voor bestaat.
 */
export type SkippedRelation = {
  relId: number;
  partijen: number;
  productie: number;
};

/**
 * `ImportBatch.details.skippedSuppliers` zoals de lots-import hem wegschrijft.
 * Bestaande batches (van vóór dit onderscheid) dragen nog de oude vorm: een
 * kaal getal in plaats van een `{ partijen, productie }`-object. Beide vormen
 * kunnen naast elkaar in dezelfde batch-geschiedenis voorkomen, dus deze
 * functie moet ze allebei kunnen lezen — niet alleen de nieuwste.
 */
type RawSkippedSuppliers = Record<string, number | { partijen: number; productie: number }>;

/**
 * Scheidt overgeslagen relaties in kwekers (mogelijk een leverancier om aan
 * te maken) van interne boekingen (productieorders, geen kweker).
 *
 * De regel: een relatie waarvan **alle** overgeslagen partijen productie-
 * boekingen zijn, is een interne boeking; al het andere is een kweker. Bij
 * twijfel — waaronder de oude vorm, waar productie onbekend is — valt de
 * relatie naar kweker. Iemand ten onrechte in de kwekerslijst zien staan kost
 * een blik; een echte kweker die stilzwijgend verdwijnt kost een seizoen aan
 * data.
 *
 * Onbruikbare invoer (niet-numerieke sleutels, niet-numerieke of onvolledige
 * waarden) wordt genegeerd in plaats van dat de functie gooit — dit leest
 * JSON uit een databasekolom die niet gevalideerd is bij het schrijven.
 */
export function classificeerOvergeslagen(skipped: unknown): {
  kwekers: SkippedRelation[];
  interneBoekingen: SkippedRelation[];
} {
  const kwekers: SkippedRelation[] = [];
  const interneBoekingen: SkippedRelation[] = [];

  if (skipped == null || typeof skipped !== "object" || Array.isArray(skipped)) {
    return { kwekers, interneBoekingen };
  }

  for (const [key, value] of Object.entries(skipped as RawSkippedSuppliers)) {
    if (!/^\d+$/.test(key.trim())) continue; // niet-numerieke sleutel: overslaan
    const relId = Number(key);
    if (!Number.isFinite(relId)) continue;

    if (typeof value === "number") {
      // Oude vorm: kaal aantal partijen, productie onbekend → twijfel valt naar kweker.
      if (!Number.isFinite(value)) continue;
      kwekers.push({ relId, partijen: value, productie: 0 });
      continue;
    }

    if (
      value !== null &&
      typeof value === "object" &&
      typeof (value as { partijen?: unknown }).partijen === "number" &&
      typeof (value as { productie?: unknown }).productie === "number"
    ) {
      const { partijen, productie } = value as { partijen: number; productie: number };
      if (!Number.isFinite(partijen) || !Number.isFinite(productie)) continue;

      const relatie: SkippedRelation = { relId, partijen, productie };
      if (partijen > 0 && productie === partijen) {
        interneBoekingen.push(relatie);
      } else {
        kwekers.push(relatie);
      }
      continue;
    }

    // Onherkenbare waarde (string, array, onvolledig object, ...): overslaan.
  }

  kwekers.sort((a, b) => b.partijen - a.partijen);
  interneBoekingen.sort((a, b) => b.partijen - a.partijen);

  return { kwekers, interneBoekingen };
}
