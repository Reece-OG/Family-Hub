"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// v4.7.17 — minimal pull-to-refresh for the iOS PWA + Android Chrome PWA.
//
// Why this exists: in a standalone-display PWA (the icon installed from
// "Add to Home Screen"), the browser's own pull-to-refresh gesture is
// disabled by the manifest's "display: standalone" mode. There's no
// address bar to drag, so the user has to find the in-app Refresh button
// instead — which lots of people reasonably never noticed.
//
// What it does:
//   • Listens for touchstart at the very top of the page (scrollTop === 0).
//   • Tracks downward drag distance. Once it crosses a threshold we trigger
//     `router.refresh()` (which re-runs server components on the current
//     route, same as the AutoRefresher) on touchend.
//   • Renders a small "↻ Pull to refresh" pill that grows / changes label
//     as the user drags so the gesture is discoverable.
//   • Activates only on coarse pointers (no:pointer:fine media query) so
//     desktop users with a trackpad/mouse don't trigger it accidentally.
//
// We deliberately don't try to prevent the browser's overscroll bounce —
// fighting it on iOS leads to broken-feeling pages. We just listen, and
// when the user crosses our threshold we refresh.

const ACTIVATE_PX = 80;     // distance at which release will fire a refresh
const MAX_DRAG_PX = 120;    // clamp so the indicator doesn't fly off

export function PullToRefresh() {
  const router = useRouter();
  const [drag, setDrag] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const armed = useRef(false);

  useEffect(() => {
    // Only attach on coarse pointers (touch). matchMedia is safe inside
    // the effect — runs on the client only.
    if (typeof window === "undefined") return;
    if (!window.matchMedia("(pointer: coarse)").matches) return;

    const onStart = (e: TouchEvent) => {
      // Only arm the gesture when the user starts at the very top of the
      // page. document.scrollingElement covers iOS Safari quirks.
      const scrollTop =
        document.scrollingElement?.scrollTop ??
        document.documentElement.scrollTop ??
        0;
      if (scrollTop > 0) {
        armed.current = false;
        return;
      }
      armed.current = true;
      startY.current = e.touches[0]?.clientY ?? null;
    };

    const onMove = (e: TouchEvent) => {
      if (!armed.current || startY.current == null) return;
      const y = e.touches[0]?.clientY ?? 0;
      const dy = y - startY.current;
      if (dy <= 0) {
        setDrag(0);
        return;
      }
      // Light easing past the threshold so the indicator doesn't whip up.
      const eased = dy < ACTIVATE_PX ? dy : ACTIVATE_PX + (dy - ACTIVATE_PX) * 0.35;
      setDrag(Math.min(eased, MAX_DRAG_PX));
    };

    const onEnd = async () => {
      const triggered = armed.current && drag >= ACTIVATE_PX && !refreshing;
      startY.current = null;
      armed.current = false;
      if (!triggered) {
        setDrag(0);
        return;
      }
      setRefreshing(true);
      try {
        router.refresh();
        // Give the refresh a beat to flush so the indicator doesn't blink
        // out before the user sees feedback.
        await new Promise((r) => setTimeout(r, 600));
      } finally {
        setRefreshing(false);
        setDrag(0);
      }
    };

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: true });
    document.addEventListener("touchend", onEnd, { passive: true });
    document.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
    };
  }, [router, drag, refreshing]);

  // Hide entirely when there's no drag in progress AND no refresh running —
  // keeps it from cluttering desktop or the moment after a refresh.
  if (drag === 0 && !refreshing) return null;

  const progress = Math.min(1, drag / ACTIVATE_PX);
  const label = refreshing
    ? "Refreshing…"
    : progress >= 1
      ? "Release to refresh"
      : "Pull to refresh";

  return (
    <div
      // Pinned just under the top edge. translateY follows the drag so the
      // pill appears to come down with the gesture.
      className="fixed left-1/2 z-50 -translate-x-1/2 pointer-events-none"
      style={{
        top: 8,
        transform: `translate(-50%, ${refreshing ? 24 : Math.min(drag * 0.6, 60)}px)`,
        opacity: refreshing ? 1 : Math.min(1, progress + 0.4),
        transition: refreshing
          ? "transform 200ms ease, opacity 200ms ease"
          : "opacity 80ms linear",
      }}
    >
      <div className="px-3 py-1.5 rounded-full text-xs font-medium bg-[rgb(var(--card))] border border-[rgb(var(--border))] shadow-md flex items-center gap-2">
        <span
          className="inline-block"
          style={{
            transform: `rotate(${refreshing ? 0 : progress * 360}deg)`,
            transition: refreshing
              ? "transform 800ms linear infinite"
              : "transform 60ms linear",
          }}
        >
          ↻
        </span>
        {label}
      </div>
    </div>
  );
}
