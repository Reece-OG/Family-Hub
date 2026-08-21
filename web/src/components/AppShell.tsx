"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Nav, type NavMe } from "./Nav";
import { PushEnrolmentBanner } from "./PushEnrolmentBanner";
import { PullToRefresh } from "./PullToRefresh";
import { UpdateChangelogModal } from "./UpdateChangelogModal";
import { APP_VERSION } from "@/lib/app-version";

// Wraps the nav + main content so the desktop sidebar can collapse to an
// icon-only rail on smaller screens. State is persisted in localStorage so
// the choice survives reloads. This lives in a client component because
// localStorage is the source of truth — `layout.tsx` (server) just hands us
// `me` + `children`.

const STORAGE_KEY = "familyhub:sidebar-collapsed";

export function AppShell({
  me,
  children,
}: {
  me: NavMe;
  children: React.ReactNode;
}) {
  // Start collapsed=false so server + client render match; a useEffect hydrates
  // from localStorage on mount. Avoids a flash of the wrong state only once
  // (first paint is always expanded).
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "1") setCollapsed(true);
    } catch {
      // localStorage unavailable (private mode, etc) — accept the default.
    }
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* noop */
      }
      return next;
    });
  }, []);

  return (
    <>
      {/* v4.7.17 — touch-only pull-to-refresh for the standalone PWA. Self-
          hides on desktop / when idle; no-op for users not in a PWA. */}
      <PullToRefresh />
      {/* v4.9.1 — post-update changelog modal. Self-hides on a fresh
          install (silently stamps the version), only shows when the
          stored lastSeenVersion is older than the current build. */}
      <UpdateChangelogModal currentVersion={APP_VERSION} />
      <Nav me={me} collapsed={collapsed} onToggleCollapse={toggle} />
      <main
        className={clsx(
          // Mobile: reserve room for the bottom tab bar PLUS the iOS
          // home-indicator inset so content is never obscured in PWA mode.
          // Desktop (md:) clears the padding — no bottom nav up there.
          "pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-0 transition-[padding] duration-200",
          collapsed ? "md:pl-16" : "md:pl-64",
        )}
      >
        {/* v4.7.9 — push opt-in banner. Self-hides when the device is
            already enrolled, push isn't supported, or the user dismissed it. */}
        <div className="max-w-6xl mx-auto">
          <PushEnrolmentBanner />
        </div>
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-6">{children}</div>
      </main>
    </>
  );
}
