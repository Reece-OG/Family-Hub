// Weather fetchers. Two providers supported:
//
//   * Open-Meteo (https://open-meteo.com): free, no API key, worldwide. Used
//     as the default / fallback for every country. Returns current conditions
//     plus a short daily forecast.
//   * Australian Bureau of Meteorology (bom.gov.au): public JSON endpoints
//     for observation stations ("products"). We only query the nearest
//     observation station to the configured lat/lng, so this is strictly a
//     current-conditions source — we still lean on Open-Meteo for the
//     forecast.
//
// Note on "Google Weather": Google does not publish a free weather API. The
// user asked for "Google Weather for the rest of the world" which I've
// interpreted as "a reliable global weather source" — hence Open-Meteo.
// Swapping it for a paid provider later is a one-file change.

import { setDefaultResultOrder } from "node:dns";

// --- DNS / outbound-fetch reliability --------------------------------------
// Node 18+ defaults DNS result order to "verbatim" (i.e. whatever the
// resolver returned, usually AAAA before A). That's fine on most hosts, but
// a common LXC / VPS configuration has IPv6 addresses assigned to the
// interface with no working IPv6 route upstream. The fetch then tries the
// AAAA first and hangs / errors out with a generic "fetch failed" TypeError
// even though plain curl works.
//
// Two-layer fix:
//
//   1. (app-side) setDefaultResultOrder("ipv4first") — tells Node's default
//      dns.lookup to prefer A records. Covers most cases.
//
//   2. (LXC-side) the Family-Hub-LXC installer disables IPv6 on the
//      container's eth0 via sysctl (net.ipv6.conf.eth0.disable_ipv6=1) and
//      sets ip6=none on the net config. Once that's in place the kernel
//      refuses to open v6 sockets at all, so even if fetch did try AAAA
//      it'd fail instantly instead of hanging.
//
// If you're running Family Hub somewhere other than the provided LXC and
// IPv6 is broken outbound, the recommended fix is to disable IPv6 at the
// host level — the app-side setting is a best-effort safety net, not the
// primary mechanism.
try {
  setDefaultResultOrder("ipv4first");
} catch {
  // Older Node versions don't expose this — safe to ignore.
}

/**
 * Wrap the global fetch with:
 *   - a 10 s timeout so a wedged upstream doesn't hold the request open
 *   - an error decorator that pulls the real reason out of err.cause
 *
 * The default Node fetch turns DNS / TLS / connection failures into a
 * bare `TypeError: fetch failed`, which is useless for diagnostics. Here
 * we unwrap `err.cause` so the UI and server logs show something like
 * "DNS lookup failed for geocoding-api.open-meteo.com (EAI_AGAIN)".
 */
async function weatherFetch(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return res;
  } catch (err) {
    throw decorateFetchError(err, url);
  } finally {
    clearTimeout(timer);
  }
}

