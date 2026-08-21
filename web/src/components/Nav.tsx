"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  CalendarDays,
  Cake,
  Camera,
  ChefHat,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Home,
  Image as ImageIcon,
  LogOut,
  MoreHorizontal,
  Receipt,
  Settings,
  ShoppingCart,
  Sparkles,
  Star,
  StickyNote,
  UtensilsCrossed,
  Users,
  Wrench,
} from "lucide-react";
import clsx from "clsx";
import { useEffect, useState } from "react";
import { ThemeToggle } from "./ThemeToggle";
import { APP_NAME } from "@/lib/app-name";

export type NavMe = {
  id: string;
  name: string;
  role: "PARENT" | "CHILD";
  color: string;
  avatarEmoji: string;
  permissions?: Record<string, boolean> | null;
  // v4.7.4 — true when the session is signed in as a kiosk / local device
  // rather than a personal email account. Used to hide "private to me"
  // tabs (Maintenance, My Taxes) from shared screens.
  isDevice?: boolean;
  // v4.8.2 — module IDs the parent has chosen to keep visible in this
  // session (global hide list + per-kiosk hide list already applied by
  // the server layout). Anything not in this list is hidden from the nav.
  visibleModules?: string[];
};

type NavItem = {
  href: string;
  label: string;
  icon: any;
  show: boolean;
  // v4.8.2 — links the nav row back to its lib/modules.ts module so we
  // can filter against the visibleModules allowlist below.
  moduleId?: string;
};

function navItems(me: NavMe): NavItem[] {
  const parent = me.role === "PARENT";
  const perms = me.permissions ?? null;
  const allow = (key: string, fallback = true) =>
    parent || (perms ? Boolean(perms[key]) : fallback);

  const items: NavItem[] = [
    {
      href: "/dashboard",
      label: "Home",
      icon: Home,
      show: true,
      moduleId: "dashboard",
    },
    {
      href: "/calendar",
      label: "Calendar",
      icon: CalendarDays,
      show: allow("canViewCalendar"),
      moduleId: "calendar",
    },
    {
      href: "/starred",
      label: "Starred",
      icon: Star,
      show: allow("canViewCalendar"),
      moduleId: "starred",
    },
    {
      href: "/birthdays",
      label: "Birthdays",
      icon: Cake,
      show: allow("canViewCalendar"),
      moduleId: "birthdays",
    },
    {
      href: "/todos",
      label: "To-Dos",
      icon: CheckSquare,
      show: allow("canViewTodos"),
      moduleId: "todos",
    },
    {
      href: "/shopping",
      label: "Shopping",
      icon: ShoppingCart,
      show: allow("canViewShopping"),
      moduleId: "shopping",
    },
    {
      href: "/menu",
      label: "Menu",
      icon: UtensilsCrossed,
      show: allow("canViewMenu"),
      moduleId: "menu",
    },
    {
      href: "/recipes",
      label: "Recipes",
      icon: ChefHat,
      show: allow("canViewRecipes"),
      moduleId: "recipes",
    },
    {
      href: "/rewards",
      label: "Rewards",
      icon: Sparkles,
      show: allow("canViewRewards"),
      moduleId: "rewards",
    },
    {
      href: "/reminders",
      label: "Reminders",
      icon: Bell,
      show: allow("canViewReminders"),
      moduleId: "reminders",
    },
    {
      href: "/notes",
      label: "Notes",
      icon: StickyNote,
      // v4.9.2 — every signed-in user can view + post; no permission gate.
      // The module hide list still controls whether the nav entry renders.
      show: true,
      moduleId: "notes",
    },
    {
      href: "/photos",
      label: "Photos",
      icon: Camera,
      show: allow("canViewPhotos"),
      moduleId: "photos",
    },
    {
      href: "/maintenance",
      label: "Maintenance",
      icon: Wrench,
      // v4.7.4 — Maintenance was previously a permission-gated tab. It
      // remains so for personal sessions, but is hidden outright on kiosk
      // devices so receipts / registration docs / insurance numbers never
      // appear on a shared screen.
      show: !me.isDevice && allow("canViewMaintenance", false),
      moduleId: "maintenance",
    },
    {
      href: "/taxes",
      label: "My Taxes",
      icon: Receipt,
      // v4.7.4 — strictly per-user feature. Hidden on kiosks; visible to
      // every email-account user (private to that user via the API layer).
      show: !me.isDevice,
      moduleId: "taxes",
    },
    {
      href: "/family",
      label: "Family",
      icon: Users,
      show: parent,
      moduleId: "family",
    },
    {
      href: "/settings",
      label: "Settings",
      icon: Settings,
      show: parent,
      moduleId: "settings",
    },
  ];

  // v4.8.2 — apply the parent-configured module hide list. When
  // visibleModules is undefined (older session JSON shape), fall back to
  // the previous behaviour and show everything that passes the
  // permission gates above.
  const visible = me.visibleModules
    ? new Set(me.visibleModules)
    : null;
  return items.filter(
    (i) => i.show && (visible === null || !i.moduleId || visible.has(i.moduleId)),
  );
}

