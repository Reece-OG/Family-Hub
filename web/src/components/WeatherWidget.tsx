"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudMoon,
  CloudRain,
  CloudSun,
  MapPin,
  Moon,
  RefreshCw,
  Snowflake,
  Sun,
  Wind,
} from "lucide-react";

// Lightweight payload shape — matches lib/weather.ts. Kept local to avoid
// forcing server-only types into this client component.
type Current = {
  tempC: number | null;
  feelsLikeC: number | null;
  humidity: number | null;
  windKph: number | null;
  windDirDeg: number | null;
  conditionLabel: string;
  icon: string;
  isDay: boolean;
  observedAt: string;
};

type Daily = {
  date: string;
  minC: number | null;
  maxC: number | null;
  conditionLabel: string;
  icon: string;
  precipitationProbability: number | null;
};

type WeatherPayload = {
  provider: "open-meteo" | "bom";
  units: "metric" | "imperial";
  locationLabel: string;
  current: Current;
  daily: Daily[];
  fetchedAt: string;
};

type ApiShape =
  | { enabled: false }
  | { enabled: true; configured: false; error?: string }
  | {
      enabled: true;
      configured: true;
      weather: WeatherPayload;
      timezone?: string | null;
    }
  | { enabled: true; configured: true; error: string };

// Pick a Lucide icon for the string hint returned by the server.
export function WeatherIcon({
  icon,
  size = 20,
  className,
}: {
  icon: string;
  size?: number;
  className?: string;
}) {
  const props = { size, className };
  switch (icon) {
    case "sun":
      return <Sun {...props} />;
    case "moon":
      return <Moon {...props} />;
    case "cloud-sun":
      return <CloudSun {...props} />;
    case "cloud-moon":
      return <CloudMoon {...props} />;
    case "cloud":
      return <Cloud {...props} />;
    case "cloud-fog":
      return <CloudFog {...props} />;
    case "cloud-drizzle":
      return <CloudDrizzle {...props} />;
    case "cloud-rain":
      return <CloudRain {...props} />;
    case "cloud-lightning":
      return <CloudLightning {...props} />;
    case "snowflake":
      return <Snowflake {...props} />;
    default:
      return <Cloud {...props} />;
  }
}

export function formatTemp(
  t: number | null,
  units: "metric" | "imperial",
): string {
  if (t == null) return "—";
  return `${Math.round(t)}°${units === "metric" ? "C" : "F"}`;
}

// v4.7.17 — milliseconds until the next 6-hour clock-aligned slot in the
// viewer's local time. Slots are 00:00, 06:00, 12:00, 18:00. Returned ms is
// always > 0 so the timer doesn't fire instantly when scheduling at a slot.
function msUntilNext6hSlot(now: Date = new Date()): number {
  const next = new Date(now);
  const nextHour = (Math.floor(now.getHours() / 6) + 1) * 6;
  if (nextHour >= 24) {
    next.setDate(next.getDate() + 1);
    next.setHours(0, 0, 0, 0);
  } else {
    next.setHours(nextHour, 0, 0, 0);
  }
  const ms = next.getTime() - now.getTime();
  return ms > 1000 ? ms : 6 * 60 * 60 * 1000; // belt-and-braces fallback
}

export function useWeather() {
  const [state, setState] = useState<ApiShape | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/weather", { cache: "no-store" });
      const data = (await r.json()) as ApiShape;
      setState(data);
      setLastUpdated(new Date());
    } catch {
      // Swallow network errors — widget renders a "couldn't fetch" hint.
      setState({
        enabled: true,
        configured: true,
        error: "Couldn't reach weather service",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  // v4.7.17 — schedule:
  //   • Initial mount load
  //   • Re-load whenever the document becomes visible (PWA wake / tab return)
  //   • Anchored 6-hour refresh at 00:00, 06:00, 12:00, 18:00 local time —
  //     fires a one-shot timer to the next slot, then re-schedules from
  //     there. This is what the user asked for ("auto refresh every 6 hours,
  //     so at midnight, 6am, midday etc").
  //   • 30-minute safety backstop in case the visibility / aligned timers
  //     get throttled on a backgrounded tab.
  useEffect(() => {
    load();

    const onVis = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        load();
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVis);
    }

    let cancelled = false;
    let alignedTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleAligned = () => {
      const ms = msUntilNext6hSlot();
      alignedTimer = setTimeout(() => {
        if (cancelled) return;
        load();
        scheduleAligned();
      }, ms);
    };
    scheduleAligned();

    const backstop = setInterval(load, 30 * 60_000);

    return () => {
      cancelled = true;
      if (alignedTimer) clearTimeout(alignedTimer);
      clearInterval(backstop);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVis);
      }
    };
  }, [load]);

  return { state, loading, reload: load, lastUpdated };
}

