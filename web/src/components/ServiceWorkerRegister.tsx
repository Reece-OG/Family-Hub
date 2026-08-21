"use client";

import { useEffect } from "react";

// Registers /sw.js once on first load. We only run in production — the Next
// dev server plays havoc with service-worker caching while files are being
// hot-reloaded, and we don't need the install banner during development.
//
// v4.7.1 — adds update-detection glue so the Android Chrome "app is out of
// date" warning never appears. The flow:
//   1. On load, register the SW and check for an update.
//   2. If the newly-installed SW is waiting, poke it with SKIP_WAITING so it
//      claims clients immediately.
//   3. When the active SW changes (controllerchange), reload the page once
//      so the new bundle is actually running. The `reloaded` guard stops us
//      from reload-looping.

const RELOAD_FLAG = "__familyhub_sw_reloaded__";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;

    let reloaded = false;

    function onControllerChange() {
      if (reloaded) return;
      reloaded = true;
      // Guard against reload loops across browser navigations.
      const w = window as Window & { [RELOAD_FLAG]?: boolean };
      if (w[RELOAD_FLAG]) return;
      w[RELOAD_FLAG] = true;
      window.location.reload();
    }

    function wireReg(reg: ServiceWorkerRegistration) {
      // If there's already a waiting worker (fresh deploy landed while the
      // tab was open), activate it right now.
      if (reg.waiting) {
        reg.waiting.postMessage({ type: "FAMILYHUB_SW_SKIP_WAITING" });
      }
      // Listen for future updates.
      reg.addEventListener("updatefound", () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            // A new SW is installed and there's already a controller (i.e.
            // this isn't the very first install) — prompt activation.
            installing.postMessage({ type: "FAMILYHUB_SW_SKIP_WAITING" });
          }
        });
      });
    }

    function register() {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then((reg) => {
          wireReg(reg);
          // Proactively check for updates when the page loads so any deploy
          // that happened while the PWA was backgrounded gets pulled in.
          reg.update().catch(() => undefined);
        })
        .catch((err) => {
          // Failing to register the SW shouldn't break the app. It just
          // means the user won't get the "Install app" prompt on this
          // browser.
          console.warn("[sw] registration failed:", err?.message || err);
        });

      navigator.serviceWorker.addEventListener(
        "controllerchange",
        onControllerChange,
      );

      // Any postMessage from the SW saying "I just took over" also triggers
      // the reload, covering the first-install case where controllerchange
      // fires before we've attached the listener.
      navigator.serviceWorker.addEventListener("message", (e) => {
        if (e.data && e.data.type === "FAMILYHUB_SW_UPDATED") {
          onControllerChange();
        }
      });
    }

    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
    }

    return () => {
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        onControllerChange,
      );
    };
  }, []);

  return null;
}
