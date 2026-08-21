import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { handleError } from "@/lib/http";
import { getSettings } from "@/lib/settings";
import { syncHolidays } from "@/lib/holidays";
import { resetEmailTransporter } from "@/lib/email";
import { ALL_MODULE_IDS, MODULES } from "@/lib/modules";

const patchSchema = z.object({
  countryCode: z
    .string()
    .length(2)
    .regex(/^[A-Za-z]{2}$/)
    .optional(),
  timezone: z.string().min(3).max(64).optional(),
  showHolidays: z.boolean().optional(),
  // v3 additions
  smtpHost: z.string().max(200).optional().nullable(),
  smtpPort: z.number().int().min(1).max(65535).optional().nullable(),
  smtpSecure: z.boolean().optional(),
  smtpUser: z.string().max(200).optional().nullable(),
  smtpPass: z.string().max(500).optional().nullable(),
  smtpFrom: z.string().max(200).optional().nullable(),
  screensaverIntervalMs: z.number().int().min(1000).max(600_000).optional(),
  sleepModeEnabled: z.boolean().optional(),
  sleepStartTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "Expected HH:mm")
    .optional(),
  sleepEndTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "Expected HH:mm")
    .optional(),
  sleepIdleMinutes: z.number().int().min(1).max(240).optional(),
  weekStartsOn: z.number().int().min(0).max(1).optional(),
  // v4.4 additions — group colours and screensaver idle timeout.
  todoColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
  birthdayColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
  holidayColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
  screensaverIdleMinutes: z.number().int().min(0).max(240).optional(),
  // v4.6 — screensaver shuffle + weather.
  screensaverShuffle: z.boolean().optional(),
  weatherEnabled: z.boolean().optional(),
  weatherShowOnHome: z.boolean().optional(),
  weatherShowOnScreensaver: z.boolean().optional(),
  weatherLocationLabel: z.string().max(200).nullable().optional(),
  weatherLatitude: z.number().min(-90).max(90).nullable().optional(),
  weatherLongitude: z.number().min(-180).max(180).nullable().optional(),
  weatherProvider: z.enum(["auto", "bom", "open-meteo"]).optional(),
  weatherUnits: z.enum(["metric", "imperial"]).optional(),
  // v4.7.4 — financial year window used by My Taxes. Day clamped 1–28 to
  // dodge month-length pain (no 31 Feb). UI defaults to 1 July (Australian).
  financialYearStartMonth: z.number().int().min(1).max(12).optional(),
  financialYearStartDay: z.number().int().min(1).max(28).optional(),
  // v4.8.2 — app-wide module hide list. Unknown IDs are silently dropped
  // server-side; modules pinned globally (dashboard / settings) can't be
  // hidden via this route even if someone hand-crafts a payload.
  disabledModules: z.array(z.string()).optional(),
});