function decorateFetchError(err: unknown, url: string): Error {
  const host = safeHost(url);
  // AbortController fired — request exceeded 10s.
  if (err instanceof Error && err.name === "AbortError") {
    return new Error(`Weather request to ${host} timed out after 10s`);
  }
  // Node fetch wraps the real cause on the outer TypeError.
  const cause = (err as { cause?: { code?: string; hostname?: string; message?: string } })
    ?.cause;
  if (cause?.code === "EAI_AGAIN" || cause?.code === "ENOTFOUND") {
    return new Error(
      `DNS lookup failed for ${cause.hostname ?? host} (${cause.code}). ` +
        `Check the container's DNS settings — try adding 1.1.1.1 or 8.8.8.8 as a DNS server in Proxmox.`,
    );
  }
  if (cause?.code === "ECONNREFUSED" || cause?.code === "ECONNRESET") {
    return new Error(
      `Connection to ${host} refused (${cause.code}). The provider may be down or a firewall is blocking outbound HTTPS.`,
    );
  }
  if (cause?.code === "ETIMEDOUT" || cause?.code === "EHOSTUNREACH") {
    return new Error(
      `Connection to ${host} timed out (${cause.code}). Check the container's network / gateway.`,
    );
  }
  if (cause?.code === "CERT_HAS_EXPIRED" || cause?.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") {
    return new Error(`TLS certificate problem reaching ${host} (${cause.code}).`);
  }
  // Fallback — prefer the cause message if we have one, then the outer error.
  if (cause?.message) return new Error(`Fetch to ${host} failed: ${cause.message}`);
  if (err instanceof Error) return new Error(`Fetch to ${host} failed: ${err.message}`);
  return new Error(`Fetch to ${host} failed`);
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export type WeatherUnits = "metric" | "imperial";

export type WeatherProviderPref = "auto" | "bom" | "open-meteo";

export interface CurrentWeather {
  tempC: number | null;
  feelsLikeC: number | null;
  humidity: number | null; // 0–100
  windKph: number | null;
  windDirDeg: number | null;
  conditionCode: number | null; // Open-Meteo / WMO weather code
  conditionLabel: string;
  icon: string; // short label used by the UI to pick an icon
  isDay: boolean;
  observedAt: string; // ISO
}

export interface DailyForecast {
  date: string; // YYYY-MM-DD (local to the provider)
  minC: number | null;
  maxC: number | null;
  conditionCode: number | null;
  conditionLabel: string;
  icon: string;
  precipitationProbability: number | null; // 0–100
}

export interface WeatherPayload {
  provider: "open-meteo" | "bom";
  units: WeatherUnits;
  locationLabel: string;
  latitude: number;
  longitude: number;
  current: CurrentWeather;
  daily: DailyForecast[];
  fetchedAt: string; // ISO
}

// --- Geocoding --------------------------------------------------------------

export interface GeocodeHit {
  label: string; // "Sydney, New South Wales, Australia"
  latitude: number;
  longitude: number;
  countryCode: string | null; // ISO-2
  timezone?: string | null;
}

/**
 * Geocode a free-text location query. Tries Open-Meteo first (same
 * infrastructure as the weather API, consistent field shapes); if that
 * endpoint is unreachable — common in self-hosted LXCs where the ISP or
 * a firewall has dropped open-meteo's CDN IPs — falls back to Nominatim
 * (OpenStreetMap's hosted geocoder), which lives on entirely separate
 * infrastructure.
 *
 * Both are free and key-less. Nominatim's usage policy requires a
 * User-Agent that identifies the application; we set one.
 *
 * `countryCode` (ISO-2, e.g. "AU") biases results toward that country.
 * This is important: "North Richmond" exists in at least four countries
 * and OSM's importance score ranks the Quebec one above the AU suburb.
 * We pull this from the app's configured country (the same setting that
 * drives public holidays) so parents don't have to re-specify it.
 */
export async function geocode(
  q: string,
  limit = 5,
  countryCode: string | null = null,
): Promise<GeocodeHit[]> {
  if (!q.trim()) return [];
  try {
    return await geocodeOpenMeteo(q, limit, countryCode);
  } catch (primaryErr) {
    console.warn(
      "[weather] Open-Meteo geocoder failed, falling back to Nominatim:",
      primaryErr instanceof Error ? primaryErr.message : primaryErr,
    );
    try {
      return await geocodeNominatim(q, limit, countryCode);
    } catch (fallbackErr) {
      // Re-throw the ORIGINAL error — if both are unreachable, the
      // primary diagnostic is more helpful (it's the one the user was
      // probably trying to hit first).
      console.warn(
        "[weather] Nominatim fallback also failed:",
        fallbackErr instanceof Error ? fallbackErr.message : fallbackErr,
      );
      throw primaryErr;
    }
  }
}

async function geocodeOpenMeteo(
  q: string,
  limit: number,
  countryCode: string | null,
): Promise<GeocodeHit[]> {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", q.trim());
  url.searchParams.set("count", String(Math.max(1, Math.min(10, limit))));
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");
  // Open-Meteo supports an ISO-2 country filter. If the app is configured
  // for AU, don't surface a North Richmond from Quebec.
  if (countryCode && /^[A-Za-z]{2}$/.test(countryCode)) {
    url.searchParams.set("countryCode", countryCode.toUpperCase());
  }

  const res = await weatherFetch(url.toString(), {
    // Geocoding results are cacheable and small. Revalidate every day.
    next: { revalidate: 86_400 },
  } as RequestInit);
  if (!res.ok) throw new Error(`Open-Meteo geocoder failed (HTTP ${res.status})`);
  const data = await res.json();
  const results: any[] = Array.isArray(data?.results) ? data.results : [];
  return results.map((r) => ({
    label: [r.name, r.admin1, r.country].filter(Boolean).join(", "),
    latitude: Number(r.latitude),
    longitude: Number(r.longitude),
    countryCode: typeof r.country_code === "string" ? r.country_code : null,
    timezone: typeof r.timezone === "string" ? r.timezone : null,
  }));
}

/**
 * Fallback geocoder: OpenStreetMap's Nominatim. No key needed, but their
 * usage policy requires a User-Agent identifying the app + a 1 req/s
 * rate cap — which is fine since this only runs when a parent is typing
 * a location into the settings screen.
 *
 * When `countryCode` is provided, we pass it as `countrycodes=<cc>` which
 * restricts results to that country. Without it, a query like "North
 * Richmond" would surface Quebec / NJ / NC before the AU suburb because
 * OSM ranks by place importance.
 */
async function geocodeNominatim(
  q: string,
  limit: number,
  countryCode: string | null,
): Promise<GeocodeHit[]> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", q.trim());
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", String(Math.max(1, Math.min(10, limit))));
  if (countryCode && /^[A-Za-z]{2}$/.test(countryCode)) {
    url.searchParams.set("countrycodes", countryCode.toLowerCase());
  }

  const res = await weatherFetch(url.toString(), {
    next: { revalidate: 86_400 },
    headers: {
      // Nominatim policy: identify yourself. No contact email here; the
      // repo URL is enough per their published guidance for OSS apps.
      "user-agent": "Family-Hub/1 (+https://github.com/Reece-OG/Family-Hub)",
      accept: "application/json",
    },
  } as RequestInit);
  if (!res.ok) throw new Error(`Nominatim geocoder failed (HTTP ${res.status})`);
  const data = (await res.json()) as any[];
  if (!Array.isArray(data)) return [];
  return data.map((r) => {
    const addr = r?.address ?? {};
    // IMPORTANT: prefer the matched place's own name over the containing
    // city. Nominatim often returns a suburb hit (e.g. "North Richmond")
    // with address.city set to the containing metro ("Sydney"), and if
    // we took addr.city first we'd label every suburb with its metro —
    // so searching "North Richmond" would all look like "Sydney". Use
    // r.name (the actual matched place) and the most-specific address
    // fields first, fall through to city only as a last resort.
    const town =
      r?.name ||
      addr.suburb ||
      addr.neighbourhood ||
      addr.village ||
      addr.hamlet ||
      addr.town ||
      addr.city ||
      "";
    const admin1 = addr.state || addr.region || addr.county || "";
    const country = addr.country || "";
    // De-dupe the segments — if r.name happens to equal addr.state (rare
    // but possible for large admin areas), don't render "NSW, NSW, AU".
    const parts = [town, admin1, country].filter(
      (s, i, arr): s is string => Boolean(s) && arr.indexOf(s) === i,
    );
    const label = parts.join(", ") || r?.display_name || q;
    return {
      label,
      latitude: Number(r.lat),
      longitude: Number(r.lon),
      countryCode:
        typeof addr.country_code === "string" ? addr.country_code.toUpperCase() : null,
      timezone: null, // Nominatim doesn't return a tz; Open-Meteo does, but it's a nice-to-have.
    };
  });
}

