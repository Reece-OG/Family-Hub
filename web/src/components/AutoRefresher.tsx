"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// v4.7.17 — drop this into any server-rendered page that should stay fresh
// without a manual reload. It calls `router.refresh()` (which re-runs the
// server component on the current route) on:
//
//   • initial mount
//   • document visibilitychange → visible  (PWA wake / tab return)
//   • every `intervalMs` while the document is visible
//
// We deliberately skip the periodic refresh while the tab is hidden — no
// point burning bandwidth on data the user isn't looking at — and run an
// immediate refresh the moment it becomes visible again so the page is
// up-to-date by the time the user sees it.
//
// Used by the Dashboard (/dashboard/page.tsx) to keep the "Coming Up" event
// list, open-todo count, shopping count etc. live.
export function AutoRefresher({
  intervalMs = 60_000,
}: {
  intervalMs?: number;
}) {
  const router = useRouter();

  useEffect(() => {
    const refresh = () => router.refresh();

    refresh(); // initial — covers the "I just walked back into the kitchen" case

    const onVis = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVis);

    let timer: ReturnType<typeof setInterval> | null = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, intervalMs);

    return () => {
      document.removeEventListener("visibilitychange", onVis);
      if (timer) clearInterval(timer);
      timer = null;
    };
  }, [router, intervalMs]);

  return null;
}
