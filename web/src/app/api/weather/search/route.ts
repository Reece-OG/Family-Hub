import { NextRequest, NextResponse } from "next/server";
import { requireUser, HttpError } from "@/lib/auth";
import { handleError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { geocode } from "@/lib/weather";

// GET /api/weather/search?q=... — proxies Open-Meteo's geocoding API (with a
// Nominatim fallback) so the browser doesn't have to make an extra round-trip
// to a third-party origin (which would also leak the user's IP to them).
// Parent-only because typing into the search box happens from the settings
// screen.
//
// We bias geocoder results toward the country the app is configured for
// (same setting that drives public holidays). Without this, a search for
// "North Richmond" returns the Quebec / New Jersey / North Carolina entries
// before the NSW suburb because OSM ranks globally by importance.
//
// An optional `?cc=XX` override on the query string lets the settings UI
// temporarily widen the search if the user ever needs to look outside the
// configured country.

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const me = await requireUser();
    if (me.role !== "PARENT") {
      throw new HttpError(403, "Only parents can change location settings");
    }
    const url = new URL(req.url);
    const q = url.searchParams.get("q")?.trim();
    if (!q) return NextResponse.json({ results: [] });

    // Priority: explicit ?cc=XX query-string override → configured country.
    // Empty string on the override means "don't filter" (search the world).
    let countryCode: string | null = null;
    const ccOverride = url.searchParams.get("cc");
    if (ccOverride !== null) {
      countryCode = ccOverride.trim() || null;
    } else {
      const settings = await prisma.appSettings.findUnique({
        where: { id: "singleton" },
        select: { countryCode: true },
      });
      countryCode = settings?.countryCode ?? null;
    }

    const results = await geocode(q, 6, countryCode);
    return NextResponse.json({ results });
  } catch (e) {
    return handleError(e);
  }
}
