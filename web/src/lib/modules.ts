// v4.8.2 — module visibility catalogue.
//
// Each "module" is a top-level feature with its own nav entry and route
// prefix. Parents can:
//   • Hide a module app-wide (AppSettings.disabledModules). Removes the
//     nav entry for everyone and gates the corresponding routes.
//   • Hide a module on a specific kiosk (LocalDevice.hiddenModules). ADDS
//     to the global list — a kiosk can subtract from what the family sees,
//     never re-enable something the family-wide setting has taken away.
//
// The catalogue is the single source of truth. Nav.tsx reads it to render
// the sidebar; each (app)/<module>/page.tsx imports requireModule() to
// redirect away if its module is hidden in the current session's effective
// list. SettingsView reads it to render the toggle list.
//
// Adding a new feature?  Add a row here, then teach the page guard to call
// requireModule(MODULE_ID). The schema doesn't need to change — both
// disabledModules and hiddenModules are JSON arrays of opaque IDs, so new
// IDs naturally drop in.

export type ModuleId =
  | "dashboard"
  | "calendar"
  | "starred"
  | "birthdays"
  | "todos"
  | "shopping"
  | "menu"
  | "recipes"
  | "rewards"
  | "reminders"
  | "notes"
  | "photos"
  | "maintenance"
  | "taxes"
  | "family"
  | "settings";

export interface ModuleDef {
  id: ModuleId;
  label: string;
  // Route prefix this module owns. Used by the server guard to recognise
  // which module a request belongs to without scattering string literals.
  route: string;
  // Can be hidden via AppSettings.disabledModules. Dashboard + Settings are
  // pinned because hiding them would lock the operator out of their own
  // app.
  globalHideable: boolean;
  // Can be hidden via LocalDevice.hiddenModules. Most things can — the
  // Settings module is the standout because the entire "lock down a
  // shared kiosk" use case turns on hiding Settings from the kitchen
  // screen while keeping it on the parent's phone.
  kioskHideable: boolean;
}

export const MODULES: ModuleDef[] = [
  {
    id: "dashboard",
    label: "Home",
    route: "/dashboard",
    globalHideable: false,
    kioskHideable: false,
  },
  {
    id: "calendar",
    label: "Calendar",
    route: "/calendar",
    globalHideable: true,
    kioskHideable: true,
  },
  {
    id: "starred",
    label: "Starred",
    route: "/starred",
    globalHideable: true,
    kioskHideable: true,
  },
  {
    id: "birthdays",
    label: "Birthdays",
    route: "/birthdays",
    globalHideable: true,
    kioskHideable: true,
  },
  {
    id: "todos",
    label: "To-Dos",
    route: "/todos",
    globalHideable: true,
    kioskHideable: true,
  },
  {
    id: "shopping",
    label: "Shopping",
    route: "/shopping",
    globalHideable: true,
    kioskHideable: true,
  },
  {
    id: "menu",
    label: "Menu",
    route: "/menu",
    globalHideable: true,
    kioskHideable: true,
  },
  {
    id: "recipes",
    label: "Recipes",
    route: "/recipes",
    globalHideable: true,
    kioskHideable: true,
  },
  {
    id: "rewards",
    label: "Rewards",
    route: "/rewards",
    globalHideable: true,
    kioskHideable: true,
  },
  {
    id: "reminders",
    label: "Reminders",
    route: "/reminders",
    globalHideable: true,
    kioskHideable: true,
  },
  {
    id: "notes",
    label: "Notes",
    route: "/notes",
    globalHideable: true,
    kioskHideable: true,
  },
  {
    id: "photos",
    label: "Photos",
    route: "/photos",
    globalHideable: true,
    kioskHideable: true,
  },
  {
    id: "maintenance",
    label: "Maintenance",
    route: "/maintenance",
    globalHideable: true,
    kioskHideable: true,
  },
  {
    id: "taxes",
    label: "My Taxes",
    route: "/taxes",
    globalHideable: true,
    kioskHideable: true,
  },
  {
    id: "family",
    label: "Family",
    route: "/family",
    // v4.8.2 — pinned globally alongside Settings: hiding Family app-wide
    // would strand the parent with no way to add / edit users, which is
    // load-bearing for everything else. Still kiosk-hideable so a kitchen
    // screen can be locked down.
    globalHideable: false,
    kioskHideable: true,
  },
  {
    id: "settings",
    label: "Settings",
    route: "/settings",
    // Pinned globally so a parent can't accidentally lock themselves out
    // of the gear icon on every device. But it IS kiosk-hideable — that's
    // the whole shared-screen lockdown use case.
    globalHideable: false,
    kioskHideable: true,
  },
];

export const ALL_MODULE_IDS: ModuleId[] = MODULES.map((m) => m.id);

// Match a path back to its owning module so route guards can ask "is this
// module hidden?" without hard-coding the comparison.
export function moduleForPath(pathname: string | null | undefined): ModuleDef | null {
  if (!pathname) return null;
  // Sort by route length so /maintenance doesn't accidentally match before
  // any future /maintenance-foo etc.
  for (const m of [...MODULES].sort((a, b) => b.route.length - a.route.length)) {
    if (pathname === m.route || pathname.startsWith(m.route + "/")) return m;
  }
  return null;
}

// Defensive JSON parser — settings.disabledModules / device.hiddenModules
// come back from Prisma as Json (unknown shape). We accept anything that
// looks like an array of strings; everything else is treated as empty.
export function parseModuleList(value: unknown): ModuleId[] {
  if (!Array.isArray(value)) return [];
  const valid = new Set<string>(ALL_MODULE_IDS);
  return value.filter(
    (v): v is ModuleId => typeof v === "string" && valid.has(v),
  );
}

export interface EffectiveModulesInput {
  // App-wide hide list (operator-set).
  globalDisabled: unknown;
  // Per-kiosk hide list, or null for email sessions.
  deviceHidden: unknown | null;
}

// Resolve the visible module IDs for the current session. Kiosk overrides
// are additive — they can only HIDE, never re-enable something the global
// list has already taken away. Dashboard is always visible regardless of
// configuration (otherwise the user would land on a redirect loop after
// every login).
export function effectiveModuleIds({
  globalDisabled,
  deviceHidden,
}: EffectiveModulesInput): Set<ModuleId> {
  const visible = new Set<ModuleId>(ALL_MODULE_IDS);
  const hidden = new Set<string>([
    ...parseModuleList(globalDisabled),
    ...parseModuleList(deviceHidden ?? []),
  ]);
  for (const id of hidden) {
    // Dashboard never disappears even if someone sneaks it into the DB.
    if (id === "dashboard") continue;
    visible.delete(id as ModuleId);
  }
  return visible;
}

// Convenience: is this specific module visible right now?
export function isModuleVisible(
  id: ModuleId,
  input: EffectiveModulesInput,
): boolean {
  return effectiveModuleIds(input).has(id);
}
