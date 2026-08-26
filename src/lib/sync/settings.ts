import { prisma } from "@/lib/db";

/**
 * De ondergrens voor backfills: hoe ver de portal terug wíl. Hoe ver terugvragen
 * zin heeft, weet Fabric — `resolveBackfillStart` in `backfill-start.ts` vraagt
 * per leverancier de eerste consignatiepartij op en neemt de latere van de twee.
 * Daarom staat er hier geen datum per leverancier: die zou een tweede kopie zijn
 * van iets wat in Fabric al staat en die loopt uit de pas zodra een leverancier
 * eerdere historie krijgt.
 *
 * Bewust niet in `/api/admin/settings`: die route geeft 403 zodra `isTest`
 * onwaar is en controleert geen rol — hij is gebouwd voor de e-mailinstellingen
 * van de testomgeving. Deze moet juist op productie werken en admin-only zijn.
 * Voeg ze dus niet samen.
 */
export const BACKFILL_START_KEY = "sync.backfillStartDate";

/**
 * Een kalenderdag in ISO-vorm als UTC-middernacht, of null als de tekst geen
 * bestaande dag is.
 *
 * De terugvergelijking met de invoer is de kern: `new Date("2024-02-30T…")`
 * levert geen ongeldige datum op maar 1 maart, en een instelling die stilletjes
 * een dag opschuift is erger dan een instelling die weigert. De regex vooraf
 * houdt daarnaast vormen buiten de deur die de parser wél aankan maar die hier
 * niets te zoeken hebben, zoals `+002024-01-01`.
 */
export function parseIsoDay(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === value ? parsed : null;
}

/** De ISO-dag van een UTC-middernacht, de vorm waarin de instelling opgeslagen staat. */
export function toIsoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Null als de instelling ontbreekt of onleesbaar is; nooit een gegokte datum. */
export async function readBackfillStart(): Promise<Date | null> {
  const row = await prisma.setting.findUnique({ where: { key: BACKFILL_START_KEY } });
  if (!row) return null;

  return parseIsoDay(row.value);
}

export async function writeBackfillStart(date: Date): Promise<void> {
  const value = toIsoDay(date);
  await prisma.setting.upsert({
    where: { key: BACKFILL_START_KEY },
    create: { key: BACKFILL_START_KEY, value },
    update: { value },
  });
}
