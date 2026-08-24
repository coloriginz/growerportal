import type { QueryWindow } from "./types";

export type ScheduleState = {
  name: string;
  enabled: boolean;
  intervalMin: number | null;
  atTime: string | null;
  windowDays: number;
  lastRunAt: Date | null;
};

const ZONE = "Europe/Amsterdam";

/**
 * De klokstand in Amsterdam op een gegeven moment. Vercel Cron draait op UTC,
 * dus zonder deze omrekening verschuift de nachtronde een uur zodra de
 * wintertijd ingaat.
 */
function localParts(at: Date): { y: number; m: number; d: number; hh: number; mm: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return { y: get("year"), m: get("month"), d: get("day"), hh: get("hour"), mm: get("minute") };
}

/** Minuten sinds middernacht, lokale tijd. */
function minutesOfDay(at: Date): number {
  const { hh, mm } = localParts(at);
  return hh * 60 + mm;
}

/** De lokale kalenderdag als YYYY-MM-DD, om "al gedraaid vandaag" te bepalen. */
function localDay(at: Date): string {
  const { y, m, d } = localParts(at);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * "03:00" -> 180. Geeft null bij onzin. Zonder die controle wordt de
 * vergelijking NaN, valt de tijdpoort stilzwijgend weg, en verandert de
 * nachtronde in een "eens per lokale dag, zo vroeg mogelijk"-ronde.
 */
function parseAtTime(atTime: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(atTime.trim());
  if (!match) return null;

  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (hh > 23 || mm > 59) return null;

  return hh * 60 + mm;
}

export function isDue(schedule: ScheduleState, now: Date): boolean {
  if (!schedule.enabled) return false;

  // Ronde op interval.
  if (schedule.intervalMin != null) {
    if (!schedule.lastRunAt) return true;
    const elapsed = (now.getTime() - schedule.lastRunAt.getTime()) / 60000;
    return elapsed >= schedule.intervalMin;
  }

  // Ronde op tijdstip: due zodra het lokale tijdstip voorbij is en er vandaag
  // nog niet gedraaid is.
  if (schedule.atTime != null) {
    const at = parseAtTime(schedule.atTime);
    // Liever niet draaien dan op een gegokt tijdstip draaien.
    if (at === null) return false;
    if (minutesOfDay(now) < at) return false;
    if (!schedule.lastRunAt) return true;
    return localDay(schedule.lastRunAt) !== localDay(now);
  }

  return false;
}

/**
 * Het rollende venster. De bovengrens ligt bewust een dag in de toekomst zodat
 * leveringen van vandaag er zeker in vallen, ongeacht tijdzone.
 */
export function windowFor(windowDays: number, now: Date): QueryWindow {
  const to = new Date(now);
  to.setUTCHours(0, 0, 0, 0);
  to.setUTCDate(to.getUTCDate() + 1);

  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - windowDays - 1);

  return { from, to };
}

/**
 * Het venster voor één endpoint binnen een ronde. Valt terug op windowDays van
 * de ronde; een uitzondering in windowOverrides gaat voor.
 *
 * Kosten hebben een breder venster nodig dan partijen en orderregels: die
 * ontstaan bij levering, kosten bij afrekenen — en dat gebeurt weken later.
 */
export function windowForEndpoint(
  schedule: { windowDays: number; windowOverrides?: unknown },
  endpoint: string,
  now: Date
): QueryWindow {
  const overrides =
    schedule.windowOverrides &&
    typeof schedule.windowOverrides === "object" &&
    !Array.isArray(schedule.windowOverrides)
      ? (schedule.windowOverrides as Record<string, unknown>)
      : {};
  const raw = Number(overrides[endpoint]);
  // Een onbruikbare waarde valt terug op het venster van de ronde in plaats van
  // te gooien: een typefout in de uitzonderingskaart mag de sync niet stilzetten.
  const days = Number.isSafeInteger(raw) && raw > 0 ? raw : schedule.windowDays;
  return windowFor(days, now);
}

export type AdviesVeld = "windowDays" | "windowOverrides" | "intervalMin" | "endpoints" | "schema";
export type ScheduleAdvies = { veld: AdviesVeld; melding: string };

/** Kosten zijn pas na drie weken compleet; zie de meting in het ontwerp. */
const COSTS_MINIMUM_DAGEN = 21;

type AdviesInvoer = {
  enabled: boolean;
  intervalMin: number | null;
  atTime: string | null;
  endpoints: string[];
  windowDays: number;
  windowOverrides: unknown;
};

/**
 * Het venster voor één endpoint, plus waar het vandaan komt. Die herkomst is
 * nodig om de waarschuwing bij het juiste invoerveld te zetten: afleiden uit
 * "is de waarde gelijk aan windowDays" gaat mis zodra iemand een uitzondering
 * instelt die toevallig hetzelfde getal heeft.
 */