// --- WMO weather-code mapping ----------------------------------------------

// Open-Meteo uses the standard WMO weather codes. We map them to a short
// label + icon-hint that the UI swaps to a Lucide icon. BOM provides its own
// text labels; we normalise those through the same icon set.
export function describeWmoCode(code: number | null, isDay = true): {
  label: string;
  icon: string;
} {
  if (code == null) return { label: "—", icon: "cloud" };
  if (code === 0) return { label: "Clear", icon: isDay ? "sun" : "moon" };
  if (code === 1) return { label: "Mostly Clear", icon: isDay ? "sun" : "moon" };
  if (code === 2) return { label: "Partly Cloudy", icon: isDay ? "cloud-sun" : "cloud-moon" };
  if (code === 3) return { label: "Overcast", icon: "cloud" };
  if (code === 45 || code === 48) return { label: "Fog", icon: "cloud-fog" };
  if (code >= 51 && code <= 57) return { label: "Drizzle", icon: "cloud-drizzle" };
  if (code >= 61 && code <= 67) return { label: "Rain", icon: "cloud-rain" };
  if (code >= 71 && code <= 77) return { label: "Snow", icon: "snowflake" };
  if (code >= 80 && code <= 82) return { label: "Showers", icon: "cloud-rain" };
  if (code === 85 || code === 86) return { label: "Snow Showers", icon: "snowflake" };
  if (code === 95) return { label: "Thunderstorm", icon: "cloud-lightning" };
  if (code === 96 || code === 99) return { label: "Thunder + Hail", icon: "cloud-lightning" };
  return { label: "Unknown", icon: "cloud" };
}

