import { quarterLabel, quarterStart } from "./backfill";
import { ask, describeError } from "./dispatch";
import { firstDeliveryQuery } from "./queries/first-delivery";

/**
 * Waar de basisdatum van deze backfill vandaan komt: `fabric` als de eerste
 * consignatiepartij hem later legde dan de instelling, `setting` als de globale
 * datum hem tegenhield — of als de vraag aan Fabric niet beantwoord kon worden.
 */
export type BackfillStartSource = "fabric" | "setting";

export type BackfillStart = {
  /**
   * Waar de backfill begint. `null` betekent: deze relatie heeft in Fabric geen
   * enkele consignatiepartij, er valt niets te halen. Dat is iets anders dan een
   * backfill vanaf de globale datum die toevallig leeg terugkomt — in dat geval
   * zouden er tweeëntwintig jobs draaien om nul rijen op te halen.
   */
  start: Date | null;
  source: BackfillStartSource;
  /** Wat Fabric antwoordde; null als er geen partij is of de vraag mislukte. */
  firstDelivery: Date | null;
};

/** Een resolutie waarvan vaststaat dat er iets te backfillen valt. */
export type ResolvedBackfillStart = BackfillStart & { start: Date };

/**
 * Type guard in plaats van een losse null-vergelijking bij de aanroeper: die
 * versmalt `start` wel in de `if`, maar niet in het object dat daarna wordt
 * doorgegeven, en dan staat er een non-null-assertion waar een controle hoort.
 */
export function hasStart(resolution: BackfillStart): resolution is ResolvedBackfillStart {
  return resolution.start !== null;
}

/** De vorm van `ask`, zodat de rekenkern zonder netwerk te beproeven is. */
export type AskRows = (query: string) => Promise<Record<string, unknown>[]>;

/**
 * De kalenderdag uit het antwoord van de vraag-flow, of null als de MIN leeg is.
 *
 * Op waarde en niet op kolomnaam: het antwoord heeft per afspraak één kolom, en
 * de flow staat los van deze code — een hernoemde alias mag geen stille `null`
 * opleveren die als "geen partij" gelezen wordt. Om dezelfde reden gooit een
 * antwoord dat er wél is maar niet te lezen valt: dat is een kapotte flow, geen
 * leverancier zonder partijen, en het verschil is tweeëntwintig jobs.
 *
 * Alleen de datum telt, en die wordt als UTC-middernacht gelezen. Fabric levert
 * "2026-07-01T00:00:00" zonder tijdzone; door `new Date()` heen is dat lokale
 * tijd, en dan valt precies zo'n grensdatum ten oosten van UTC een kwartaal te
 * vroeg.
 */
export function firstDeliveryFrom(rows: readonly Record<string, unknown>[]): Date | null {
  const waarde = rows.length === 0 ? null : (Object.values(rows[0])[0] ?? null);
  if (waarde === null) return null;

  if (waarde instanceof Date) {
    if (Number.isNaN(waarde.getTime())) throw new Error("De eerste levering is geen datum");
    return waarde;
  }

  const dag = String(waarde).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dag)) {
    throw new Error(`Onleesbare eerste levering: ${String(waarde).slice(0, 40)}`);
  }

  const gelezen = new Date(`${dag}T00:00:00.000Z`);
  if (Number.isNaN(gelezen.getTime())) throw new Error(`Onleesbare eerste levering: ${dag}`);
  return gelezen;
}

/**
 * De basisdatum van één backfill: het kwartaal van de eerste consignatiepartij,
 * maar nooit vóór de globale datum.
 *
 * Die ondergrens is het hele punt. Voor een pas ge-onboarde leverancier scheelt
 * de eerste partij zes lege kwartalen, maar COLXGREE levert sinds 30-08-2023 en
 * puur op de eerste partij plannen maakt zijn backfill juist groter — van zeven
 * kwartalen naar twaalf. De instelling zegt hoe ver de portal terug wíl, de
 * eerste partij zegt hoe ver terugvragen zin heeft; de latere van de twee wint.
 */
export function applyBackfillFloor(firstDelivery: Date | null, globalStart: Date): BackfillStart {
  if (firstDelivery === null) return { start: null, source: "fabric", firstDelivery: null };

  const vanaf = quarterStart(firstDelivery);
  if (vanaf > globalStart) return { start: vanaf, source: "fabric", firstDelivery };
  return { start: globalStart, source: "setting", firstDelivery };
}

/** De opgeloste startdatum zoals de POST-antwoorden hem teruggeven. */
export type BackfillStartDescription = {
  /** De dag waarop de eerste brok begint. */
  from: string;
  /** Datzelfde als kwartaal, want dat is waar het scherm in praat. */
  quarter: string;
  source: BackfillStartSource;
  firstDelivery: string | null;
};

/** Eigen ISO-dag in plaats van die uit `settings.ts`: dat bestand trekt Prisma mee. */
function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * De resolutie in de vorm waarin hij over de lijn gaat. Eén functie voor beide
 * aanroepers, anders krijgt het scherm bij activeren een ander veld terug dan
 * bij backfillen vanaf de leverancierspagina.
 */
export function describeStart(resolution: ResolvedBackfillStart): BackfillStartDescription {
  return {
    from: isoDay(resolution.start),
    quarter: quarterLabel(resolution.start),
    source: resolution.source,
    firstDelivery: resolution.firstDelivery ? isoDay(resolution.firstDelivery) : null,
  };
}

/**
 * Vraagt Fabric wanneer deze leverancier zijn eerste consignatiepartij leverde
 * en legt de basisdatum van zijn backfill vast.
 *
 * Een haperende vraag-flow valt terug op de globale datum in plaats van te
 * gooien: de aanroepers hangen achter "leverancier activeren", en dat mag niet
 * stranden op een flow die aantoonbaar uit kan vallen — op 19 augustus lag die
 * anderhalve dag plat. De terugval is de oude situatie, dus hooguit een backfill
 * met een paar lege kwartalen erin.
 *
 * Lokaal geeft `resolveSyncEnv()` null en gooit `ask` meteen; in development valt
 * hij dus altijd terug. Alleen op test en productie is dit echt te beproeven.
 *
 * `askRows` is injecteerbaar zodat de controles in `scripts/checks/` de
 * rekenkern én de terugval kunnen draaien zonder een flow aan te roepen.
 */
export async function resolveBackfillStart(
  supplierFabricId: number,
  globalStart: Date,
  askRows: AskRows = ask
): Promise<BackfillStart> {
  try {
    const rows = await askRows(firstDeliveryQuery(supplierFabricId));
    return applyBackfillFloor(firstDeliveryFrom(rows), globalStart);
  } catch (error) {
    console.warn(
      `[sync] eerste levering van relatie ${supplierFabricId} niet op te vragen, ` +
        `backfill valt terug op de globale startdatum: ${describeError(error)}`
    );
    return { start: globalStart, source: "setting", firstDelivery: null };
  }
}
