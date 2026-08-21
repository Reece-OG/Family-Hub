import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { handleError } from "@/lib/http";
import { getSettings } from "@/lib/settings";
import { listHolidays, syncHolidays } from "@/lib/holidays";

export async function GET(req: NextRequest) {
  try {
    const me = await requireUser();
    if (!can(me, "canViewCalendar")) {
      throw new HttpError(403, "No permission to view calendar");
    }
    const settings = await getSettings();
    if (!settings.showHolidays) {
      return NextResponse.json({ holidays: [], settings });
    }

    // Lazy first-time sync: if we've never cached any holidays for this country,
    // fetch them now. Fails silently if no outbound internet — user can still
    // use the calendar, they just won't see holidays.
    const cachedCount = await prisma.holiday.count({
      where: { countryCode: settings.countryCode.toUpperCase() },
    });
    if (cachedCount === 0) {
      try {
        await syncHolidays(settings.countryCode);
      } catch (err) {
        console.warn(
          "[holidays] lazy sync failed:",
          err instanceof Error ? err.message : err,
        );
      }
    }

    const url = new URL(req.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const fromDate = from ? new Date(from) : new Date(new Date().getFullYear(), 0, 1);
    const toDate = to ? new Date(to) : new Date(new Date().getFullYear() + 1, 11, 31);
    const holidays = await listHolidays(settings.countryCode, fromDate, toDate);
    return NextResponse.json({ holidays, settings });
  } catch (e) {
    return handleError(e);
  }
}

// Manual resync — parents only.
export async function POST(_req: NextRequest) {
  try {
    const me = await requireUser();
    if (me.role !== "PARENT") {
      throw new HttpError(403, "Only parents can resync holidays");
    }
    const settings = await getSettings();
    const result = await syncHolidays(settings.countryCode);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return handleError(e);
  }
}
