"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, X, Share } from "lucide-react";

// =============================================================================
//  PushEnrolmentBanner (v4.7.9)
// =============================================================================
//
//  A one-time amber banner shown above the app shell on devices that
//  COULD receive push notifications but haven't enrolled yet. Tapping
//  Enable kicks off the standard browser permission + subscribe flow,
//  POSTs the resulting subscription to /api/push/subscribe, and the
//  banner self-dismisses.
//
//  Dismiss is sticky in localStorage so we don't nag the user every page
//  load. Re-enrolling later is still possible from Settings → Notifications.

const DISMISS_KEY = "familyhub:push-banner-dismissed";

// Convert the urlBase64 VAPID public key returned by the API into the
// Uint8Array shape the Web Push API requires.
function urlBase64ToUint8(b64: string): Uint8Array {
  const padding = "=".repeat((4 - (b64.length % 4)) % 4);
  const norm = (b64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(norm);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

type State =
  | { kind: "loading" }
  | { kind: "unsupported" }
  | { kind: "denied" }
  | { kind: "enrolled" }
  | { kind: "available" }
  | { kind: "dismissed" }
  // v4.8.1 — iOS Safari only delivers Web Push from a PWA installed to the
  // home screen. Tapping the regular "Enable" button in Safari silently
  // fails (requestPermission returns "denied" with no UI cue). When we
  // detect that case we render a separate banner with explicit Add-to-Home
  // -Screen instructions instead of pretending it's available.
  | { kind: "ios-needs-pwa" };

// v4.8.1 — iOS detection. We treat iPad-as-Mac (the post-iPadOS 13 default)
// the same as iPhone because Safari there has the identical Web Push
// restriction. Excludes Chrome/Firefox-on-iOS which advertise themselves with
// CriOS / FxiOS but are all WebKit anyway, so they have the same limitation.
function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ reports as MacIntel with maxTouchPoints > 1.
  if (
    typeof navigator.maxTouchPoints === "number" &&
    navigator.maxTouchPoints > 1 &&
    /Macintosh/.test(ua)
  ) {
    return true;
  }
  return false;
}

function isStandalonePwa(): boolean {
  if (typeof window === "undefined") return false;
  // iOS exposes the Safari-proprietary navigator.standalone bool. Other
  // browsers use the standard display-mode media query. Either one being
  // true is enough to count as installed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nav = navigator as any;
  if (nav.standalone === true) return true;
  if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) {
    return true;
  }
  return false;
}

export function PushEnrolmentBanner() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const evaluate = useCallback(async () => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      // v4.8.1 — pre-iOS-16.4 Safari is in this bucket because it lacks the
      // PushManager API entirely. The user has no path forward, so the
      // banner just hides itself.
      setState({ kind: "unsupported" });
      return;
    }
    if (Notification.permission === "denied") {
      setState({ kind: "denied" });
      return;
    }
    // v4.8.1 — iOS-16.4-and-up Safari has PushManager but only inside a
    // home-screened PWA. Detect that combo BEFORE trying requestPermission
    // (which would silently return "denied" and confuse everyone).
    if (isIos() && !isStandalonePwa()) {
      // Suppress only if the user hasn't dismissed the PWA-install nudge yet.
      if (window.localStorage.getItem(DISMISS_KEY) === "1") {
        setState({ kind: "dismissed" });
        return;
      }
      setState({ kind: "ios-needs-pwa" });
      return;
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      if (existing) {
        setState({ kind: "enrolled" });
        return;
      }
    } catch {
      setState({ kind: "unsupported" });
      return;
    }
    if (window.localStorage.getItem(DISMISS_KEY) === "1") {
      setState({ kind: "dismissed" });
      return;
    }
    setState({ kind: "available" });
  }, []);

  useEffect(() => {
    evaluate();
  }, [evaluate]);

  async function enable() {
    setBusy(true);
    setError(null);
    try {
      // 1. Ask the OS for permission. On Safari iOS this only succeeds
      //    inside a PWA installed to the home screen.
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState({ kind: "denied" });
        return;
      }
      // 2. Pull the VAPID public key (auto-generates server-side first call).
      const keyRes = await fetch("/api/push/vapid-key");
      if (!keyRes.ok) throw new Error("Could not fetch server identity");
      const { publicKey } = await keyRes.json();
      if (!publicKey) throw new Error("Server returned no public key");

      // 3. Subscribe via the SW's pushManager.
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8(publicKey),
      });

      // 4. Persist server-side.
      const json = sub.toJSON();
      const post = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: json.keys,
          userAgent:
            typeof navigator !== "undefined" ? navigator.userAgent : null,
        }),
      });
      if (!post.ok) {
        const j = await post.json().catch(() => ({}));
        throw new Error(j.error || "Could not save subscription");
      }
      setState({ kind: "enrolled" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not enable push");
    } finally {
      setBusy(false);
    }
  }

  function dismiss() {
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
    setState({ kind: "dismissed" });
  }

  if (state.kind === "ios-needs-pwa") {
    return (
      <div className="px-4 md:px-8">
        <div className="card mt-3 px-3 py-2 flex items-start gap-3 bg-sky-50 dark:bg-sky-950/40 border-sky-200 dark:border-sky-900 text-sky-900 dark:text-sky-100">
          <Share size={18} className="mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0 text-sm">
            <div className="font-medium">
              Add Family Hub to your home screen to get reminders
            </div>
            <div className="text-xs opacity-90 mt-0.5">
              On iPhone / iPad, push notifications only work after you
              install Family Hub as an app: tap the <span className="font-semibold">Share</span> button
              in Safari, then <span className="font-semibold">Add to Home Screen</span>. Open the app
              from the new icon and you&apos;ll be able to enable notifications.
            </div>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={dismiss}
            aria-label="Not now"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    );
  }

  if (state.kind !== "available") return null;

  return (
    <div className="px-4 md:px-8">
      <div className="card mt-3 px-3 py-2 flex items-start gap-3 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-100">
        <Bell size={18} className="mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0 text-sm">
          <div className="font-medium">
            Get reminders even when this app is closed
          </div>
          <div className="text-xs opacity-90">
            Enable push notifications and Family Hub will tap your phone or
            laptop the moment a reminder fires, even from the lock screen.
            You can turn this off in <span className="font-semibold">Settings → Notifications</span> later.
          </div>
          {error && (
            <div className="text-xs text-rose-700 dark:text-rose-300 mt-1">
              {error}
            </div>
          )}
        </div>
        <button
          type="button"
          className="btn btn-sm bg-amber-500 text-white border-transparent hover:brightness-105"
          onClick={enable}
          disabled={busy}
        >
          {busy ? "Enabling…" : "Enable"}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={dismiss}
          aria-label="Not now"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
