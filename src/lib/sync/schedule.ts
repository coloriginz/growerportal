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

function parseAtTime(atTime: string): number {
  const [hh, mm] = atTime.split(":").map(Number);
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
    if (minutesOfDay(now) < parseAtTime(schedule.atTime)) return false;
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
