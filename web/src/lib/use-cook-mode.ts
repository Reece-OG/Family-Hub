"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// =============================================================================
//  Cook Mode (v4.7.6)
// =============================================================================
//
//  A small client-side primitive that:
//    1. Holds an OS screen-wake-lock so the device doesn't dim while the user
//       is reading / cooking from a recipe.
//    2. Exposes a process-wide flag (`window.__familyhubCookMode`) plus a
//       `familyhub-cookmode` custom event so the kiosk-sleep components
//       (SleepOverlay, ScreensaverIdleTracker) can pause themselves while
//       cooking is in progress.
//    3. Re-acquires the wake lock automatically on `visibilitychange` —
//       browsers drop screen wake-locks the moment the tab is hidden, so
//       without this the lock would silently disappear if the user
//       briefly switched apps.
//
//  Browser support: Chromium 84+, Edge 84+, Safari 16.4+, Android Chrome.
//  Firefox doesn't support `navigator.wakeLock` yet — the hook degrades to
//  in-app coordination only (still suppresses our own screensaver / night
//  cover, just can't keep the OS itself awake). The toggle reports its
//  effective mode so the UI can dim the icon when wake-lock isn't real.

type WakeLockSentinelLike = {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: "release", listener: () => void) => void;
};

type NavigatorWithWakeLock = Navigator & {
  wakeLock?: {
    request: (type: "screen") => Promise<WakeLockSentinelLike>;
  };
};

const COOK_MODE_EVENT = "familyhub-cookmode";

declare global {
  interface Window {
    // True while *any* useCookMode caller in the page has cook mode on.
    // We deliberately use a single window-level flag rather than React
    // context so non-React code (SleepOverlay listens to the event but
    // also peeks at this flag on mount) stays simple.
    __familyhubCookMode?: boolean;
  }
}

// Keep one ref-counted "active" counter on the window so multiple callers
// (e.g. an explicit toggle on a recipe + an auto-on inside the menu
// pop-over) don't fight each other. Cook mode stays on as long as ≥1
// caller wants it.
const COUNTER_KEY = "__familyhubCookModeCount" as const;

type WindowWithCounter = Window & {
  [COUNTER_KEY]?: number;
};

function readCounter(): number {
  if (typeof window === "undefined") return 0;
  return (window as WindowWithCounter)[COUNTER_KEY] ?? 0;
}
function writeCounter(n: number) {
  if (typeof window === "undefined") return;
  (window as WindowWithCounter)[COUNTER_KEY] = n;
  window.__familyhubCookMode = n > 0;
  window.dispatchEvent(
    new CustomEvent(COOK_MODE_EVENT, { detail: { active: n > 0 } }),
  );
}

export function isCookModeSupported(): boolean {
  if (typeof navigator === "undefined") return false;
  return Boolean((navigator as NavigatorWithWakeLock).wakeLock);
}

/**
 * Subscribe to cook-mode changes anywhere in the tree without owning the
 * lock yourself. SleepOverlay / ScreensaverIdleTracker use this.
 */
export function useCookModeActive(): boolean {
  const [active, setActive] = useState<boolean>(() =>
    typeof window !== "undefined" ? Boolean(window.__familyhubCookMode) : false,
  );
  useEffect(() => {
    function onChange() {
      setActive(Boolean(window.__familyhubCookMode));
    }
    window.addEventListener(COOK_MODE_EVENT, onChange);
    return () => window.removeEventListener(COOK_MODE_EVENT, onChange);
  }, []);
  return active;
}

/**
 * Owns one share of the cook-mode counter. Call `enable()` to claim it,
 * `disable()` to release; `toggle()` flips the local share. Any of these
 * methods is safe to call repeatedly — the counter is idempotent per
 * caller via `mineRef`.
 */
export function useCookMode() {
  // Has *this* hook instance got its share of the counter?
  const mineRef = useRef(false);
  // Active wake-lock sentinel held by this instance, if any.
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null);
  const [active, setActive] = useState(false);

  const claim = useCallback(() => {
    if (mineRef.current) return;
    mineRef.current = true;
    writeCounter(readCounter() + 1);
    setActive(true);
  }, []);

  const yieldShare = useCallback(() => {
    if (!mineRef.current) return;
    mineRef.current = false;
    writeCounter(Math.max(0, readCounter() - 1));
    setActive(false);
  }, []);

  // Acquire the OS wake-lock. Best-effort: on browsers without the API we
  // still bump the counter so the in-app overlays stay paused.
  const acquireWakeLock = useCallback(async () => {
    const nav = navigator as NavigatorWithWakeLock;
    if (!nav.wakeLock) return;
    try {
      const sentinel = await nav.wakeLock.request("screen");
      sentinelRef.current = sentinel;
      sentinel.addEventListener("release", () => {
        // Browsers release on visibilitychange; we may need to re-acquire
        // when the tab becomes visible again. The visibility handler below
        // does that, but we also clear the local ref so we don't try to
        // re-release a dead sentinel.
        sentinelRef.current = null;
      });
    } catch {
      // Permissions / power-saving mode can deny the request. Not fatal —
      // the in-app coordination still keeps the screensaver away.
    }
  }, []);

  const releaseWakeLock = useCallback(async () => {
    const sentinel = sentinelRef.current;
    sentinelRef.current = null;
    if (!sentinel || sentinel.released) return;
    try {
      await sentinel.release();
    } catch {
      /* swallow — already released */
    }
  }, []);

  const enable = useCallback(async () => {
    claim();
    await acquireWakeLock();
  }, [claim, acquireWakeLock]);

  const disable = useCallback(async () => {
    yieldShare();
    await releaseWakeLock();
  }, [yieldShare, releaseWakeLock]);

  const toggle = useCallback(async () => {
    if (mineRef.current) {
      await disable();
    } else {
      await enable();
    }
  }, [enable, disable]);

  // Re-acquire the wake-lock when the page becomes visible again. Without
  // this, the lock silently disappears the first time the user briefly
  // switches tabs and never comes back.
  useEffect(() => {
    function onVisibility() {
      if (
        document.visibilityState === "visible" &&
        mineRef.current &&
        !sentinelRef.current
      ) {
        acquireWakeLock();
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [acquireWakeLock]);

  // Always release on unmount so a navigation doesn't leave cook mode
  // stuck on. Use a ref-mirroring effect so we don't re-run the cleanup
  // when `disable` changes identity.
  useEffect(() => {
    return () => {
      if (mineRef.current) {
        mineRef.current = false;
        writeCounter(Math.max(0, readCounter() - 1));
      }
      // releaseWakeLock is async but we don't await in cleanup — fire and
      // forget; the browser will tidy up if the page is unloading anyway.
      const s = sentinelRef.current;
      sentinelRef.current = null;
      if (s && !s.released) {
        s.release().catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { active, enable, disable, toggle, supported: isCookModeSupported() };
}
