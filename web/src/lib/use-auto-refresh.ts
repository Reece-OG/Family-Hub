"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// v4.7.17 — small reusable auto-refresh hook used by every client list
// component in the app. Solves the "kiosk goes stale" problem reported on
// v4.7.16: pages used to fetch only once on mount, so a kiosk left open for
// hours showed yesterday's todos / shopping list / reminders.
//
// What it does on every call:
//   • Calls `loader()` once on mount (covers the existing useEffect pattern).
//   • Calls `loader()` whenever the document becomes visible again — this
//     covers tab switches inside the app AND a PWA being brought back to the
//     foreground after a sleep / lock-screen / Cook Mode pause.
//   • Calls `loader()` every `intervalMs` while the document is visible.
//     We skip the interval tick while hidden (no point polling an unseen
//     tab) and run an immediate `loader()` the moment it becomes visible
//     again, so the data is fresh by the time the user looks at it.
//
// `loader` should be the SAME function reference across renders (wrap with
// useCallback at the call site). If a new function identity arrives the
// hook reschedules — which is intentional, e.g. for filter-dependent loads.
//
// Returns `{ lastUpdated, isRefreshing, refresh }`. The first two power UI
// affordances like a "Updated 30 s ago" badge or a spinner while in flight.
// `refresh()` is a manual trigger for "Refresh now" buttons / pull-to-
// refresh — it also updates lastUpdated so the badge re-renders.

export interface UseAutoRefreshOptions {
  // How often to poll while the document is visible. Default 60 s.
  intervalMs?: number;
  // Disable the hook entirely (no mount-load, no polling). Useful when a
  // parent wants to suspend refreshes during a mutation. Default false.
  disabled?: boolean;
}

export interface UseAutoRefreshResult {
  lastUpdated: Date | null;
  isRefreshing: boolean;
  refresh: () => Promise<void>;
}

export function useAutoRefresh(
  loader: () => void | Promise<void>,
  { intervalMs = 60_000, disabled = false }: UseAutoRefreshOptions = {},
): UseAutoRefreshResult {
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Keep the latest loader in a ref so the effect below doesn't tear down
  // and re-create its interval just because the parent re-rendered.
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  // Single refresh entry point used by mount, visibility, interval, and the
  // returned manual `refresh()`. Guards against overlapping runs so a slow
  // network never piles up four in-flight loads.
  const inFlightRef = useRef(false);
  const refresh = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setIsRefreshing(true);
    try {
      await loaderRef.current();
      setLastUpdated(new Date());
    } finally {
      inFlightRef.current = false;
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (disabled) return;

    // Visibility: re-load whenever the doc becomes visible. Don't react to
    // the "hidden" transition — we only care about waking up.
    const onVis = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        refresh();
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVis);
    }

    // Interval: tick only while visible to avoid pointless background polls.
    let timer: ReturnType<typeof setInterval> | null = null;
    const startTicker = () => {
      if (timer) return;
      timer = setInterval(() => {
        if (typeof document === "undefined" || document.visibilityState === "visible") {
          refresh();
        }
      }, intervalMs);
    };
    const stopTicker = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    startTicker();

    // Also stop ticking when hidden so a background tab doesn't burn battery.
    const onHide = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        stopTicker();
      } else {
        startTicker();
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onHide);
    }

    return () => {
      stopTicker();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVis);
        document.removeEventListener("visibilitychange", onHide);
      }
    };
  }, [refresh, intervalMs, disabled]);

  // v4.7.18 — separate effect for the "loader identity changed" case. This
  // is what makes parameter-driven loads (MenuView's weekStart, CalendarView's
  // cursor, TaxesView's fyKey, RemindersView's scope, …) actually re-fetch
  // when the parent re-renders with new deps. Without this, the loaderRef
  // gets updated but nobody ever calls it until the next visibility-change
  // or 60-s tick — which is the "menu planner blank on week nav until I
  // switch tabs and back" bug from v4.7.17.
  //
  // Kept separate from the main effect above so we don't tear down the
  // interval/visibility listeners every time a parameter changes — only the
  // refresh fires.
  useEffect(() => {
    if (disabled) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loader, disabled]);

  return { lastUpdated, isRefreshing, refresh };
}
