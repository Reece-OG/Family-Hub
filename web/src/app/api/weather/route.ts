import { NextRequest, NextResponse } from "next/server";
import { requireUser, HttpError } from "@/lib/auth";
import { handleError } from "@/lib/http";
import { getSettings } from "@/lib/settings";
import { fetchWeather, type WeatherProviderPref, type WeatherUnits } from "@/lib/weather";

// GET /api/weather — returns the current+forecast payload for the configured
// location. Dashboard & screensaver both hit this. Anyone signed in can read
// it (it's not sensitive), but only parents can change the underlying config.

export const runtime = "nodejs";

export async function GET(_req: NextRequest) {
  try {
    await requireUser();
    const s = await getSettings();
    if (!s.weatherEnabled) {
      return NextResponse.json({ enabled: false });
    }
    if (
      s.weatherLatitude == null ||
      s.weatherLongitude == null ||
      !s.weatherLocationLabel
    ) {
      return NextResponse.json({
        enabled: true,
        configured: false,
        error: "Weather is enabled but no location is set.",
      });
    }

    const provider = (s.weatherProvider as WeatherProviderPref) ?? "auto";
    const units = (s.weatherUnits as WeatherUnits) ?? "metric";
    const isAU = s.countryCode?.toUpperCase() === "AU";

    const payload = await fetchWeather({
      latitude: s.weatherLatitude,
      longitude: s.weatherLongitude,
      locationLabel: s.weatherLocationLabel,
      provider,
      units,
      countryHintAU: isAU,
      // v4.7.16 — anchor Open-Meteo's daily columns to the app's configured
      // timezone so the home-page forecast cells line up with the user's
      // wall clock instead of the weather location's local time.
      appTimezone: s.timezone,
    });
    // v4.7.15 — surface the app's configured timezone alongside the payload so
    // the client renders weekday labels by the user's selected TZ, not the
    // browser/kiosk OS TZ (which on a UTC LXC produced "Sat" when the user's
    // selected TZ said it was Sunday).
    return NextResponse.json({
      enabled: true,
      configured: true,
      weather: payload,
      timezone: s.timezone || null,
    });
  } catch (e) {
    if (e instanceof HttpError) return handleError(e);
    console.warn("[weather] fetch failed:", e);
    return NextResponse.json(
      {
        enabled: true,
        configured: true,
        error:
          e instanceof Error
            ? `Weather fetch failed: ${e.message}`
            : "Weather fetch failed",
      },
      { status: 502 },
    );
  }
}
