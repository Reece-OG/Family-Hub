// Public holiday sync using the free Nager.Date API.
// Docs: https://date.nager.at/swagger/index.html
//
// We fetch two years (current + next) for the configured country code and
// upsert them into the Holiday table. Called on first boot (lazy) and whenever
// a parent clicks "Resync holidays" in settings.

import { prisma } from "./prisma";

export interface NagerHoliday {
  date: string; // YYYY-MM-DD
  localName: string;
  name: string;
  countryCode: string;
  fixed?: boolean;
  global?: boolean;
  counties?: string[] | null;
  launchYear?: number | null;
  types?: string[];
}

const NAGER_BASE = "https://date.nager.at/api/v3/PublicHolidays";

async function fetchYear(year: number, countryCode: string): Promise<NagerHoliday[]> {
  const url = `${NAGER_BASE}/${year}/${countryCode.toUpperCase()}`;
  const res = await fetch(url, {
    // Hint to any caching layer we're fine with day-old data.
    next: { revalidate: 86_400 },
  });
  if (!res.ok) {
    throw new Error(`Nager.Date request failed (${res.status}) for ${countryCode} ${year}`);
  }
  const data = (await res.json()) as NagerHoliday[];
  if (!Array.isArray(data)) {
    throw new Error(`Nager.Date returned unexpected payload for ${countryCode} ${year}`);
  }
  return data;
}

/**
 * Sync holidays for the current and next calendar year.
 * Safe to call on every boot; upsert makes it idempotent.
 */
export async function syncHolidays(countryCode: string): Promise<{
  countryCode: string;
  years: number[];
  inserted: number;
  updated: number;
}> {
  const now = new Date();
  const years = [now.getUTCFullYear(), now.getUTCFullYear() + 1];
  let inserted = 0;
  let updated = 0;

  for (const year of years) {
    const rows = await fetchYear(year, countryCode);
    for (const row of rows) {
      const date = new Date(`${row.date}T00:00:00.000Z`);
      if (Number.isNaN(date.getTime())) continue;
      const result = await prisma.holiday.upsert({
        where: {
          // Composite unique: countryCode + date + name
          countryCode_date_name: {
            countryCode: row.countryCode.toUpperCase(),
            date,
            name: row.name,
          },
        },
        create: {
          countryCode: row.countryCode.toUpperCase(),
          date,
          name: row.name,
          localName: row.localName ?? null,
          year,
          global: row.global ?? true,
          counties: row.counties && row.counties.length ? row.counties.join(",") : null,
        },
        update: {
          localName: row.localName ?? null,
          year,
          global: row.global ?? true,
          counties: row.counties && row.counties.length ? row.counties.join(",") : null,
        },
      });
      if (result.createdAt.getTime() === result.updatedAt.getTime()) {
        inserted += 1;
      } else {
        updated += 1;
      }
    }
  }

  await prisma.appSettings.update({
    where: { id: "singleton" },
    data: { lastHolidaySync: new Date(), countryCode: countryCode.toUpperCase() },
  });

  return { countryCode: countryCode.toUpperCase(), years, inserted, updated };
}

/**
 * Return cached holidays between two dates (inclusive).
 *
 * Each row carries a pre-computed `dateKey` of the form YYYY-MM-DD derived
 * from the UTC date parts of `date`. Holidays are stored at UTC midnight
 * (see `syncHolidays` above), so the UTC date parts are the calendar day
 * the holiday is intended to fall on. The client uses `dateKey` directly
 * to match calendar cells, avoiding any `toISOString()`/local-time drift
 * that used to push Anzac Day onto April 24 or April 26 depending on
 * which side of UTC the viewer was on.
 */
export async function listHolidays(
  countryCode: string,
  from: Date,
  to: Date,
): Promise<
  {
    id: string;
    date: Date;
    dateKey: string;
    name: string;
    localName: string | null;
    global: boolean;
  }[]
> {
  const rows = await prisma.holiday.findMany({
    where: {
      countryCode: countryCode.toUpperCase(),
      date: { gte: from, lte: to },
    },
    orderBy: { date: "asc" },
    select: { id: true, date: true, name: true, localName: true, global: true },
  });
  return rows.map((r) => ({
    ...r,
    // Use getUTC* rather than toISOString + slice so we're explicit that
    // we want the UTC calendar day, not the viewer's local calendar day.
    dateKey: utcDateKey(r.date),
  }));
}

function utcDateKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Auto-sync on first run: if the Holiday table is empty for the configured
 * country, attempt a sync. Failures are swallowed so the app still boots
 * when outbound internet is unavailable.
 */
export async function autoSyncIfEmpty(): Promise<void> {
  try {
    const settings = await prisma.appSettings.findUnique({ where: { id: "singleton" } });
    if (!settings || !settings.showHolidays) return;
    const count = await prisma.holiday.count({
      where: { countryCode: settings.countryCode.toUpperCase() },
    });
    if (count > 0) return;
    await syncHolidays(settings.countryCode);
  } catch (err) {
    console.warn("[holidays] auto-sync skipped:", err instanceof Error ? err.message : err);
  }
}
