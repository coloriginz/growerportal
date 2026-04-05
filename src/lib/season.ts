/**
 * Season date helpers.
 *
 * A grower's season starts on a configurable month (1-12).
 * If the current month >= startMonth, the season started this calendar year;
 * otherwise it started the previous calendar year.
 */

const SHORT_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/** Return the start date of the current season. */
export function getSeasonStart(now: Date, seasonStartMonth: number): Date {
  const year = now.getMonth() + 1 >= seasonStartMonth
    ? now.getFullYear()
    : now.getFullYear() - 1;
  return new Date(year, seasonStartMonth - 1, 1);
}

/** Return the season start and equivalent "same date" for the previous season (for YoY comparison). */
export function getPreviousSeasonDates(
  now: Date,
  seasonStartMonth: number,
): { seasonStart: Date; sameDate: Date } {
  const currentSeasonStart = getSeasonStart(now, seasonStartMonth);
  const seasonStart = new Date(
    currentSeasonStart.getFullYear() - 1,
    currentSeasonStart.getMonth(),
    1,
  );
  const sameDate = new Date(now);
  sameDate.setFullYear(sameDate.getFullYear() - 1);
  return { seasonStart, sameDate };
}

/** Return a label like "Jan - Dec" or "Oct - Sep" for the season range. */
export function getSeasonLabel(seasonStartMonth: number): string {
  const startIdx = seasonStartMonth - 1; // 0-based
  const endIdx = (seasonStartMonth - 2 + 12) % 12; // month before start = end of season
  return `${SHORT_MONTHS[startIdx]} - ${SHORT_MONTHS[endIdx]}`;
}
