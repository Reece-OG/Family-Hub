"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useCookModeActive } from "@/lib/use-cook-mode";

// Watches for user inactivity while inside the app shell and, once the
// configured idle threshold is reached, navigates to the /screensaver photo
// reel. If the threshold is 0 the feature is disabled.
//
// v4.7 — the tracker is now gated on `enabled`: only local devices with
// useScreensaver=true arm the timer. Email sessions (phones, laptops) don't
// pay the idle cost or get hijacked by the kiosk screensaver.
//
// v4.9.7 — replaced the single setTimeout with a periodic interval check
// against a lastActivityAt timestamp. The old approach relied on a
// background setTimeout firing on time, which Firefox on Linux throttles
// under certain conditions (kiosk-mode auto-blank, X11 idle, etc.) — the
// timer would never fire and the screensaver would never appear. An
// interval that wakes up every 5 s and asks "has enough time elapsed?" is
// far harder for the browser to defer. As a bonus we expand the input-
// event list to also include wheel, scroll, focus and mouseover, so a
// wider variety of real-world interactions reset the idle clock.
//
// We intentionally route rather than rendering an overlay so the existing
// Screensaver page (full-bleed slideshow) is reused — any tap/key/pointer
// movement there reloads back into the app via its own wake logic.

const TICK_MS = 5_000;

export function ScreensaverIdleTracker({
  enabled = false,
}: {
  enabled?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const idleMs = useRef<number>(0);
  // Timestamp of the most recent user input. Initialised at mount so the
  // tracker behaves the same as "fresh activity" before the user touches
  // anything — the timer counts from when they sit down, not from boot.
  const lastActivityAt = useRef<number>(Date.now());
  const tickHandle = useRef<ReturnType<typeof setInterval> | null>(null);
  // v4.7.6 — keep the kiosk on the recipe / menu page while the user is
  // cooking. Subscribing to `useCookModeActive` re-runs the arm effect
  // whenever the flag flips so the timer is dropped immediately on enable
  // and re-armed on disable.
  const cookMode = useCookModeActive();

  // Fetch the setting, re-poll every 5 minutes so Settings edits propagate.
  // Only fetches when `enabled` is true — email sessions skip the API entirely.
  //
  // v4.7.1: idle-minutes now lives on the LocalDevice row (per-device kiosk
  // tuning), fetched via /api/me/device-config. Non-device sessions return
  // `device: null` which disarms the timer.
  useEffect(() => {
    if (!enabled) {
      idleMs.current = 0;
      return;
    }
    let alive = true;
    async function load() {
      try {
        const r = await fetch("/api/me/device-config");
        if (!r.ok) return;
        const { device } = await r.json();
        if (!alive) return;
        if (!device) {
          idleMs.current = 0;
          return;
        }
        const mins = Number(device.screensaverIdleMinutes ?? 0);
        idleMs.current = Math.max(0, Math.floor(mins)) * 60 * 1000;
      } catch {
        // Non-fatal: if we can't fetch settings we simply won't arm the timer.
      }
    }
    load();
    const id = setInterval(load, 5 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [enabled]);

  // Track activity + periodically check whether enough idle time has passed
  // to launch the screensaver. The interval is the workhorse here: a single
  // setTimeout could be throttled or paused by the browser/OS power manager
  // and silently never fire, which is the exact failure mode reported on
  // Ubuntu / Firefox kiosks before v4.9.7.
  //
  // `cookMode` is in the deps list so disabling it re-arms the tracker
  // (kiosk goes back to its normal schedule once the recipe view closes)
  // and enabling it bails immediately and stops the interval entirely.
  useEffect(() => {
    if (!enabled) return;
    if (cookMode) {
      if (tickHandle.current) {
        clearInterval(tickHandle.current);
        tickHandle.current = null;
      }
      return;
    }

    // Treat mount + route change as fresh activity so a navigation doesn't
    // accidentally trip the timer before the user has even seen the new page.
    lastActivityAt.current = Date.now();

    let lastMove = 0;
    function onActivity(e: Event) {
      if (e.type === "mousemove" || e.type === "mouseover") {
        const t = Date.now();
        if (t - lastMove < 1000) return; // throttle high-frequency events
        lastMove = t;
      }
      lastActivityAt.current = Date.now();
    }

    const events: (keyof WindowEventMap)[] = [
      "pointerdown",
      "pointermove",
      "keydown",
      "touchstart",
      "touchmove",
      "mousemove",
      "mouseover",
      "wheel",
      "scroll",
      "focus",
    ];
    events.forEach((ev) =>
      window.addEventListener(ev, onActivity, { passive: true }),
    );

    function tick() {
      // Re-read the global cook-mode flag every tick so a flip-on between
      // ticks short-circuits the navigation even if cookMode's React state
      // hasn't propagated yet.
      if (window.__familyhubCookMode) return;
      if (idleMs.current <= 0) return;
      if (typeof window === "undefined") return;
      if (window.location.pathname.startsWith("/screensaver")) return;
      const elapsed = Date.now() - lastActivityAt.current;
      if (elapsed >= idleMs.current) {
        router.push("/screensaver");
      }
    }
    tickHandle.current = setInterval(tick, TICK_MS);

    return () => {
      events.forEach((ev) => window.removeEventListener(ev, onActivity));
      if (tickHandle.current) {
        clearInterval(tickHandle.current);
        tickHandle.current = null;
      }
    };
    // We intentionally re-arm when the route changes so fresh page state
    // resets the countdown.
  }, [enabled, pathname, router, cookMode]);

  return null;
}