function vensterVoor(
  schedule: AdviesInvoer,
  endpoint: string
): { dagen: number; uitUitzondering: boolean } {
  const map =
    schedule.windowOverrides && typeof schedule.windowOverrides === "object" &&
    !Array.isArray(schedule.windowOverrides)
      ? (schedule.windowOverrides as Record<string, unknown>)
      : {};
  const raw = Number(map[endpoint]);
  return Number.isSafeInteger(raw) && raw > 0
    ? { dagen: raw, uitUitzondering: true }
    : { dagen: schedule.windowDays, uitUitzondering: false };
}

/**
 * Waarschuwt bij instellingen die aantoonbaar data laten missen, zonder ze te
 * weigeren. Blokkeren zou betekenen dat wie iets bewust anders wil het alsnog
 * in de database gaat zetten, en dan is er helemaal geen zicht meer op.
 *
 * Een uitgezet schema levert geen waarschuwingen op: dat draait niet, dus het
 * mist ook niets.
 */
export function windowAdvies(schedule: AdviesInvoer): ScheduleAdvies[] {
  if (!schedule.enabled) return [];
  const advies: ScheduleAdvies[] = [];

  if (schedule.intervalMin == null && schedule.atTime == null) {
    advies.push({
      veld: "schema",
      melding: "Without an interval or a time of day this schedule never runs.",
    });
  }

  if (schedule.intervalMin != null && schedule.intervalMin < 5) {
    advies.push({
      veld: "intervalMin",
      melding: "The cron ticks every five minutes, so a shorter interval changes nothing.",
    });
  }

  if (schedule.endpoints.length === 0) {
    advies.push({ veld: "endpoints", melding: "This schedule has nothing to fetch." });
  }

  // Hoe vaak deze ronde draait, in dagen. Een ronde op tijdstip draait dagelijks.
  const frequentieDagen = schedule.intervalMin != null ? schedule.intervalMin / 1440 : 1;

  for (const endpoint of schedule.endpoints) {
    const { dagen: venster, uitUitzondering } = vensterVoor(schedule, endpoint);

    if (endpoint === "costs" && venster < COSTS_MINIMUM_DAGEN) {
      advies.push({
        veld: "windowOverrides",
        melding: `Costs settle weeks after delivery: one week in, 45% of the cost lines exist, two weeks in 88%. Below ${COSTS_MINIMUM_DAGEN} days this misses cost lines every run, without an error.`,
      });
      continue; // de frequentiecontrole hieronder voegt hier niets aan toe
    }

    if (venster < frequentieDagen * 2) {
      advies.push({
        veld: uitUitzondering ? "windowOverrides" : "windowDays",
        melding: `The window for ${endpoint} is narrower than two runs. Miss one run and the window slides past deliveries that were never fetched.`,
      });
    }
  }

  return advies;
}

/**
 * Waarschuwingen over de samenhang tússen schema's.
 *
 * `ScheduleAdvies` heeft een `veld`, want elke waarschuwing daar hoort bij één
 * invoerveld van één schema. Dat werkt hier niet: de ketenafhankelijkheid zit
 * niet in een veld en niet in een schema, maar in de verzameling. Vandaar een
 * eigen vorm met een `code` in plaats van een `veld` — het scherm zet ze
 * bovenaan in plaats van bij een invoer, en de controles kunnen op de code
 * sturen zonder de meldingstekst te lezen.
 */
export type KetenAdviesCode = "leveranciersronde-ontbreekt" | "lots-zonder-leveranciers";
export type KetenAdvies = { code: KetenAdviesCode; melding: string };

type KetenInvoer = { enabled: boolean; endpoints: string[] };

/**
 * De lots-import zoekt de leverancier op en gooit de partij stilzwijgend weg
 * als die er nog niet is. Zo zijn ooit 317 afrekeningen verdwenen zonder dat er
 * ergens een fout stond. Twee handelingen halen dat vangnet weg — de nachtronde
 * uitzetten, of `suppliers`/`growers` eruit vinken — en allebei zien er op het
 * scherm uit als één klik zonder gevolgen.
 */
export function ketenAdvies(schedules: readonly KetenInvoer[]): KetenAdvies[] {
  const actief = schedules.filter((s) => s.enabled);
  const advies: KetenAdvies[] = [];

  const heeftKetenkop = actief.some(
    (s) => s.endpoints.includes("suppliers") && s.endpoints.includes("growers")
  );
  if (!heeftKetenkop) {
    advies.push({
      code: "leveranciersronde-ontbreekt",
      melding:
        "No enabled schedule fetches both suppliers and growers. New suppliers never reach the portal, and the lots import silently discards every lot that belongs to one.",
    });
  }

  const heeftLots = actief.some((s) => s.endpoints.includes("lots"));
  const heeftSuppliers = actief.some((s) => s.endpoints.includes("suppliers"));
  if (heeftLots && !heeftSuppliers) {
    advies.push({
      code: "lots-zonder-leveranciers",
      melding:
        "A schedule fetches lots while no enabled schedule fetches suppliers. Lots of suppliers that are not in the portal yet are dropped without an error — this is how 317 salessheets once disappeared.",
    });
  }

  return advies;
}