// v4.7.17 — extract a YYYY-MM-DD date string in the requested timezone from
// any ISO timestamp. We use the en-CA locale because it formats dates as
// "YYYY-MM-DD" natively, which sidesteps having to assemble the parts by
// hand. Falls back to the input's UTC date slice if anything goes wrong.
//
// Why this exists: BOM returns daily forecast `date` fields as UTC ISO
// timestamps like "2025-05-24T14:00:00Z" — that's midnight Sydney May 25,
// not May 24, so a naive `.slice(0, 10)` puts "today's" cell on the wrong
// calendar day in any TZ east of UTC. Same problem exists for the
// observation timestamp on the BOM `current` row.
function isoDateInTz(iso: string, tz: string | null | undefined): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz && tz.trim() ? tz : "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    // en-CA renders "2025-05-25" directly.
    return fmt.format(d);
  } catch {
    return iso.slice(0, 10);
  }
}

// v4.7.17 — companion helper to isoDateInTz: returns the local hour (0-23)
// of an ISO timestamp in the given timezone. Falls back to the JS engine's
// default zone if the IANA name is bad.
function hourInTz(iso: string, tz: string | null | undefined): number {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return new Date().getHours();
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz && tz.trim() ? tz : undefined,
      hour: "2-digit",
      hour12: false,
    });
    const h = Number(fmt.format(d));
    return Number.isFinite(h) ? h : new Date().getHours();
  } catch {
    return new Date(iso).getHours();
  }
}

// Crude text-to-icon mapper for BOM's free-text summaries.
function iconForBomText(text: string, isDay: boolean): string {
  const t = text.toLowerCase();
  if (t.includes("thunder")) return "cloud-lightning";
  if (t.includes("snow")) return "snowflake";
  if (t.includes("hail")) return "cloud-lightning";
  if (t.includes("shower") || t.includes("rain") || t.includes("drizzle"))
    return "cloud-rain";
  if (t.includes("fog") || t.includes("mist") || t.includes("haze"))
    return "cloud-fog";
  if (t.includes("cloud")) return "cloud";
  if (t.includes("clear") || t.includes("sunny") || t.includes("fine"))
    return isDay ? "sun" : "moon";
  return "cloud";
}

// --- Open-Meteo -------------------------------------------------------------