export async function GET() {
  try {
    await requireUser();
    const settings = await getSettings();
    return NextResponse.json({ settings });
  } catch (e) {
    return handleError(e);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const me = await requireUser();
    if (me.role !== "PARENT") {
      throw new HttpError(403, "Only parents can update settings");
    }
    const input = patchSchema.parse(await req.json());
    const existing = await getSettings();
    const nextCountry = input.countryCode?.toUpperCase() ?? existing.countryCode;
    const countryChanged = nextCountry !== existing.countryCode;

    // Only include keys that were actually supplied so we can partially patch.
    const data: Record<string, unknown> = {
      countryCode: nextCountry,
      timezone: input.timezone ?? existing.timezone,
      showHolidays:
        input.showHolidays === undefined ? existing.showHolidays : input.showHolidays,
    };
    if (input.smtpHost !== undefined) data.smtpHost = input.smtpHost;
    if (input.smtpPort !== undefined) data.smtpPort = input.smtpPort;
    if (input.smtpSecure !== undefined) data.smtpSecure = input.smtpSecure;
    if (input.smtpUser !== undefined) data.smtpUser = input.smtpUser;
    if (input.smtpPass !== undefined) data.smtpPass = input.smtpPass;
    if (input.smtpFrom !== undefined) data.smtpFrom = input.smtpFrom;
    if (input.screensaverIntervalMs !== undefined)
      data.screensaverIntervalMs = input.screensaverIntervalMs;
    if (input.sleepModeEnabled !== undefined)
      data.sleepModeEnabled = input.sleepModeEnabled;
    if (input.sleepStartTime !== undefined)
      data.sleepStartTime = input.sleepStartTime;
    if (input.sleepEndTime !== undefined)
      data.sleepEndTime = input.sleepEndTime;
    if (input.sleepIdleMinutes !== undefined)
      data.sleepIdleMinutes = input.sleepIdleMinutes;
    if (input.weekStartsOn !== undefined)
      data.weekStartsOn = input.weekStartsOn;
    if (input.todoColor !== undefined) data.todoColor = input.todoColor;
    if (input.birthdayColor !== undefined)
      data.birthdayColor = input.birthdayColor;
    if (input.holidayColor !== undefined)
      data.holidayColor = input.holidayColor;
    if (input.screensaverIdleMinutes !== undefined)
      data.screensaverIdleMinutes = input.screensaverIdleMinutes;
    if (input.screensaverShuffle !== undefined)
      data.screensaverShuffle = input.screensaverShuffle;
    if (input.weatherEnabled !== undefined)
      data.weatherEnabled = input.weatherEnabled;
    if (input.weatherShowOnHome !== undefined)
      data.weatherShowOnHome = input.weatherShowOnHome;
    if (input.weatherShowOnScreensaver !== undefined)
      data.weatherShowOnScreensaver = input.weatherShowOnScreensaver;
    if (input.weatherLocationLabel !== undefined)
      data.weatherLocationLabel = input.weatherLocationLabel;
    if (input.weatherLatitude !== undefined)
      data.weatherLatitude = input.weatherLatitude;
    if (input.weatherLongitude !== undefined)
      data.weatherLongitude = input.weatherLongitude;
    if (input.weatherProvider !== undefined)
      data.weatherProvider = input.weatherProvider;
    if (input.weatherUnits !== undefined)
      data.weatherUnits = input.weatherUnits;
    if (input.financialYearStartMonth !== undefined)
      data.financialYearStartMonth = input.financialYearStartMonth;
    if (input.financialYearStartDay !== undefined)
      data.financialYearStartDay = input.financialYearStartDay;
    if (input.disabledModules !== undefined) {
      const valid = new Set<string>(ALL_MODULE_IDS);
      const globallyHideable = new Set(
        MODULES.filter((m) => m.globalHideable).map((m) => m.id),
      );
      data.disabledModules = input.disabledModules.filter(
        (id) => valid.has(id) && globallyHideable.has(id as never),
      );
    }

    const smtpTouched =
      input.smtpHost !== undefined ||
      input.smtpPort !== undefined ||
      input.smtpSecure !== undefined ||
      input.smtpUser !== undefined ||
      input.smtpPass !== undefined ||
      input.smtpFrom !== undefined;

    const settings = await prisma.appSettings.update({
      where: { id: "singleton" },
      data,
    });

    // Nodemailer transporter caches connection details. Dump the cache so the
    // next send picks up the new SMTP config.
    if (smtpTouched) resetEmailTransporter();

    // If the country changed (or holidays were just switched on and none are
    // cached yet), trigger a background resync. We don't await — the GET
    // /api/holidays route will show whatever's cached in the meantime.
    if (countryChanged || (input.showHolidays === true && !existing.showHolidays)) {
      syncHolidays(settings.countryCode).catch((err) =>
        console.warn("[settings] post-update holiday resync failed:", err),
      );
    }

    return NextResponse.json({ settings });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: e.errors }, { status: 400 });
    }
    return handleError(e);
  }
}