export function Nav({
  me,
  collapsed = false,
  onToggleCollapse,
}: {
  me: NavMe;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const items = navItems(me);
  const [moreOpen, setMoreOpen] = useState(false);

  // Close the mobile "More" sheet whenever the route changes.
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  // On mobile the bottom tab bar is capped at 5 entries; everything else
  // goes into a "More" sheet to avoid cramming.
  const MOBILE_TABS = 4;
  const mobilePrimary = items.slice(0, MOBILE_TABS);
  const mobileOverflow = items.slice(MOBILE_TABS);
  const moreActive =
    moreOpen || mobileOverflow.some((i) => pathname?.startsWith(i.href));

  return (
    <>
      {/* Sidebar (desktop) */}
      <aside
        className={clsx(
          "hidden md:flex md:flex-col md:fixed md:inset-y-0 md:border-r md:border-[rgb(var(--border))] md:bg-[rgb(var(--surface))] transition-[width] duration-200",
          collapsed ? "md:w-16" : "md:w-64",
        )}
      >
        <div
          className={clsx(
            "flex items-center gap-3",
            collapsed ? "p-3 justify-center" : "p-5",
          )}
        >
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0"
            style={{
              background:
                "linear-gradient(135deg,#ff006e,#8338ec 55%,#3a86ff)",
            }}
          >
            <Home size={20} strokeWidth={2.25} />
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <div className="font-bold leading-tight truncate">
                {APP_NAME}
              </div>
              <div className="text-xs muted">Home Dashboard</div>
            </div>
          )}
          {!collapsed && onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              className="btn btn-ghost shrink-0"
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
            >
              <ChevronLeft size={18} />
            </button>
          )}
        </div>
        {collapsed && onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            className="mx-auto mb-1 btn btn-ghost"
            aria-label="Expand sidebar"
            title="Expand sidebar"
          >
            <ChevronRight size={18} />
          </button>
        )}
        <nav
          className={clsx(
            "flex-1 space-y-1 overflow-y-auto",
            collapsed ? "px-2" : "px-3",
          )}
        >
          {items.map((i) => {
            const Icon = i.icon;
            const active =
              pathname === i.href || pathname?.startsWith(i.href + "/");
            return (
              <Link
                key={i.href}
                href={i.href}
                className={clsx(
                  "flex items-center gap-3 rounded-xl font-medium",
                  collapsed
                    ? "px-0 py-2.5 justify-center"
                    : "px-3 py-2.5",
                  active
                    ? "bg-[rgb(var(--surface-2))] text-[rgb(var(--brand))]"
                    : "hover:bg-[rgb(var(--surface-2))]",
                )}
                title={collapsed ? i.label : undefined}
              >
                <Icon size={18} />
                {!collapsed && <span>{i.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* v4.9.7 — kiosk-only "Activate screensaver" affordance, slotted
            between the nav items and the user/theme footer. Now that the
            Settings module is hidden from kiosks by default, the parent
            walking up to a screen still needs a way to manually punt it
            into the slideshow (waiting for the idle timer is impractical
            when the kid's just done with homework). Email sessions don't
            see this — they have no business kicking a kiosk into
            screensaver mode from a different device. */}
        {me.isDevice && (
          <div
            className={clsx(
              "border-t border-[rgb(var(--border))]",
              collapsed ? "p-2" : "p-3",
            )}
          >
            <Link
              href="/screensaver"
              className={clsx(
                "flex items-center gap-3 rounded-xl font-medium text-sm",
                collapsed
                  ? "px-0 py-2.5 justify-center"
                  : "px-3 py-2.5",
                "bg-[rgb(var(--surface-2))] hover:brightness-110",
              )}
              title={collapsed ? "Activate screensaver" : undefined}
            >
              <ImageIcon size={18} />
              {!collapsed && <span>Activate screensaver</span>}
            </Link>
          </div>
        )}

        <div
          className={clsx(
            "border-t border-[rgb(var(--border))]",
            collapsed ? "p-2" : "p-3",
          )}
        >
          {collapsed ? (
            <div className="flex flex-col items-center gap-2">
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center text-lg"
                title={me.name}
                style={{
                  background: me.color + "33",
                  border: `1px solid ${me.color}`,
                }}
              >
                {me.avatarEmoji}
              </div>
              <ThemeToggle />
              <button
                onClick={logout}
                className="btn btn-ghost"
                aria-label="Log Out"
                title="Log Out"
              >
                <LogOut size={18} />
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 px-2 py-2">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-lg"
                  style={{
                    background: me.color + "33",
                    border: `1px solid ${me.color}`,
                  }}
                >
                  {me.avatarEmoji}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{me.name}</div>
                  <div className="text-xs muted capitalize">
                    {me.role.toLowerCase()}
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between mt-2">
                <ThemeToggle />
                <button
                  onClick={logout}
                  className="btn btn-ghost"
                  aria-label="Log Out"
                >
                  <LogOut size={18} />
                  <span className="text-sm">Log Out</span>
                </button>
              </div>
              {/* v4.9.7 — discreet "Install this app" link.
                  v4.9.10 — used to be gated on !me.isDevice on the
                  assumption that "kiosks are already the install"; that
                  was wrong. Kiosk users genuinely need this page — it's
                  where the Firefox-on-Linux .desktop launcher generator
                  lives, which is exactly what a parent reaches for when
                  setting up a new Ubuntu kiosk. Show it for everyone. */}
              <Link
                href="/install"
                className="block text-xs muted hover:underline mt-2 px-2"
              >
                Install Family Hub on this device →
              </Link>
            </>
          )}
        </div>
      </aside>

      {/* Mobile top bar. The outer header picks up env(safe-area-inset-top)
          as padding so that in iOS PWA standalone mode the logo / dark-mode /
          sign-out controls sit below the status bar (battery + clock) rather
          than colliding with it. */}
      <header
        className="md:hidden sticky top-0 z-20 bg-[rgb(var(--surface))]/80 backdrop-blur border-b border-[rgb(var(--border))]"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="flex items-center justify-between px-4 py-2.5">
          <div className="flex items-center gap-2">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center text-white"
              style={{
                background: "linear-gradient(135deg,#ff006e,#8338ec 55%,#3a86ff)",
              }}
            >
              <Home size={16} strokeWidth={2.25} />
            </div>
            <div className="font-bold">{APP_NAME}</div>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <button onClick={logout} className="btn btn-ghost" aria-label="Log Out">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile bottom tab bar. Padding-bottom picks up the iOS home-indicator
          inset so the row doesn't clash with the swipe-up bar on newer
          iPhones in PWA mode. */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-20 bg-[rgb(var(--surface))]/95 backdrop-blur border-t border-[rgb(var(--border))] flex"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {mobilePrimary.map((i) => {
          const Icon = i.icon;
          const active =
            pathname === i.href || pathname?.startsWith(i.href + "/");
          return (
            <Link
              key={i.href}
              href={i.href}
              className={clsx(
                "flex-1 flex flex-col items-center justify-center py-2 text-xs gap-0.5",
                active ? "text-[rgb(var(--brand))]" : "muted"
              )}
            >
              <Icon size={20} />
              <span>{i.label}</span>
            </Link>
          );
        })}
        {mobileOverflow.length > 0 && (
          <button
            onClick={() => setMoreOpen((v) => !v)}
            className={clsx(
              "flex-1 flex flex-col items-center justify-center py-2 text-xs gap-0.5",
              moreActive ? "text-[rgb(var(--brand))]" : "muted"
            )}
            aria-label="More"
          >
            <MoreHorizontal size={20} />
            <span>More</span>
          </button>
        )}
      </nav>

      {/* Mobile overflow sheet */}
      {moreOpen && (
        <div
          className="md:hidden fixed inset-0 z-30 bg-black/50"
          onClick={() => setMoreOpen(false)}
        >
          <div
            className="absolute bottom-16 inset-x-0 bg-[rgb(var(--surface))] border-t border-[rgb(var(--border))] rounded-t-2xl p-3 grid grid-cols-3 gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            {mobileOverflow.map((i) => {
              const Icon = i.icon;
              const active =
                pathname === i.href || pathname?.startsWith(i.href + "/");
              return (
                <Link
                  key={i.href}
                  href={i.href}
                  className={clsx(
                    "flex flex-col items-center justify-center gap-1 py-3 rounded-xl text-sm",
                    active
                      ? "bg-[rgb(var(--surface-2))] text-[rgb(var(--brand))]"
                      : "hover:bg-[rgb(var(--surface-2))]"
                  )}
                >
                  <Icon size={22} />
                  <span>{i.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
