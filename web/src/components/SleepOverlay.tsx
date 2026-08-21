"use client";

import { useEffect, useRef, useState } from "react";
import { useCookModeActive } from "@/lib/use-cook-mode";

// Renders a full-screen black overlay during the configured sleep-window so
// the kiosk doesn't keep the room lit. Tap, click, key or pointer movement
// dismisses the overlay; after `sleepIdleMinutes` of no activity (and still
// inside the window) it auto-returns. Settings are re-polled every 5 minutes
// so changes from the Settings page propagate without a reload.

type SleepConfig = {
  enabled: boolean;
  startMin: number; // minutes since midnight
  endMin: number;
  idleMs: number;
};

function parseHM(s: string): number {
  const [h, m] = s.split(":").map((n) => parseInt(n, 10));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

function nowMin(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function inWindow(startMin: number, endMin: number): boolean {
  if (startMin === endMin) return false;
  const n = nowMin();
  // Same-day window (e.g. 13:00 → 14:00)
  if (startMin < endMin) return n >= startMin && n < endMin;
  // Crosses midnight (e.g. 22:00 → 07:00)
  return n >= startMin || n < endMin;
}

export function SleepOverlay() {
  const [config, setConfig] = useState<SleepConfig | null>(null);
  const [showing, setShowing] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showingRef = useRef(false);

  // v4.7.6 — when Cook Mode is on we suppress the night-sleep overlay
  // entirely. Dropping the black cover during cooking is the whole point.
  const cookMode = useCookModeActive();

  useEffect(() => {
    showingRef.current = showing;
  }, [showing]);

  // If cook mode flips on while the overlay is currently visible, lift it
  // immediately so the user isn't left tapping a black screen mid-recipe.
  useEffect(() => {
    if (cookMode && showingRef.current) {
      setShowing(false);
    }
  }, [cookMode]);

  // Fetch settings; refresh every 5 minutes so toggles in Settings propagate.
  //
  // v4.7.1: sleep-mode config is now per-device (moved from AppSettings). We
  // hit /api/me/device-config which returns `device: null` for non-device
  // sessions — phones/laptops stay permanently awake, only configured kiosks
  // ever dim.
  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const r = await fetch("/api/me/device-config");
        if (!r.ok) return;
        const { device } = await r.json();
        if (!alive) return;
        if (!device) {
          setConfig({ enabled: false, startMin: 0, endMin: 0, idleMs: 0 });
          return;
        }
        setConfig({
          enabled: !!device.sleepModeEnabled,
          startMin: parseHM(device.sleepStartTime || "22:00"),
          endMin: parseHM(device.sleepEndTime || "07:00"),
          idleMs: Math.max(1, device.sleepIdleMinutes ?? 5) * 60 * 1000,
        });
      } catch {
        // Network issues shouldn't break the app shell — just skip this poll.
      }
    }
    load();
    const id = setInterval(load, 5 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Periodic evaluation: enter/leave the sleep window.
  useEffect(() => {
    if (!config) return;
    if (!config.enabled) {
      if (idleTimer.current) {
        clearTimeout(idleTimer.current);
        idleTimer.current = null;
      }
      if (showingRef.current) setShowing(false);
      return;
    }

    function evaluate() {
      // Cook mode pre-empts the time check entirely — even if we're well
      // inside the night window, we don't paint the cover while a recipe
      // is being followed.
      if (window.__familyhubCookMode) {
        if (idleTimer.current) {
          clearTimeout(idleTimer.current);
          idleTimer.current = null;
        }
        if (showingRef.current) setShowing(false);
        return;
      }
      const inside = inWindow(config!.startMin, config!.endMin);
      if (!inside) {
        if (idleTimer.current) {
          clearTimeout(idleTimer.current);
          idleTimer.current = null;
        }
        if (showingRef.current) setShowing(false);
        return;
      }
      // Inside window. If no idle timer is armed and we're not already
      // showing, the user has been idle since entering the window — sleep.
      if (!idleTimer.current && !showingRef.current) {
        setShowing(true);
      }
    }
    evaluate();
    const id = setInterval(evaluate, 30 * 1000);
    return () => clearInterval(id);
  }, [config]);

  // Activity → dismiss overlay (if any) and (re)arm the idle timer.
  //
  // v4.7.4 — listeners now register with `capture: true` so we run BEFORE
  // any bubble-phase listeners on `window` (notably the Screensaver page's
  // exit-on-input handlers). When the overlay is currently showing we also
  // call `stopImmediatePropagation` so a wake-tap merely lifts the night
  // cover instead of also navigating the kiosk back to /dashboard. The
  // expected UX is: tap → peek at slideshow → idle → black returns.
  useEffect(() => {
    if (!config?.enabled) return;

    function armIdle() {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(() => {
        idleTimer.current = null;
        // Same cook-mode guard as the periodic evaluate(). The user could
        // have toggled it on between arm and fire.
        if (window.__familyhubCookMode) return;
        if (inWindow(config!.startMin, config!.endMin)) {
          setShowing(true);
        }
      }, config!.idleMs);
    }

    let lastMove = 0;
    function onActivity(e: Event) {
      // Throttle mousemove — otherwise it never lets the timer fire.
      if (e.type === "mousemove") {
        const t = Date.now();
        if (t - lastMove < 1000) return;
        lastMove = t;
      }
      const inside = inWindow(config!.startMin, config!.endMin);
      if (!inside) return; // Outside window: no overlay, no need to track idle.
      if (showingRef.current) {
        // Swallow this event so the underlying page (e.g. /screensaver) does
        // not also act on it. capture-phase + stopImmediatePropagation =
        // bubble-phase window listeners on the same target never fire.
        e.stopImmediatePropagation();
        setShowing(false);
      }
      armIdle();
    }

    const events: (keyof WindowEventMap)[] = [
      "pointerdown",
      "keydown",
      "touchstart",
      "mousemove",
    ];
    const opts: AddEventListenerOptions = { capture: true };
    events.forEach((e) => window.addEventListener(e, onActivity, opts));
    return () => {
      events.forEach((e) => window.removeEventListener(e, onActivity, opts));
      if (idleTimer.current) {
        clearTimeout(idleTimer.current);
        idleTimer.current = null;
      }
    };
  }, [config]);

  if (!showing) return null;

  return (
    <div
      className="fixed inset-0 z-[100] bg-black cursor-none touch-none select-none"
      role="presentation"
      aria-label="Screen asleep — tap to wake"
      onPointerDown={(e) => {
        // Swallow the wake tap so it doesn't accidentally trigger UI underneath.
        e.preventDefault();
        e.stopPropagation();
        setShowing(false);
      }}
    />
  );
}