async function fetchOpenMeteo(
  latitude: number,
  longitude: number,
  units: WeatherUnits,
  locationLabel: string,
  appTimezone: string | null,
): Promise<WeatherPayload> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set(
    "current",
    [
      "temperature_2m",
      "apparent_temperature",
      "relative_humidity_2m",
      "wind_speed_10m",
      "wind_direction_10m",
      "weather_code",
      "is_day",
    ].join(","),
  );
  url.searchParams.set(
    "daily",
    [
      "weather_code",
      "temperature_2m_max",
      "temperature_2m_min",
      "precipitation_probability_max",
    ].join(","),
  );
  // v4.7.16 — use the app's configured timezone (Settings → Time zone) for
  // both the `daily.time` labels and the "is_day" flag. Previously this was
  // hard-coded to "auto", which uses the weather LOCATION's timezone. That
  // meant a kiosk running in AEST showing a forecast for a city in BST got
  // "today's" cell labelled with the BST day — which is yesterday from the
  // kiosk's point of view — so the home page said "Sat" while the user's
  // clock said "Sun". Asking for the user's app timezone instead lines the
  // daily column up with their wall clock.
  //
  // Open-Meteo accepts any IANA name. We pass "auto" only as a last resort
  // if the app TZ isn't configured.
  url.searchParams.set("timezone", appTimezone && appTimezone.trim() ? appTimezone : "auto");
  url.searchParams.set("forecast_days", "5");
  if (units === "imperial") {
    url.searchParams.set("temperature_unit", "fahrenheit");
    url.searchParams.set("wind_speed_unit", "mph");
  }

  const res = await weatherFetch(url.toString(), {
    // The free tier updates roughly once per 15 minutes. Revalidate every
    // 10 minutes so fresh-looking data without hammering their servers.
    next: { revalidate: 600 },
  } as RequestInit);
  if (!res.ok) throw new Error(`Open-Meteo failed (HTTP ${res.status})`);
  const data = await res.json();

  const current = data.current ?? {};
  const code = typeof current.weather_code === "number" ? current.weather_code : null;
  const isDay = Boolean(current.is_day);
  const desc = describeWmoCode(code, isDay);

  const daily = data.daily ?? {};
  const days: DailyForecast[] = Array.isArray(daily.time)
    ? daily.time.map((d: string, i: number) => {
        const dc =
          Array.isArray(daily.weather_code) && typeof daily.weather_code[i] === "number"
            ? daily.weather_code[i]
            : null;
        const dDesc = describeWmoCode(dc, true);
        return {
          date: d,
          minC:
            Array.isArray(daily.temperature_2m_min)
              ? Number(daily.temperature_2m_min[i])
              : null,
          maxC:
            Array.isArray(daily.temperature_2m_max)
              ? Number(daily.temperature_2m_max[i])
              : null,
          conditionCode: dc,
          conditionLabel: dDesc.label,
          icon: dDesc.icon,
          precipitationProbability:
            Array.isArray(daily.precipitation_probability_max)
              ? Number(daily.precipitation_probability_max[i])
              : null,
        };
      })
    : [];

  return {
    provider: "open-meteo",
    units,
    locationLabel,
    latitude,
    longitude,
    current: {
      tempC: typeof current.temperature_2m === "number" ? current.temperature_2m : null,
      feelsLikeC:
        typeof current.apparent_temperature === "number"
          ? current.apparent_temperature
          : null,
      humidity:
        typeof current.relative_humidity_2m === "number"
          ? current.relative_humidity_2m
          : null,
      windKph:
        typeof current.wind_speed_10m === "number" ? current.wind_speed_10m : null,
      windDirDeg:
        typeof current.wind_direction_10m === "number"
          ? current.wind_direction_10m
          : null,
      conditionCode: code,
      conditionLabel: desc.label,
      icon: desc.icon,
      isDay,
      observedAt:
        typeof current.time === "string"
          ? new Date(current.time).toISOString()
          : new Date().toISOString(),
    },
    daily: days,
    fetchedAt: new Date().toISOString(),
  };
}

