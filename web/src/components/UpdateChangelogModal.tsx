"use client";

// v4.9.1 — post-update changelog modal.
//
// Mounted in AppShell so it appears once per fresh-deploy + per browser
// + per user, regardless of which page they land on first. The flow:
//
//   1. On mount, read window.localStorage.familyhub:lastSeenVersion.
//   2. If null (first-ever visit): silently stamp it to the current
//      version. We never want a fresh install to see a wall of
//      historical highlights.
//   3. If non-null AND ≠ current version: show the modal with the
//      ChangelogEntries strictly between lastSeen and current.
//   4. "Got it" stamps lastSeen = current, modal disappears.
//
// The modal is purposefully un-dismissable by clicking the backdrop —
// users routinely click outside dialogs to investigate and we don't want
// the changelog to vanish before they've read it. There IS a small X
// close button as an escape hatch.

import { useEffect, useState } from "react";
import { X, Sparkles } from "lucide-react";
import { entriesBetween, type ChangelogEntry } from "@/lib/changelog";

const STORAGE_KEY = "familyhub:lastSeenVersion";

export function UpdateChangelogModal({ currentVersion }: { currentVersion: string }) {
  const [entries, setEntries] = useState<ChangelogEntry[] | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // v4.9.4 — delay the evaluation past the service-worker handoff. When a
    // fresh deploy lands, ServiceWorkerRegister fires window.location.reload()
    // the moment the new SW takes over; before this delay was in place, the
    // modal rendered, got killed by the reload, and rendered again on the
    // second page load, which read as a flicker. 600 ms is comfortably
    // longer than the SW activation roundtrip (typically tens of ms) so the
    // reload — if it's going to happen — fires before we paint anything.
    const timer = setTimeout(() => {
      let stored: string | null = null;
      try {
        stored = window.localStorage.getItem(STORAGE_KEY);
      } catch {
        // localStorage unavailable (private mode, blocked, …) — show
        // nothing. Without a stamp we'd nag on every page load.
        return;
      }

      // First-ever visit: stamp silently so they don't see a backlog.
      if (!stored) {
        try {
          window.localStorage.setItem(STORAGE_KEY, currentVersion);
        } catch {
          /* ignore */
        }
        return;
      }

      // Same as current — nothing to show.
      if (stored === currentVersion) return;

      const toShow = entriesBetween(stored, currentVersion);
      if (toShow.length === 0) {
        // Could happen if the user is rolled BACK to an older version.
        // Just resync the stamp so we don't keep nagging.
        try {
          window.localStorage.setItem(STORAGE_KEY, currentVersion);
        } catch {
          /* ignore */
        }
        return;
      }

      setEntries(toShow);
    }, 600);

    return () => clearTimeout(timer);
  }, [currentVersion]);

  function dismiss() {
    try {
      window.localStorage.setItem(STORAGE_KEY, currentVersion);
    } catch {
      /* ignore */
    }
    setEntries(null);
  }

  if (!entries || entries.length === 0) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-changelog-title"
    >
      <div className="flex min-h-full items-start sm:items-center justify-center p-3 sm:p-4">
        <div className="card w-full max-w-lg p-5 relative my-4 sm:my-8 space-y-4">
          <button
            type="button"
            onClick={dismiss}
            className="absolute right-3 top-3 btn btn-ghost"
            aria-label="Close"
          >
            <X size={18} />
          </button>
          <div className="flex items-center gap-2 pr-10">
            <Sparkles size={20} className="text-violet-500 shrink-0" />
            <h2
              id="update-changelog-title"
              className="text-lg font-bold leading-tight"
            >
              Family Hub was updated
            </h2>
          </div>
          <p className="text-sm muted">
            You&apos;re now on v{currentVersion}. Here&apos;s what&apos;s new
            since you last opened the app.
          </p>
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
            {entries.map((e) => (
              <section key={e.version}>
                <div className="text-sm font-semibold">
                  v{e.version}
                  {e.title && (
                    <span className="font-normal muted"> — {e.title}</span>
                  )}
                </div>
                <ul className="mt-1 space-y-1 text-sm list-disc pl-5">
                  {e.highlights.map((h, i) => (
                    <li key={i}>{h}</li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <div className="flex justify-end pt-1">
            <button
              type="button"
              className="btn btn-primary"
              onClick={dismiss}
            >
              Got it
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