// v4.7.17 — small helper for the "Updated 5 min ago" footer line. Pure
// presentational, no imports.
function relativeAgo(when: Date | null): string {
  if (!when) return "—";
  const diff = Date.now() - when.getTime();
  if (diff < 60_000) return "just now";
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} d ago`;
}

// Full card used on the dashboard. Collapses to a single line on small
// screens but shows the next few days when there's room.
export function WeatherWidget() {
  const { state, loading, reload, lastUpdated } = useWeather();

  if (loading || !state) {
    return (
      <div className="card p-4 flex items-center gap-3">
        <Cloud className="muted" size={22} />
        <span className="text-sm muted">Loading weather…</span>
      </div>
    );
  }
  if (!state.enabled) return null;
  if ("error" in state && state.error) {
    return (
      <div className="card p-4 flex items-center gap-3 justify-between">
        <div className="flex items-center gap-3">
          <Cloud className="muted" size={22} />
          <div>
            <div className="text-sm font-semibold">Weather unavailable</div>
            <div className="text-xs muted">{state.error}</div>
          </div>
        </div>
        <button className="btn btn-ghost text-xs" onClick={reload}>
          <RefreshCw size={14} /> Retry
        </button>
      </div>
    );
  }
  if (!("weather" in state) || !state.weather) return null;
  const w = state.weather;
  const unit = w.units;
  // (v4.7.15) The /api/weather response now also includes the app's
  // configured timezone alongside the payload — currently unused by the
  // widget body (the DailyCell labels weekdays from YYYY-MM-DD which is
  // TZ-independent), but kept as a forward-compat hook for any future
  // formatting that *does* need the user's zone (e.g. "observed at" times).

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="text-[rgb(var(--brand))] shrink-0">
            <WeatherIcon icon={w.current.icon} size={40} />
          </div>
          <div className="min-w-0">
            <div className="text-3xl font-extrabold tabular-nums leading-none">
              {formatTemp(w.current.tempC, unit)}
            </div>
            <div className="text-sm font-semibold truncate">
              {w.current.conditionLabel}
            </div>
            <div className="text-xs muted flex items-center gap-1 truncate">
              <MapPin size={11} /> {w.locationLabel}
            </div>
          </div>
        </div>
        <div className="text-right text-xs muted space-y-0.5">
          <div>Feels {formatTemp(w.current.feelsLikeC, unit)}</div>
          {w.current.windKph != null && (
            <div className="flex items-center gap-1 justify-end">
              <Wind size={11} /> {Math.round(w.current.windKph)}
              {unit === "metric" ? " km/h" : " mph"}
            </div>
          )}
          {w.current.humidity != null && (
            <div>Humidity {Math.round(w.current.humidity)}%</div>
          )}
        </div>
      </div>

      {w.daily.length > 1 && (
        <div className="mt-3 pt-3 border-t border-[rgb(var(--border))] grid grid-cols-3 sm:grid-cols-5 gap-2">
          {w.daily.slice(0, 5).map((d) => (
            <DailyCell key={d.date} d={d} unit={unit} />
          ))}
        </div>
      )}

      {/* v4.7.17 — show last-updated time + which timezone the daily column
          labels were computed in. Makes day-mismatch bugs self-diagnostic:
          if "today's" cell says the wrong day, the user can see straight
          away whether they're on the wrong TZ. */}
      <div className="mt-2 text-[10px] muted flex items-center justify-between gap-2">
        <span className="truncate">
          via {w.provider === "bom" ? "BOM" : "Open-Meteo"}
          {" · "}
          Updated {relativeAgo(lastUpdated)}
          {("timezone" in state ? state.timezone : null) && (
            <> {" · "} {String(("timezone" in state ? state.timezone : null))}</>
          )}
        </span>
        <button
          className="hover:underline shrink-0"
          onClick={reload}
          title="Refresh weather"
        >
          <RefreshCw size={10} className="inline" /> Refresh
        </button>
      </div>
    </div>
  );
}

function DailyCell({
  d,
  unit,
}: {
  d: Daily;
  unit: "metric" | "imperial";
}) {
  const dayLabel = useMemo(() => {
    if (!d.date) return "";
    // v4.7.15 — the API gives us YYYY-MM-DD in the forecast location's local
    // zone, and the weekday for a YYYY-MM-DD is a fixed answer regardless of
    // the viewer's zone. Construct via Date.UTC(...) and format with
    // timeZone:"UTC" so the browser can't shift it across a day boundary.
    // Before this, "2026-05-24T00:00:00" was parsed in browser-local time and
    // a TZ-mismatched kiosk could land on "Sat" when it was actually Sunday.
    const [yStr, mStr, dStr] = d.date.split("-");
    const y = Number(yStr);
    const m = Number(mStr);
    const day = Number(dStr);
    if (!y || !m || !day) return d.date;
    const date = new Date(Date.UTC(y, m - 1, day, 12, 0, 0));
    return date.toLocaleDateString(undefined, {
      weekday: "short",
      timeZone: "UTC",
    });
  }, [d.date]);
  return (
    <div className="flex flex-col items-center text-xs gap-0.5">
      <span className="font-medium">{dayLabel}</span>
      <WeatherIcon icon={d.icon} size={18} />
      <span className="tabular-nums">
        {d.maxC != null ? Math.round(d.maxC) : "—"}° /{" "}
        {d.minC != null ? Math.round(d.minC) : "—"}°
      </span>
      {d.precipitationProbability != null && d.precipitationProbability > 0 && (
        <span className="muted">{Math.round(d.precipitationProbability)}%</span>
      )}
    </div>
  );
}

// Minimal overlay variant used by the screensaver. One line, big type,
// tolerates "weather unavailable" by rendering nothing.
export function WeatherOverlay() {
  const { state } = useWeather();
  if (!state || !("weather" in state) || !state.weather) return null;
  const w = state.weather;
  return (
    <div className="flex items-center gap-2 text-white drop-shadow-lg">
      <WeatherIcon icon={w.current.icon} size={28} />
      <div className="tabular-nums text-3xl font-extrabold">
        {formatTemp(w.current.tempC, w.units)}
      </div>
      <div className="text-xs opacity-80">
        <div className="font-semibold">{w.current.conditionLabel}</div>
        <div className="truncate max-w-[12rem]">{w.locationLabel}</div>
      </div>
    </div>
  );
}