// --- BOM --------------------------------------------------------------------

// BOM exposes its station observations as JSON files under a stable URL
// pattern. Picking the right product ID per state is awkward because they
// vary — instead, we query the "nearest station" endpoint, which hands back
// the closest observing station for the given lat/lng along with the
// observation payload.
//
// Endpoint reference: https://api.weather.bom.gov.au (undocumented but stable).
// If this ever goes away, the fallback path kicks in automatically.

interface BomObservation {
  air_temperature: number | null;
  apparent_t: number | null;
  rel_hum: number | null;
  wind_spd_kmh: number | null;
  wind_dir_deg: number | null;
  weather: string | null;
  aifstime_utc: string | null;
  station: string | null;
}

async function fetchBom(
  latitude: number,
  longitude: number,
  locationLabel: string,
  appTimezone: string | null,
): Promise<WeatherPayload | null> {
  // Step 1 — find the nearest location (suburb) from BOM's search endpoint.
  const geoUrl = new URL("https://api.weather.bom.gov.au/v1/locations");
  geoUrl.searchParams.set("search", `${latitude},${longitude}`);
  const geoRes = await weatherFetch(geoUrl.toString(), {
    next: { revalidate: 86_400 },
    headers: { accept: "application/json" },
  } as RequestInit);
  if (!geoRes.ok) return null;
  const geoData = await geoRes.json();
  const first = geoData?.data?.[0];
  if (!first?.geohash) return null;
  // BOM keys its endpoints by a 6-char geohash prefix.
  const hash = String(first.geohash).slice(0, 6);

  // Step 2 — current observations.
  const obsUrl = `https://api.weather.bom.gov.au/v1/locations/${hash}/observations`;
  const obsRes = await weatherFetch(obsUrl, {
    next: { revalidate: 600 },
    headers: { accept: "application/json" },
  } as RequestInit);
  if (!obsRes.ok) return null;
  const obsJson = await obsRes.json();
  const obs = obsJson?.data;
  if (!obs) return null;

  const observedAt =
    typeof obs.temp_feels_like === "number" && typeof obs.time === "string"
      ? obs.time
      : typeof obs.time === "string"
        ? obs.time
        : new Date().toISOString();

  const weatherText = typeof obs.station?.weather === "string"
    ? obs.station.weather
    : typeof obs.weather === "string"
      ? obs.weather
      : "";
  // v4.7.17 — derive the day/night hour in the app's TZ rather than the
  // process-default TZ. On a UTC LXC container running the BOM path, the
  // previous `.getHours()` returned UTC hours and would flip the icon to a
  // moon at 7am Sydney (which is 21:00 UTC the night before). Use Intl to
  // pull the hour in the user's selected zone.
  const hour = hourInTz(observedAt, appTimezone);
  const isDay = hour >= 6 && hour < 19;
  const icon = iconForBomText(weatherText, isDay);

  const current: CurrentWeather = {
    tempC: typeof obs.temp === "number" ? obs.temp : null,
    feelsLikeC: typeof obs.temp_feels_like === "number" ? obs.temp_feels_like : null,
    humidity: typeof obs.humidity === "number" ? obs.humidity : null,
    windKph:
      typeof obs.wind?.speed_kilometre === "number"
        ? obs.wind.speed_kilometre
        : null,
    windDirDeg:
      typeof obs.wind?.direction === "number" ? obs.wind.direction : null,
    conditionCode: null,
    conditionLabel: weatherText || (isDay ? "Current" : "Overnight"),
    icon,
    isDay,
    observedAt,
  };

  // Step 3 — daily forecast from BOM.
  let daily: DailyForecast[] = [];
  try {
    const fcUrl = `https://api.weather.bom.gov.au/v1/locations/${hash}/forecasts/daily`;
    const fcRes = await weatherFetch(fcUrl, {
      next: { revalidate: 3600 },
      headers: { accept: "application/json" },
    } as RequestInit);
    if (fcRes.ok) {
      const fcJson = await fcRes.json();
      if (Array.isArray(fcJson?.data)) {
        daily = fcJson.data.slice(0, 5).map((d: any) => {
          const label: string =
            (typeof d.short_text === "string" && d.short_text) ||
            (typeof d.icon_descriptor === "string" && d.icon_descriptor) ||
            "";
          return {
            // v4.7.17 — BOM hands `d.date` to us as a UTC ISO timestamp
            // (e.g. "2025-05-24T14:00:00Z" = midnight Sydney May 25), so
            // the previous .slice(0,10) put "today's" cell one day behind
            // the user's wall clock for every AU TZ east of UTC. Convert
            // via the app's configured TZ so the cell labels line up.
            date:
              typeof d.date === "string"
                ? isoDateInTz(d.date, appTimezone)
                : "",
            minC: typeof d.temp_min === "number" ? d.temp_min : null,
            maxC: typeof d.temp_max === "number" ? d.temp_max : null,
            conditionCode: null,
            conditionLabel: label,
            icon: iconForBomText(label, true),
            precipitationProbability:
              typeof d.rain?.chance === "number" ? d.rain.chance : null,
          };
        });
      }
    }
  } catch {
    // Forecast endpoint is best-effort — we still have current conditions.
  }

  return {
    provider: "bom",
    units: "metric", // BOM only publishes metric units.
    locationLabel,
    latitude,
    longitude,
    current,
    daily,
    fetchedAt: new Date().toISOString(),
  };
}

// --- Entry point ------------------------------------------------------------

export async function fetchWeather(opts: {
  latitude: number;
  longitude: number;
  locationLabel: string;
  provider: WeatherProviderPref;
  units: WeatherUnits;
  countryHintAU?: boolean;
  // v4.7.16 — app's configured timezone (Settings → Time zone). When set,
  // Open-Meteo's daily forecast columns are anchored to this zone instead of
  // the weather location's zone, which fixes the home-page "Sat when it's
  // Sunday" bug for setups where the kiosk and weather location aren't in
  // the same TZ.
  appTimezone?: string | null;
}): Promise<WeatherPayload> {
  const wantBom =
    opts.provider === "bom" ||
    (opts.provider === "auto" && opts.countryHintAU === true);

  if (wantBom) {
    try {
      const bom = await fetchBom(
        opts.latitude,
        opts.longitude,
        opts.locationLabel,
        opts.appTimezone ?? null,
      );
      if (bom) {
        // Return BOM in whatever units the user asked for — convert if needed.
        if (opts.units === "imperial" && bom.current.tempC != null) {
          return convertPayloadToImperial(bom);
        }
        return bom;
      }
    } catch (err) {
      console.warn("[weather] BOM fetch failed, falling back:", err);
    }
  }

  return fetchOpenMeteo(
    opts.latitude,
    opts.longitude,
    opts.units,
    opts.locationLabel,
    opts.appTimezone ?? null,
  );
}

// Helper: convert an already-fetched metric payload to imperial display units.
// We only do this for the BOM fallback path since Open-Meteo takes a unit
// parameter.
function convertPayloadToImperial(p: WeatherPayload): WeatherPayload {
  const cToF = (c: number | null) =>
    c == null ? null : Math.round(((c * 9) / 5 + 32) * 10) / 10;
  const kphToMph = (k: number | null) =>
    k == null ? null : Math.round(k * 0.621371 * 10) / 10;
  return {
    ...p,
    units: "imperial",
    current: {
      ...p.current,
      tempC: cToF(p.current.tempC),
      feelsLikeC: cToF(p.current.feelsLikeC),
      windKph: kphToMph(p.current.windKph),
    },
    daily: p.daily.map((d) => ({
      ...d,
      minC: cToF(d.minC),
      maxC: cToF(d.maxC),
    })),
  };
}
