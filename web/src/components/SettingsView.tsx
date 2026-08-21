"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Archive,
  Bell,
  CalendarDays,
  CalendarRange,
  CheckCircle2,
  Clock,
  CloudSun,
  Download,
  FileText,
  Globe,
  Image,
  Lock,
  Mail,
  MapPin,
  MonitorSmartphone,
  Moon,
  Package,
  Palette,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  Shuffle,
  Tag,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { APP_NAME } from "@/lib/app-name";
// v4.8.2 — module catalogue. MODULES is the source of truth for which
// features can be hidden; both the global toggle card and the per-kiosk
// override card read it (also LocalDevicesCard → ModuleHideSubcard).
import { MODULES as MOD_DEFS } from "@/lib/modules";

type Settings = {
  id: string;
  countryCode: string;
  timezone: string;
  showHolidays: boolean;
  lastHolidaySync: string | null;
  // v3 additions
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean;
  smtpUser: string | null;
  smtpPass: string | null;
  smtpFrom: string | null;
  screensaverIntervalMs: number;
  sleepModeEnabled: boolean;
  sleepStartTime: string;
  sleepEndTime: string;
  sleepIdleMinutes: number;
  weekStartsOn: number;
  // v4.4 additions
  todoColor: string | null;
  birthdayColor: string | null;
  holidayColor: string | null;
  screensaverIdleMinutes: number;
  // v4.6 additions
  screensaverShuffle: boolean;
  weatherEnabled: boolean;
  weatherShowOnHome: boolean;
  weatherShowOnScreensaver: boolean;
  weatherLocationLabel: string | null;
  weatherLatitude: number | null;
  weatherLongitude: number | null;
  weatherProvider: "auto" | "bom" | "open-meteo";
  weatherUnits: "metric" | "imperial";
  // v4.7.4 additions
  financialYearStartMonth: number;
  financialYearStartDay: number;
  // v4.8.2 additions — app-wide module hide list. Optional in the type so
  // a stale client cache during the upgrade doesn't blow up.
  disabledModules?: string[];
};

type GeoHit = {
  label: string;
  latitude: number;
  longitude: number;
  countryCode: string | null;
};

type TodoCategory = {
  id: string;
  name: string;
  color: string | null;
  position: number;
};

const DEFAULT_GROUP_COLORS = {
  todo: "#f59e0b",
  birthday: "#ec4899",
  holiday: "#e11d48",
};

// 0:00, 0:30, 1:00, ..., 23:30 — every half-hour for the start/end pickers.
const HALF_HOURS: string[] = (() => {
  const out: string[] = [];
  for (let h = 0; h < 24; h++) {
    out.push(`${String(h).padStart(2, "0")}:00`);
    out.push(`${String(h).padStart(2, "0")}:30`);
  }
  return out;
})();

function formatTimeLabel(hm: string): string {
  // Renders "22:30" as "10:30 PM" for readability.
  const [hStr, mStr] = hm.split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

// Common ISO 3166-1 alpha-2 codes supported by Nager.Date. Not exhaustive;
// users can still type any code thanks to the free-form fallback.
const COMMON_COUNTRIES: { code: string; name: string }[] = [
  { code: "GB", name: "United Kingdom" },
  { code: "US", name: "United States" },
  { code: "IE", name: "Ireland" },
  { code: "CA", name: "Canada" },
  { code: "AU", name: "Australia" },
  { code: "NZ", name: "New Zealand" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "ES", name: "Spain" },
  { code: "IT", name: "Italy" },
  { code: "NL", name: "Netherlands" },
  { code: "SE", name: "Sweden" },
  { code: "NO", name: "Norway" },
  { code: "DK", name: "Denmark" },
  { code: "FI", name: "Finland" },
  { code: "PL", name: "Poland" },
  { code: "PT", name: "Portugal" },
  { code: "JP", name: "Japan" },
  { code: "MX", name: "Mexico" },
  { code: "BR", name: "Brazil" },
  { code: "IN", name: "India" },
];

// A practical subset of IANA zones. Users can still paste any valid zone.
const COMMON_TIMEZONES = [
  "Europe/London",
  "Europe/Dublin",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Amsterdam",
  "Europe/Stockholm",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Vancouver",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Pacific/Auckland",
  "Asia/Tokyo",
  "Asia/Singapore",
  "UTC",
];

export function SettingsView({ isParent = true }: { isParent?: boolean } = {}) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [categories, setCategories] = useState<TodoCategory[]>([]);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryColor, setNewCategoryColor] = useState("#6366f1");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resyncing, setResyncing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [r, c] = await Promise.all([
        fetch("/api/settings").then((r) => r.json()),
        fetch("/api/todo-categories")
          .then((r) => (r.ok ? r.json() : { categories: [] }))
          .catch(() => ({ categories: [] })),
      ]);
      setSettings(r.settings);
      setCategories(c.categories || []);
    })();
  }, []);

  if (!settings) return <p className="muted text-sm">Loading settings…</p>;

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((s) => (s ? { ...s, [key]: value } : s));
    setDirty(true);
    setMessage(null);
    setError(null);
  }

  async function save() {
    if (!settings) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        countryCode: settings.countryCode,
        timezone: settings.timezone,
        showHolidays: settings.showHolidays,
        smtpHost: settings.smtpHost?.trim() || null,
        smtpPort: settings.smtpPort || null,
        smtpSecure: settings.smtpSecure,
        smtpUser: settings.smtpUser?.trim() || null,
        smtpPass: settings.smtpPass || null,
        smtpFrom: settings.smtpFrom?.trim() || null,
        screensaverIntervalMs: settings.screensaverIntervalMs,
        sleepModeEnabled: settings.sleepModeEnabled,
        sleepStartTime: settings.sleepStartTime,
        sleepEndTime: settings.sleepEndTime,
        sleepIdleMinutes: settings.sleepIdleMinutes,
        weekStartsOn: settings.weekStartsOn,
        todoColor: settings.todoColor,
        birthdayColor: settings.birthdayColor,
        holidayColor: settings.holidayColor,
        screensaverIdleMinutes: settings.screensaverIdleMinutes,
        screensaverShuffle: settings.screensaverShuffle,
        weatherEnabled: settings.weatherEnabled,
        weatherShowOnHome: settings.weatherShowOnHome,
        weatherShowOnScreensaver: settings.weatherShowOnScreensaver,
        weatherLocationLabel: settings.weatherLocationLabel,
        weatherLatitude: settings.weatherLatitude,
        weatherLongitude: settings.weatherLongitude,
        weatherProvider: settings.weatherProvider,
        weatherUnits: settings.weatherUnits,
        financialYearStartMonth: settings.financialYearStartMonth,
        financialYearStartDay: settings.financialYearStartDay,
        // v4.8.2 — module hide list. undefined-safe so older client caches
        // during the upgrade still send a valid PATCH.
        disabledModules: settings.disabledModules ?? [],
      }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      setError(data.error || "Could not save settings");
      return;
    }
    setSettings(data.settings);
    setDirty(false);
    setMessage("Settings saved.");
  }

  async function resyncHolidays() {
    setResyncing(true);
    setError(null);
    setMessage(null);
    const res = await fetch("/api/holidays", { method: "POST" });
    const data = await res.json();
    setResyncing(false);
    if (!res.ok) {
      setError(data.error || "Could not resync holidays");
      return;
    }
    setMessage(
      `Resynced ${data.inserted + data.updated} holidays for ${data.countryCode} (${data.years.join(", ")}).`,
    );
    const s = await fetch("/api/settings").then((r) => r.json());
    setSettings(s.settings);
  }

  async function testEmail() {
    setTesting(true);
    setError(null);
    setMessage(null);
    if (dirty) {
      // Persist first so the test uses the just-edited credentials.
      await save();
    }
    const res = await fetch("/api/settings/test-email", { method: "POST" });
    const data = await res.json();
    setTesting(false);
    if (!res.ok || !data.ok) {
      setError(
        data.error
          ? `Test email failed (${data.step ?? "error"}): ${data.error}`
          : "Test email failed",
      );
      return;
    }
    setMessage("Test email sent — check your inbox.");
  }

  async function addCategory() {
    const name = newCategoryName.trim();
    if (!name) return;
    const res = await fetch("/api/todo-categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, color: newCategoryColor }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Could not add category");
      return;
    }
    setCategories((cs) => [...cs, data.category]);
    setNewCategoryName("");
    setMessage(`Added category “${name}”.`);
  }

  async function updateCategory(
    id: string,
    patch: { name?: string; color?: string | null },
  ) {
    const res = await fetch(`/api/todo-categories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Could not update category");
      return;
    }
    setCategories((cs) => cs.map((c) => (c.id === id ? data.category : c)));
  }

  async function deleteCategory(id: string, name: string) {
    if (
      !confirm(
        `Delete “${name}”? Existing to-dos in this category will keep their title but lose the category tag.`,
      )
    )
      return;
    const res = await fetch(`/api/todo-categories/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Could not delete category");
      return;
    }
    setCategories((cs) => cs.filter((c) => c.id !== id));
    setMessage(`Deleted category “${name}”.`);
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Globe size={18} />
          <h2 className="font-bold text-lg">Country &amp; Holidays</h2>
        </div>

        <CountryPicker
          value={settings.countryCode}
          onChange={(v) => update("countryCode", v)}
        />

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.showHolidays}
            onChange={(e) => update("showHolidays", e.target.checked)}
          />
          Show public holidays on the calendar
        </label>

        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="text-xs muted">
            Last synced:{" "}
            {settings.lastHolidaySync
              ? new Date(settings.lastHolidaySync).toLocaleString()
              : "never"}
          </div>
          <button
            type="button"
            onClick={resyncHolidays}
            disabled={resyncing}
            className="btn btn-secondary"
          >
            <RefreshCw
              size={14}
              className={resyncing ? "animate-spin" : undefined}
            />
            {resyncing ? "Resyncing…" : "Resync holidays now"}
          </button>
        </div>
      </div>

      <div className="card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Clock size={18} />
          <h2 className="font-bold text-lg">Time Zone</h2>
        </div>

        <TimezonePicker
          value={settings.timezone}
          onChange={(v) => update("timezone", v)}
        />
      </div>

      <div className="card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <CalendarDays size={18} />
          <h2 className="font-bold text-lg">Week Starts On</h2>
        </div>
        <p className="text-sm muted">
          Choose whether the calendar and menu planner start each week on
          Sunday or Monday.
        </p>
        <div className="flex gap-2 flex-wrap">
          {[
            { value: 1, label: "Monday" },
            { value: 0, label: "Sunday" },
          ].map((opt) => {
            const active = settings.weekStartsOn === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => update("weekStartsOn", opt.value)}
                className={`btn ${active ? "btn-primary" : "btn-secondary"}`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* v4.7.4 — financial year window powers My Taxes. Family-wide. */}
      <div className="card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <CalendarRange size={18} />
          <h2 className="font-bold text-lg">Financial Year</h2>
        </div>
        <p className="text-sm muted">
          Sets the window My Taxes uses to bucket receipts. Pick a regional
          preset, or set a custom start date below. Day is capped at 28 to
          avoid month-length oddities.
        </p>
        <div className="flex gap-2 flex-wrap">
          {[
            { label: "AU (1 Jul – 30 Jun)", month: 7, day: 1 },
            { label: "US calendar (1 Jan – 31 Dec)", month: 1, day: 1 },
            { label: "UK (6 Apr – 5 Apr)", month: 4, day: 6 },
            { label: "NZ (1 Apr – 31 Mar)", month: 4, day: 1 },
          ].map((opt) => {
            const active =
              settings.financialYearStartMonth === opt.month &&
              settings.financialYearStartDay === opt.day;
            return (
              <button
                key={opt.label}
                type="button"
                onClick={() => {
                  update("financialYearStartMonth", opt.month);
                  update("financialYearStartDay", opt.day);
                }}
                className={`btn btn-sm ${active ? "btn-primary" : "btn-secondary"}`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        <div className="flex gap-2 flex-wrap items-end">
          <label className="text-sm">
            <div className="font-medium mb-1">Start month</div>
            <select
              className="input"
              value={settings.financialYearStartMonth}
              onChange={(e) =>
                update("financialYearStartMonth", Number(e.target.value))
              }
            >
              {[
                "January", "February", "March", "April", "May", "June",
                "July", "August", "September", "October", "November", "December",
              ].map((name, idx) => (
                <option key={name} value={idx + 1}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <div className="font-medium mb-1">Start day</div>
            <input
              className="input"
              type="number"
              min={1}
              max={28}
              value={settings.financialYearStartDay}
              onChange={(e) =>
                update(
                  "financialYearStartDay",
                  Math.max(1, Math.min(28, Number(e.target.value) || 1)),
                )
              }
            />
          </label>
        </div>
      </div>

      <div className="card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Palette size={18} />
          <h2 className="font-bold text-lg">Group Colours</h2>
        </div>
        <p className="text-sm muted">
          Set the default colour for each group of items on the calendar. Leave
          blank to use the built-in defaults.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <ColorField
            label="To-dos on calendar"
            fallback={DEFAULT_GROUP_COLORS.todo}
            value={settings.todoColor}
            onChange={(v) => update("todoColor", v)}
          />
          <ColorField
            label="Birthdays"
            fallback={DEFAULT_GROUP_COLORS.birthday}
            value={settings.birthdayColor}
            onChange={(v) => update("birthdayColor", v)}
          />
          <ColorField
            label="Public holidays"
            fallback={DEFAULT_GROUP_COLORS.holiday}
            value={settings.holidayColor}
            onChange={(v) => update("holidayColor", v)}
          />
        </div>
      </div>

      <div className="card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Tag size={18} />
          <h2 className="font-bold text-lg">To-Do Categories</h2>
        </div>
        <p className="text-sm muted">
          Create named lists so to-dos can be grouped and filtered. Only a
          parent can manage categories — everyone else can tag existing to-dos
          to them.
        </p>
        {categories.length === 0 ? (
          <p className="text-sm muted italic">No categories yet.</p>
        ) : (
          <ul className="space-y-2">
            {categories.map((c) => (
              <li
                key={c.id}
                className="flex items-center gap-2 flex-wrap rounded-xl border border-black/10 dark:border-white/10 p-2"
              >
                <input
                  type="color"
                  className="input p-1 h-[36px] w-[52px]"
                  disabled={!isParent}
                  value={c.color ?? "#6366f1"}
                  onChange={(e) =>
                    updateCategory(c.id, { color: e.target.value })
                  }
                />
                <input
                  className="input flex-1 min-w-[160px]"
                  disabled={!isParent}
                  value={c.name}
                  onChange={(e) =>
                    setCategories((cs) =>
                      cs.map((x) =>
                        x.id === c.id ? { ...x, name: e.target.value } : x,
                      ),
                    )
                  }
                  onBlur={(e) => {
                    const nextName = e.target.value.trim();
                    if (nextName && nextName !== c.name) {
                      updateCategory(c.id, { name: nextName });
                    }
                  }}
                />
                {isParent && (
                  <button
                    type="button"
                    className="btn btn-ghost text-red-500"
                    aria-label={`Delete category ${c.name}`}
                    onClick={() => deleteCategory(c.id, c.name)}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {isParent && (
          <div className="flex flex-wrap items-end gap-2 pt-2 border-t border-black/10 dark:border-white/10">
            <div>
              <label className="text-xs font-medium muted">Colour</label>
              <input
                type="color"
                className="input p-1 h-[36px] w-[52px] mt-1"
                value={newCategoryColor}
                onChange={(e) => setNewCategoryColor(e.target.value)}
              />
            </div>
            <div className="flex-1 min-w-[180px]">
              <label className="text-xs font-medium muted">New category</label>
              <input
                className="input mt-1"
                placeholder="Chores, School, Groceries…"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addCategory();
                }}
              />
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={addCategory}
              disabled={!newCategoryName.trim()}
            >
              <Plus size={14} /> Add
            </button>
          </div>
        )}
      </div>

      <div className="card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Mail size={18} />
          <h2 className="font-bold text-lg">Email (For Reminders)</h2>
        </div>
        <p className="text-sm muted">
          Configure an SMTP server to deliver reminder emails. Leave host blank
          to stick to in-app toasts only.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="text-sm font-medium">SMTP host</label>
            <input
              className="input mt-1"
              value={settings.smtpHost ?? ""}
              placeholder="smtp.example.com"
              onChange={(e) => update("smtpHost", e.target.value || null)}
            />
          </div>
          <div>
            <label className="text-sm font-medium">Port</label>
            <input
              type="number"
              className="input mt-1"
              value={settings.smtpPort ?? ""}
              placeholder="587"
              onChange={(e) =>
                update("smtpPort", e.target.value ? Number(e.target.value) : null)
              }
            />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.smtpSecure}
                onChange={(e) => update("smtpSecure", e.target.checked)}
              />
              Use TLS (465 / implicit)
            </label>
          </div>
          <div>
            <label className="text-sm font-medium">Username</label>
            <input
              className="input mt-1"
              value={settings.smtpUser ?? ""}
              autoComplete="off"
              onChange={(e) => update("smtpUser", e.target.value || null)}
            />
          </div>
          <div>
            <label className="text-sm font-medium">Password / app key</label>
            <input
              type="password"
              className="input mt-1"
              value={settings.smtpPass ?? ""}
              autoComplete="new-password"
              placeholder={settings.smtpPass ? "••••••••" : ""}
              onChange={(e) => update("smtpPass", e.target.value || null)}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="text-sm font-medium">From address</label>
            <input
              className="input mt-1"
              value={settings.smtpFrom ?? ""}
              placeholder={`${APP_NAME} <hub@example.com>`}
              onChange={(e) => update("smtpFrom", e.target.value || null)}
            />
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={testEmail}
            disabled={testing || !settings.smtpHost || !settings.smtpFrom}
          >
            <Send size={14} />
            {testing ? "Sending…" : "Send test email to me"}
          </button>
        </div>
      </div>

      <WeatherCard settings={settings} update={update} />

      {/* v4.7.2 — the standalone "Screensaver" card (slide duration +
          shuffle) has been folded into the Local Devices card below,
          since the slideshow only runs on kiosk devices anyway. Per-
          device idle timers and Night Sleep hours continue to live
          inline inside each device's row. */}
      {/* v4.8.2 — module visibility. The global toggles sit ABOVE Local
          Devices because the card's copy refers users to the per-device
          override panel below for kiosk-only hides. Per-kiosk overrides
          live inside each device row in LocalDevicesCard so they sit
          alongside the other per-device config (sleep schedule, screen-
          saver, …). */}
      {isParent && (
        <ModuleVisibilityCard
          settings={settings}
          update={update}
          onMessage={setMessage}
          onError={setError}
        />
      )}

      {isParent && (
        <LocalDevicesCard
          settings={settings}
          update={update}
          onMessage={setMessage}
          onError={setError}
        />
      )}

      <NotificationsCard />

      {/* v4.9.0 — public REST + outbound webhooks. Sits next to
          Notifications because both are about external delivery channels. */}
      {isParent && <IntegrationsCard />}

      {isParent && <BackupExportCard />}

      {isParent && <SystemCard />}

      {error && (
        <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-xl px-3 py-2">
          {error}
        </div>
      )}
      {message && (
        <div className="text-sm text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 rounded-xl px-3 py-2">
          {message}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!dirty || saving}
          onClick={save}
        >
          <Save size={16} />
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}

function WeatherCard({
  settings,
  update,
}: {
  settings: Settings;
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<GeoHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  async function search() {
    const query = q.trim();
    if (!query) return;
    setSearching(true);
    setSearchError(null);
    try {
      const r = await fetch(`/api/weather/search?q=${encodeURIComponent(query)}`);
      const data = await r.json();
      if (!r.ok) {
        setSearchError(data.error || "Search failed");
        return;
      }
      setHits(data.results || []);
      if ((data.results || []).length === 0) {
        setSearchError("No matches — try a nearby city");
      }
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setSearching(false);
    }
  }

  function pick(hit: GeoHit) {
    update("weatherLocationLabel", hit.label);
    update("weatherLatitude", hit.latitude);
    update("weatherLongitude", hit.longitude);
    // Auto-switch provider when picking an AU location — users explicitly
    // asked for BOM routing down under.
    if (hit.countryCode === "AU" && settings.weatherProvider === "auto") {
      update("weatherProvider", "auto");
    }
    setHits([]);
    setQ("");
    setSearchError(null);
  }

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <CloudSun size={18} />
        <h2 className="font-bold text-lg">Weather</h2>
      </div>
      <p className="text-sm muted">
        Uses the Australian Bureau of Meteorology for AU locations and
        Open-Meteo for everywhere else. Choose independently whether weather
        appears on the home dashboard or the photo screensaver.
      </p>

      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={settings.weatherEnabled}
          onChange={(e) => update("weatherEnabled", e.target.checked)}
        />
        Enable weather (master switch)
      </label>

      <div className="pl-6 space-y-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            disabled={!settings.weatherEnabled}
            checked={settings.weatherShowOnHome}
            onChange={(e) => update("weatherShowOnHome", e.target.checked)}
          />
          Show on home dashboard
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            disabled={!settings.weatherEnabled}
            checked={settings.weatherShowOnScreensaver}
            onChange={(e) => update("weatherShowOnScreensaver", e.target.checked)}
          />
          Show on screensaver
        </label>
      </div>

      <div>
        <label className="text-sm font-medium">Location</label>
        <div className="flex gap-2 mt-1">
          <input
            className="input flex-1"
            placeholder="Search a town or suburb (e.g. Sydney, Brighton, Austin TX)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                search();
              }
            }}
          />
          <button
            type="button"
            className="btn btn-secondary"
            onClick={search}
            disabled={searching || !q.trim()}
          >
            <Search size={14} />
            {searching ? "Searching…" : "Search"}
          </button>
        </div>
        {searchError && (
          <p className="text-xs text-red-600 mt-1">{searchError}</p>
        )}
        {hits.length > 0 && (
          <ul className="mt-2 border rounded-lg divide-y divide-[rgb(var(--border))] overflow-hidden">
            {hits.map((h, i) => (
              <li key={`${h.label}-${i}`}>
                <button
                  type="button"
                  className="w-full text-left px-3 py-2 hover:bg-[rgb(var(--surface-2))] text-sm flex items-center gap-2"
                  onClick={() => pick(h)}
                >
                  <MapPin size={14} className="muted" />
                  <span className="flex-1">{h.label}</span>
                  <span className="text-xs muted tabular-nums">
                    {h.latitude.toFixed(2)}, {h.longitude.toFixed(2)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {settings.weatherLocationLabel && (
          <div className="mt-2 text-xs muted flex items-center gap-1">
            <MapPin size={12} />
            Current:
            <span className="text-[rgb(var(--fg))] font-medium">
              {settings.weatherLocationLabel}
            </span>
            {settings.weatherLatitude != null && settings.weatherLongitude != null && (
              <span className="tabular-nums">
                ({settings.weatherLatitude.toFixed(2)},
                {" "}
                {settings.weatherLongitude.toFixed(2)})
              </span>
            )}
            <button
              type="button"
              className="btn btn-ghost text-xs"
              onClick={() => {
                update("weatherLocationLabel", null);
                update("weatherLatitude", null);
                update("weatherLongitude", null);
              }}
            >
              Clear
            </button>
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="text-sm font-medium">Provider</label>
          <select
            className="select mt-1"
            value={settings.weatherProvider}
            onChange={(e) =>
              update(
                "weatherProvider",
                e.target.value as Settings["weatherProvider"],
              )
            }
          >
            <option value="auto">Auto (BOM for AU, Open-Meteo elsewhere)</option>
            <option value="bom">Force BOM (Australia only)</option>
            <option value="open-meteo">Force Open-Meteo</option>
          </select>
        </div>
        <div>
          <label className="text-sm font-medium">Units</label>
          <select
            className="select mt-1"
            value={settings.weatherUnits}
            onChange={(e) =>
              update(
                "weatherUnits",
                e.target.value as Settings["weatherUnits"],
              )
            }
          >
            <option value="metric">Metric (°C, km/h)</option>
            <option value="imperial">Imperial (°F, mph)</option>
          </select>
        </div>
      </div>
    </div>
  );
}

// Single-control picker for Country: dropdown of common options plus an
// "Other…" row that reveals a two-character text input. Replaces the
// always-visible dropdown + input duo that confused users into thinking
// the second box was a duplicate/non-functional control.
function CountryPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const known = COMMON_COUNTRIES.some((c) => c.code === value);
  const [custom, setCustom] = useState(!known);
  // Keep the "custom" toggle in sync if the value ever changes externally
  // (e.g. after saving the settings form).
  useEffect(() => {
    if (known) setCustom(false);
  }, [known]);
  return (
    <div>
      <label className="text-sm font-medium">Country</label>
      {!custom ? (
        <select
          className="select mt-1"
          value={known ? value : "__custom__"}
          onChange={(e) => {
            if (e.target.value === "__custom__") {
              setCustom(true);
              return;
            }
            onChange(e.target.value);
          }}
        >
          {COMMON_COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name} ({c.code})
            </option>
          ))}
          <option value="__custom__">Other…</option>
        </select>
      ) : (
        <div className="flex gap-2 mt-1">
          <input
            className="input uppercase flex-1"
            maxLength={2}
            value={value}
            onChange={(e) => onChange(e.target.value.toUpperCase())}
            placeholder="GB"
            autoFocus
          />
          <button
            type="button"
            className="btn btn-ghost text-xs"
            onClick={() => {
              setCustom(false);
              // Snap back to the first common country if the user abandons
              // their custom code without picking a match.
              if (!COMMON_COUNTRIES.some((c) => c.code === value)) {
                onChange(COMMON_COUNTRIES[0].code);
              }
            }}
          >
            Use list
          </button>
        </div>
      )}
      <p className="text-xs muted mt-1">
        ISO 3166-1 alpha-2 code. Holidays come from the free Nager.Date API.
      </p>
    </div>
  );
}

// Single-control picker for time zone — same pattern as CountryPicker above.
function TimezonePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const known = COMMON_TIMEZONES.includes(value);
  const [custom, setCustom] = useState(!known);
  useEffect(() => {
    if (known) setCustom(false);
  }, [known]);
  return (
    <div>
      <label className="text-sm font-medium">Time zone</label>
      {!custom ? (
        <select
          className="select mt-1"
          value={known ? value : "__custom__"}
          onChange={(e) => {
            if (e.target.value === "__custom__") {
              setCustom(true);
              return;
            }
            onChange(e.target.value);
          }}
        >
          {COMMON_TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
          <option value="__custom__">Other…</option>
        </select>
      ) : (
        <div className="flex gap-2 mt-1">
          <input
            className="input flex-1"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Europe/London"
            autoFocus
          />
          <button
            type="button"
            className="btn btn-ghost text-xs"
            onClick={() => {
              setCustom(false);
              if (!COMMON_TIMEZONES.includes(value)) {
                onChange(COMMON_TIMEZONES[0]);
              }
            }}
          >
            Use list
          </button>
        </div>
      )}
      <p className="text-xs muted mt-1">
        IANA zone (e.g. Europe/London, America/New_York). Used for date-label
        alignment across the app.
      </p>
    </div>
  );
}

// v4.7.2 — the hex text input was dropped because users were reading the
// tiny box next to the swatch as a phantom "button with no function". The
// swatch is the only control needed; Reset appears only when a custom
// value has been picked, to dial back to the app default.
function ColorField({
  label,
  fallback,
  value,
  onChange,
}: {
  label: string;
  fallback: string;
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const effective = value ?? fallback;
  return (
    <div>
      <label className="text-sm font-medium">{label}</label>
      <div className="flex items-center gap-2 mt-1">
        <input
          type="color"
          className="input p-1 h-[36px] w-[80px] flex-shrink-0"
          value={effective}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} colour`}
        />
        {value && (
          <button
            type="button"
            className="btn btn-ghost text-xs"
            onClick={() => onChange(null)}
            title="Reset to default"
          >
            Reset
          </button>
        )}
      </div>
    </div>
  );
}

// ------------------------- v4.7: Local Devices card -------------------------
// Parent-only CRUD for named "kiosk" logins bound to a user. Mobile users keep
// their email login; local screens get a device row with its own password and
// a per-device useScreensaver flag.

type DeviceRow = {
  id: string;
  name: string;
  location: string;
  useScreensaver: boolean;
  screensaverIdleMinutes: number;
  sleepModeEnabled: boolean;
  sleepStartTime: string;
  sleepEndTime: string;
  sleepIdleMinutes: number;
  // v4.8.2 — per-kiosk module hide list (additive on top of the app-wide
  // disabledModules in AppSettings).
  hiddenModules: string[];
  // v4.9.5 — voice readout. Defaults applied server-side so missing fields
  // (older snapshots in flight) read as "off, default voice, 1.0x".
  voiceReadoutEnabled?: boolean;
  voiceName?: string | null;
  voiceRate?: number;
  actAsUserId: string;
  actAsUser: { id: string; name: string; email: string } | null;
};

type DeviceUser = {
  id: string;
  name: string;
  email: string;
  role: "PARENT" | "CHILD";
};

type DraftDevice = {
  id: string | null; // null = creating a new device
  name: string;
  location: string;
  password: string; // empty on edit = don't change
  useScreensaver: boolean;
  screensaverIdleMinutes: number;
  sleepModeEnabled: boolean;
  sleepStartTime: string;
  sleepEndTime: string;
  sleepIdleMinutes: number;
  // v4.8.2 — per-kiosk module hide list. Empty on new devices.
  hiddenModules: string[];
  // v4.9.5 — voice readout state. The parent can toggle on/off + tune the
  // rate from here; the voice-name picker lives on the kiosk itself.
  voiceReadoutEnabled: boolean;
  voiceName: string | null;
  voiceRate: number;
  actAsUserId: string;
};

const EMPTY_DRAFT: DraftDevice = {
  id: null,
  name: "",
  location: "",
  password: "",
  useScreensaver: true,
  screensaverIdleMinutes: 5,
  sleepModeEnabled: false,
  sleepStartTime: "22:00",
  sleepEndTime: "07:00",
  sleepIdleMinutes: 5,
  hiddenModules: [],
  voiceReadoutEnabled: false,
  voiceName: null,
  voiceRate: 1,
  actAsUserId: "",
};

// v4.8.2 — module hide sub-card embedded in the device edit dialog. Pulled
// out as its own component so the LocalDevicesCard JSX stays scannable.
// Globally-disabled modules are not shown at all (they're already off
// everywhere — listing them with a disabled checkbox just adds noise).
function ModuleHideSubcard({
  hiddenModules,
  globalDisabled,
  onChange,
}: {
  hiddenModules: string[];
  globalDisabled: string[];
  onChange: (next: string[]) => void;
}) {
  const globallyOff = new Set(globalDisabled);
  const kioskHideable = MOD_DEFS.filter(
    (m) => m.kioskHideable && !globallyOff.has(m.id),
  );
  const hiddenSet = new Set(hiddenModules);

  if (kioskHideable.length === 0) {
    return null;
  }

  function toggle(id: string, checked: boolean) {
    const next = new Set(hiddenSet);
    if (checked) next.add(id);
    else next.delete(id);
    onChange(Array.from(next));
  }

  return (
    <div className="sm:col-span-2 rounded-xl border border-[rgb(var(--border))] p-3 space-y-2">
      <div>
        <div className="text-sm font-semibold">Hide modules on this kiosk</div>
        <div className="text-xs muted mt-0.5">
          Tick a module to remove it from this kiosk only. Useful for
          locking down a shared screen — tick <strong>Settings</strong>{" "}
          so anyone walking up can&apos;t reconfigure the family, or hide
          modules a kiosk in a kid&apos;s room doesn&apos;t need.
        </div>
      </div>
      <div className="grid sm:grid-cols-2 gap-1.5">
        {kioskHideable.map((m) => (
          <label
            key={m.id}
            className="flex items-center gap-2 text-sm rounded-lg px-2 py-1.5 cursor-pointer hover:bg-[rgb(var(--surface-2))]"
            title={`Hide ${m.label} from this kiosk only.`}
          >
            <input
              type="checkbox"
              checked={hiddenSet.has(m.id)}
              onChange={(e) => toggle(m.id, e.target.checked)}
            />
            <span>Hide {m.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

// v4.9.5 — voice-readout sub-card inside the device edit dialog.
//
// The parent can flip readout on/off and tune the speaking rate from
// here — but the voice picker has to be on the actual kiosk because
// available voices are browser-specific. So we surface the current voice
// name read-only with a deep link to /voice-settings on the kiosk.
function VoiceReadoutSubcard({
  enabled,
  voiceName,
  rate,
  isExistingDevice,
  onChange,
}: {
  enabled: boolean;
  voiceName: string | null;
  rate: number;
  isExistingDevice: boolean;
  onChange: (patch: {
    voiceReadoutEnabled?: boolean;
    voiceName?: string | null;
    voiceRate?: number;
  }) => void;
}) {
  return (
    <div className="sm:col-span-2 rounded-xl border border-[rgb(var(--border))] p-3 space-y-3">
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          className="mt-1"
          checked={enabled}
          onChange={(e) =>
            onChange({ voiceReadoutEnabled: e.target.checked })
          }
        />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">
            Read reminders aloud on this kiosk
          </div>
          <div className="text-xs muted mt-0.5">
            When enabled, reminders are spoken via the kiosk&apos;s
            browser. Silenced during the night-sleep window above.
          </div>
        </div>
      </label>

      <div>
        <label className="text-sm font-medium">Speaking rate</label>
        <div className="flex items-center gap-3 mt-1">
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.05}
            value={rate}
            disabled={!enabled}
            onChange={(e) =>
              onChange({ voiceRate: Number(e.target.value) })
            }
            className="flex-1"
          />
          <span className="tabular-nums text-sm w-12 text-right">
            {rate.toFixed(2)}×
          </span>
        </div>
      </div>

      <div className="text-xs muted">
        Voice:{" "}
        <span className="font-medium">
          {voiceName ? voiceName : "(system default)"}
        </span>
        {isExistingDevice && (
          <>
            {" — "}
            {/* The voice list is browser-specific. The kiosk-side picker
                at /voice-settings shows what's actually installed on the
                target browser; we can't enumerate it from a parent's
                phone. */}
            <span>
              walk up to the kiosk and open <code>/voice-settings</code> on
              that browser to pick from its installed voices.
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function LocalDevicesCard({
  settings,
  update,
  onMessage,
  onError,
}: {
  settings: Settings;
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  onMessage: (m: string | null) => void;
  onError: (m: string | null) => void;
}) {
  const [devices, setDevices] = useState<DeviceRow[] | null>(null);
  const [users, setUsers] = useState<DeviceUser[]>([]);
  const [draft, setDraft] = useState<DraftDevice | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    try {
      const [dRes, uRes] = await Promise.all([
        fetch("/api/devices").then((r) => r.json()),
        fetch("/api/users").then((r) => r.json()),
      ]);
      setDevices(dRes.devices ?? []);
      setUsers(
        (uRes.users ?? []).map((u: DeviceUser) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
        })),
      );
    } catch {
      setDevices([]);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  function startCreate() {
    onMessage(null);
    onError(null);
    setDraft({
      ...EMPTY_DRAFT,
      actAsUserId: users[0]?.id ?? "",
    });
  }

  function startEdit(d: DeviceRow) {
    onMessage(null);
    onError(null);
    setDraft({
      id: d.id,
      name: d.name,
      location: d.location,
      password: "",
      useScreensaver: d.useScreensaver,
      screensaverIdleMinutes: d.screensaverIdleMinutes,
      sleepModeEnabled: d.sleepModeEnabled,
      sleepStartTime: d.sleepStartTime,
      sleepEndTime: d.sleepEndTime,
      sleepIdleMinutes: d.sleepIdleMinutes,
      hiddenModules: Array.isArray(d.hiddenModules) ? [...d.hiddenModules] : [],
      voiceReadoutEnabled: d.voiceReadoutEnabled ?? false,
      voiceName: d.voiceName ?? null,
      voiceRate: typeof d.voiceRate === "number" ? d.voiceRate : 1,
      actAsUserId: d.actAsUserId,
    });
  }

  async function submitDraft() {
    if (!draft) return;
    onMessage(null);
    onError(null);

    if (!draft.name.trim() || !draft.location.trim() || !draft.actAsUserId) {
      onError("Device name, location and user are required.");
      return;
    }
    if (!draft.id && draft.password.length < 4) {
      onError("Choose a device password (minimum 4 characters).");
      return;
    }

    setBusy(true);
    try {
      const url = draft.id ? `/api/devices/${draft.id}` : "/api/devices";
      const method = draft.id ? "PATCH" : "POST";
      const body: Record<string, unknown> = {
        name: draft.name.trim(),
        location: draft.location.trim(),
        useScreensaver: draft.useScreensaver,
        screensaverIdleMinutes: draft.screensaverIdleMinutes,
        sleepModeEnabled: draft.sleepModeEnabled,
        sleepStartTime: draft.sleepStartTime,
        sleepEndTime: draft.sleepEndTime,
        sleepIdleMinutes: draft.sleepIdleMinutes,
        // v4.8.2 — per-kiosk module hide list. Server filters this against
        // the catalogue (unknown IDs and pinned modules are dropped).
        hiddenModules: draft.hiddenModules,
        // v4.9.5 — voice readout (parent edits on/off + rate; voice name
        // is picked on the kiosk via /voice-settings).
        voiceReadoutEnabled: draft.voiceReadoutEnabled,
        voiceName: draft.voiceName,
        voiceRate: draft.voiceRate,
        actAsUserId: draft.actAsUserId,
      };
      // Only send password when it's been (re)set.
      if (draft.password) body.password = draft.password;

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        onError(data.error || "Could not save device");
        return;
      }
      await reload();
      setDraft(null);
      onMessage(draft.id ? "Device updated." : "Device added.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteDevice(d: DeviceRow) {
    if (
      !confirm(
        `Delete "${d.name}"? Anyone signed in on that device will be logged out immediately.`,
      )
    )
      return;
    onMessage(null);
    onError(null);
    const res = await fetch(`/api/devices/${d.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      onError(data.error || "Could not delete device");
      return;
    }
    await reload();
    onMessage(`Deleted “${d.name}”.`);
  }

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <MonitorSmartphone size={18} />
        <h2 className="font-bold text-lg">Local Devices</h2>
      </div>
      <p className="text-sm muted">
        Named kiosk logins (living room, kitchen, etc.) that can only sign in
        on the home network. Each device has its own password and can opt in
        or out of the photo screensaver. Email users keep signing in from
        anywhere.
      </p>

      {/* v4.7.2 — slideshow defaults, used by every kiosk that has
          "Use screensaver on this device" ticked. Moved here from a
          separate Screensaver card because these knobs only ever affect
          local devices. Per-device idle timer + Night Sleep live in the
          row's Edit panel below. */}
      <div className="rounded-xl border border-[rgb(var(--border))] p-3 space-y-3 bg-black/[0.02] dark:bg-white/[0.03]">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Image size={14} />
          Slideshow defaults (all kiosks)
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="text-xs font-medium muted block">
              Slide duration (seconds)
            </label>
            <input
              type="number"
              min={1}
              max={600}
              className="input mt-1 w-32"
              value={Math.round(settings.screensaverIntervalMs / 1000)}
              onChange={(e) =>
                update(
                  "screensaverIntervalMs",
                  Math.max(1, Number(e.target.value) || 6) * 1000,
                )
              }
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.screensaverShuffle}
              onChange={(e) => update("screensaverShuffle", e.target.checked)}
            />
            <Shuffle size={14} /> Shuffle photos each time
          </label>
        </div>
        <p className="text-xs muted">
          Any key, tap or click exits the slideshow. Idle launch timer and
          Night Sleep hours are configured per device below.
        </p>
      </div>

      {devices === null ? (
        <p className="text-sm muted">Loading devices…</p>
      ) : devices.length === 0 ? (
        <p className="text-sm muted italic">No devices yet.</p>
      ) : (
        <ul className="divide-y divide-[rgb(var(--border))] rounded-xl border border-[rgb(var(--border))]">
          {devices.map((d) => (
            <li
              key={d.id}
              className="flex items-center gap-3 px-3 py-2 flex-wrap"
            >
              <div className="flex-1 min-w-0">
                <div className="font-semibold truncate">{d.name}</div>
                <div className="text-xs muted truncate">
                  <MapPin size={12} className="inline -mt-0.5 mr-1" />
                  {d.location}
                  {d.actAsUser && (
                    <>
                      {" · acts as "}
                      <span className="font-medium">{d.actAsUser.name}</span>
                    </>
                  )}
                </div>
              </div>
              <span
                className={
                  "text-xs px-2 py-0.5 rounded-full " +
                  (d.useScreensaver
                    ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300"
                    : "bg-[rgb(var(--surface-2))] muted")
                }
                title={
                  d.useScreensaver
                    ? "Screensaver enabled on this device"
                    : "Screensaver disabled on this device"
                }
              >
                {d.useScreensaver ? "Screensaver on" : "Screensaver off"}
              </span>
              <button
                type="button"
                onClick={() => startEdit(d)}
                className="btn btn-ghost text-xs"
                aria-label={`Edit ${d.name}`}
              >
                <Pencil size={14} /> Edit
              </button>
              <button
                type="button"
                onClick={() => deleteDevice(d)}
                className="btn btn-ghost text-xs text-red-600 dark:text-red-400"
                aria-label={`Delete ${d.name}`}
              >
                <Trash2 size={14} /> Delete
              </button>
            </li>
          ))}
        </ul>
      )}

      {draft ? (
        <div className="rounded-xl border border-[rgb(var(--border))] p-3 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">
              {draft.id ? "Edit device" : "New device"}
            </h3>
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="btn btn-ghost"
              aria-label="Cancel"
            >
              <X size={16} />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-sm">
              <span className="block font-medium mb-1">Device name</span>
              <input
                className="input"
                value={draft.name}
                onChange={(e) =>
                  setDraft((d) => d && { ...d, name: e.target.value })
                }
                placeholder="Living Room"
                maxLength={100}
              />
            </label>
            <label className="text-sm">
              <span className="block font-medium mb-1">Location</span>
              <input
                className="input"
                value={draft.location}
                onChange={(e) =>
                  setDraft((d) => d && { ...d, location: e.target.value })
                }
                placeholder="Living Room"
                maxLength={120}
              />
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="block font-medium mb-1 flex items-center gap-1">
                <Lock size={13} />
                Password{" "}
                {draft.id && (
                  <span className="muted text-xs font-normal">
                    (leave blank to keep current)
                  </span>
                )}
              </span>
              <input
                className="input"
                type="password"
                value={draft.password}
                onChange={(e) =>
                  setDraft((d) => d && { ...d, password: e.target.value })
                }
                placeholder="••••••"
                autoComplete="new-password"
              />
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="block font-medium mb-1">
                Signs in as
              </span>
              <select
                className="select"
                value={draft.actAsUserId}
                onChange={(e) =>
                  setDraft((d) => d && { ...d, actAsUserId: e.target.value })
                }
              >
                {users.length === 0 && (
                  <option value="">No users available</option>
                )}
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} · {u.role.toLowerCase()}
                  </option>
                ))}
              </select>
              <span className="block text-xs muted mt-1">
                The device inherits this user&apos;s role and permissions while
                signed in.
              </span>
            </label>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                checked={draft.useScreensaver}
                onChange={(e) =>
                  setDraft(
                    (d) => d && { ...d, useScreensaver: e.target.checked },
                  )
                }
              />
              Use screensaver on this device
            </label>

            <label className="text-sm sm:col-span-2">
              <span className="block font-medium mb-1 flex items-center gap-1">
                <Image size={13} />
                Auto-screensaver after idle (minutes)
              </span>
              <input
                type="number"
                min={0}
                max={240}
                className="input w-40"
                disabled={!draft.useScreensaver}
                value={draft.screensaverIdleMinutes}
                onChange={(e) =>
                  setDraft(
                    (d) =>
                      d && {
                        ...d,
                        screensaverIdleMinutes: Math.max(
                          0,
                          Math.min(240, Number(e.target.value) || 0),
                        ),
                      },
                  )
                }
              />
              <span className="block text-xs muted mt-1">
                0 disables auto-launch. Tap, click or press a key to exit once
                the slideshow is running.
              </span>
            </label>

            {/* Per-device sleep mode — was formerly a global "Night Sleep
                Mode" section in AppSettings. Lives here now so each kiosk
                can dim on its own schedule. */}
            <div className="sm:col-span-2 rounded-xl border border-[rgb(var(--border))] p-3 space-y-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <Moon size={14} />
                <input
                  type="checkbox"
                  checked={draft.sleepModeEnabled}
                  onChange={(e) =>
                    setDraft(
                      (d) => d && { ...d, sleepModeEnabled: e.target.checked },
                    )
                  }
                />
                Night sleep mode on this device
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm">
                  <span className="block font-medium mb-1">Sleep from</span>
                  <select
                    className="select"
                    disabled={!draft.sleepModeEnabled}
                    value={draft.sleepStartTime}
                    onChange={(e) =>
                      setDraft(
                        (d) => d && { ...d, sleepStartTime: e.target.value },
                      )
                    }
                  >
                    {HALF_HOURS.map((t) => (
                      <option key={t} value={t}>
                        {formatTimeLabel(t)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="block font-medium mb-1">Wake at</span>
                  <select
                    className="select"
                    disabled={!draft.sleepModeEnabled}
                    value={draft.sleepEndTime}
                    onChange={(e) =>
                      setDraft(
                        (d) => d && { ...d, sleepEndTime: e.target.value },
                      )
                    }
                  >
                    {HALF_HOURS.map((t) => (
                      <option key={t} value={t}>
                        {formatTimeLabel(t)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="text-sm block">
                <span className="block font-medium mb-1">
                  Re-sleep after (minutes of no activity)
                </span>
                <input
                  type="number"
                  min={1}
                  max={240}
                  className="input w-32"
                  disabled={!draft.sleepModeEnabled}
                  value={draft.sleepIdleMinutes}
                  onChange={(e) =>
                    setDraft(
                      (d) =>
                        d && {
                          ...d,
                          sleepIdleMinutes: Math.max(
                            1,
                            Math.min(240, Number(e.target.value) || 5),
                          ),
                        },
                    )
                  }
                />
              </label>
            </div>

            {/* v4.8.2 — per-kiosk module hide list. Lives inside the device
                row instead of the standalone Module Visibility card because
                it's clearly a per-device setting and was confusing as a
                top-level page. Globally-disabled modules don't appear here
                — they're already off everywhere. */}
            <ModuleHideSubcard
              hiddenModules={draft.hiddenModules}
              globalDisabled={settings.disabledModules ?? []}
              onChange={(next) =>
                setDraft((d) => d && { ...d, hiddenModules: next })
              }
            />

            {/* v4.9.5 — voice readout. On/off + rate live here so a parent
                can tune them from their phone; the actual voice picker is
                kiosk-only (only that browser knows what voices it has) and
                accessible via /voice-settings while signed in as the
                device. */}
            <VoiceReadoutSubcard
              enabled={draft.voiceReadoutEnabled}
              voiceName={draft.voiceName}
              rate={draft.voiceRate}
              isExistingDevice={draft.id !== null}
              onChange={(patch) =>
                setDraft((d) => d && { ...d, ...patch })
              }
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={submitDraft}
              disabled={busy}
              className="btn btn-primary"
            >
              <Save size={14} />
              {busy ? "Saving…" : draft.id ? "Save changes" : "Add device"}
            </button>
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="btn btn-ghost"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={startCreate}
          className="btn btn-secondary"
        >
          <Plus size={14} /> Add device
        </button>
      )}
    </div>
  );
}

// =============================================================================
// System card — in-app "Check for updates" / "Update now" (parents only)
// =============================================================================
// Talks to /api/system/* which in turn talks to the systemd path units on the
// LXC host (see Family-Hub-LXC/state-helper.sh). The app itself never shells
// out; we just touch trigger files and poll JSON status files.

type VersionInfo = {
  branch: string;
  localSha: string;
  localShaShort: string;
  remoteSha: string;
  remoteShaShort: string;
  version: string;
  updateAvailable: boolean;
  commitsBehind: number;
  checkedAt: string;
  error: string | null;
};

type UpdateStatus = {
  state: "running" | "success" | "failed";
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
};

function SystemCard() {
  const [updaterAvailable, setUpdaterAvailable] = useState<boolean | null>(null);
  const [version, setVersion] = useState<VersionInfo | null>(null);
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initial load of both version + status
  useEffect(() => {
    (async () => {
      await refreshAll();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshAll() {
    try {
      const [vRes, sRes] = await Promise.all([
        fetch("/api/system/version", { cache: "no-store" }),
        fetch("/api/system/update/status", { cache: "no-store" }),
      ]);
      if (vRes.ok) {
        const data = await vRes.json();
        setUpdaterAvailable(Boolean(data.updaterAvailable));
        setVersion(data.version ?? null);
      }
      if (sRes.ok) {
        const data = await sRes.json();
        setStatus(data.status ?? null);
        // If we reload the page while an update is still running, resume
        // polling so the UI doesn't look frozen.
        if (data.status?.state === "running") setUpdating(true);
      }
    } catch (e) {
      // Network issues shouldn't crash the settings page.
      // eslint-disable-next-line no-console
      console.warn("[SystemCard] refresh failed", e);
    }
  }

  async function checkNow() {
    setError(null);
    setChecking(true);
    try {
      const res = await fetch("/api/system/check", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `Check failed (${res.status}).`);
      }
      // The systemd unit writes version.json asynchronously — poll for up to
      // 30 s waiting for checkedAt to advance past what we had before.
      const previousAt = version?.checkedAt ?? "";
      for (let i = 0; i < 15; i++) {
        await sleep(2000);
        const r = await fetch("/api/system/version", { cache: "no-store" });
        if (r.ok) {
          const data = await r.json();
          const newVersion: VersionInfo | null = data.version ?? null;
          if (newVersion && newVersion.checkedAt !== previousAt) {
            setVersion(newVersion);
            return;
          }
        }
      }
      // Timed out waiting — probably GitHub is slow, but show what we have.
      setError("Check is taking longer than expected. Refresh in a moment to see the result.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check failed.");
    } finally {
      setChecking(false);
    }
  }

  async function doUpdate() {
    setError(null);
    setConfirming(false);
    setUpdating(true);
    setStatus({ state: "running", startedAt: new Date().toISOString(), finishedAt: null, error: null });
    try {
      const res = await fetch("/api/system/update", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `Update failed to start (${res.status}).`);
      }
      // Poll every 3 s for up to 20 minutes. A rebuild typically takes 3-5 min
      // on a low-end CT; the systemd service has a 15-min TimeoutStartSec, so
      // this is intentionally a bit longer.
      for (let i = 0; i < 400; i++) {
        await sleep(3000);
        const r = await fetch("/api/system/update/status", { cache: "no-store" });
        if (!r.ok) continue;
        const data = await r.json();
        const s: UpdateStatus | null = data.status ?? null;
        if (!s) continue;
        setStatus(s);
        if (s.state === "success" || s.state === "failed") {
          // Refresh version info so the new SHA shows up.
          fetch("/api/system/version", { cache: "no-store" })
            .then((r2) => (r2.ok ? r2.json() : null))
            .then((d) => d && setVersion(d.version ?? null))
            .catch(() => {});
          return;
        }
      }
      setError("Update is taking longer than expected. Check the LXC logs (journalctl -u family-hub-update).");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed.");
    } finally {
      setUpdating(false);
    }
  }

  // --- Rendering -------------------------------------------------------------
  // When the state dir isn't mounted (bare docker-compose / `npm run dev`),
  // show a short explanation instead of dead buttons.
  if (updaterAvailable === null) {
    return (
      <div className="card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Package size={18} />
          <h2 className="font-bold text-lg">System</h2>
        </div>
        <p className="text-sm muted">Loading…</p>
      </div>
    );
  }

  if (!updaterAvailable) {
    return (
      <div className="card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Package size={18} />
          <h2 className="font-bold text-lg">System</h2>
        </div>
        <p className="text-sm muted">
          In-app updates are only available on installs that use the{" "}
          <code>Family-Hub-LXC</code> installer. You can still update this
          install by running <code>update</code> as root inside the LXC, or{" "}
          <code>git pull &amp;&amp; docker compose up -d --build</code> on a
          standalone Docker host.
        </p>
      </div>
    );
  }

  const updateState = updating ? status?.state ?? "running" : null;

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Package size={18} />
        <h2 className="font-bold text-lg">System</h2>
      </div>

      {/* Current version / branch / SHA ------------------------------------ */}
      <div className="text-sm space-y-1">
        <div>
          <span className="muted">Installed:</span>{" "}
          <span className="font-medium">
            {version?.version ? `v${version.version}` : "unknown"}
          </span>
          {version?.localShaShort && (
            <span className="muted ml-2">
              ({version.branch} · {version.localShaShort})
            </span>
          )}
        </div>
        <div className="muted text-xs">
          Last checked:{" "}
          {version?.checkedAt
            ? new Date(version.checkedAt).toLocaleString()
            : "never"}
        </div>
        {version?.error && (
          <div className="text-xs text-red-600 dark:text-red-400 flex items-start gap-1">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
            <span>Last check failed: {version.error}</span>
          </div>
        )}
      </div>

      {/* Update-available badge -------------------------------------------- */}
      {version?.updateAvailable && !updating && (
        <div className="text-sm rounded-xl px-3 py-2 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-200">
          <div className="font-medium">
            Update available — {version.commitsBehind} commit
            {version.commitsBehind === 1 ? "" : "s"} behind{" "}
            {version.branch}.
          </div>
          {version.remoteShaShort && (
            <div className="text-xs mt-0.5 opacity-80">
              Latest: {version.remoteShaShort}
            </div>
          )}
        </div>
      )}

      {/* Up-to-date indicator ---------------------------------------------- */}
      {version &&
        !version.error &&
        !version.updateAvailable &&
        !updating &&
        status?.state !== "success" &&
        status?.state !== "failed" && (
          <div className="text-sm rounded-xl px-3 py-2 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-emerald-900 dark:text-emerald-200 flex items-center gap-2">
            <CheckCircle2 size={14} className="shrink-0" />
            <span className="font-medium">
              You&apos;re on the latest version.
            </span>
          </div>
        )}

      {/* Live update state ------------------------------------------------- */}
      {updating && updateState === "running" && (
        <div className="text-sm rounded-xl px-3 py-2 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 text-blue-900 dark:text-blue-200 flex items-center gap-2">
          <RefreshCw size={14} className="animate-spin" />
          <span>Updating… this can take several minutes.</span>
        </div>
      )}
      {!updating && status?.state === "success" && (
        <div className="text-sm rounded-xl px-3 py-2 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-emerald-900 dark:text-emerald-200 flex items-start gap-2">
          <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">Update successful.</div>
            <div className="text-xs opacity-80">
              Reload the page to see the new version.
            </div>
          </div>
        </div>
      )}
      {!updating && status?.state === "failed" && (
        <div className="text-sm rounded-xl px-3 py-2 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-900 dark:text-red-200 flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">Update failed.</div>
            {status.error && (
              <div className="text-xs opacity-80 break-all mt-0.5">
                {status.error}
              </div>
            )}
            <div className="text-xs opacity-80 mt-1">
              Run <code>journalctl -u family-hub-update</code> on the LXC for
              the full log.
            </div>
          </div>
        </div>
      )}

      {/* Action buttons ---------------------------------------------------- */}
      {!confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={checkNow}
            disabled={checking || updating}
          >
            <RefreshCw size={14} className={checking ? "animate-spin" : undefined} />
            {checking ? "Checking…" : "Check for updates"}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setConfirming(true)}
            disabled={
              updating ||
              checking ||
              !version?.updateAvailable
            }
            title={
              !version?.updateAvailable
                ? "You're already on the latest commit."
                : undefined
            }
          >
            <Download size={14} />
            Update now
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-3 space-y-2">
          <p className="text-sm text-amber-900 dark:text-amber-200">
            This will pull the latest commit, rebuild the app, and restart it.
            Anyone using {APP_NAME} will be briefly disconnected while it
            restarts. Continue?
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-primary"
              onClick={doUpdate}
            >
              <Download size={14} /> Yes, update now
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-xl px-3 py-2">
          {error}
        </div>
      )}
    </div>
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ------------------------- v4.8.2: Module Visibility -------------------------
//
// Two-tier control over which features show up in the nav and which
// routes resolve at all. Tier 1 (master toggles) flips bits on
// AppSettings.disabledModules — turning Calendar OFF here removes it
// everywhere on every device. Tier 2 (per-kiosk hide list) sits inside
// LocalDevice.hiddenModules — these can only HIDE further, never
// re-enable something the global list has already taken away. The
// /settings module being kiosk-hideable is what underpins the lockdown
// story ("anyone who walks up to the kitchen kiosk can't reconfigure
// the family").

function ModuleVisibilityCard({
  settings,
  update,
}: {
  settings: Settings;
  // v4.8.2 — uses the same single-key update() shape the rest of the page
  // does. The card hands `disabledModules` a full array each time.
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  onMessage: (m: string | null) => void;
  onError: (e: string | null) => void;
}) {
  // v4.8.2 — global-only: every module that's globalHideable lives here as
  // a top-level toggle. The per-kiosk overrides live INSIDE the device row
  // in Local Devices below; that's the right place for them conceptually
  // (per-device config sits alongside per-device sleep schedule, screen-
  // saver, etc.) and keeps this card focused.
  const globalDisabled = new Set(settings.disabledModules ?? []);
  const globallyHideable = MOD_DEFS.filter((m) => m.globalHideable);

  function toggleGlobal(id: string, enable: boolean) {
    const next = new Set(globalDisabled);
    if (enable) next.delete(id);
    else next.add(id);
    // Bubble up through the same update() pipe the rest of the page uses;
    // it sets dirty=true and the "Save changes" button activates.
    update("disabledModules", Array.from(next));
  }

  return (
    <div className="card p-5 space-y-4">
      <div>
        <h2 className="font-bold text-lg">App Modules</h2>
        <p className="text-sm muted mt-1">
          Hide features your family doesn&apos;t use. Turning something off
          here removes it from the navigation everywhere and blocks
          direct-URL access. Home, Family and Settings are always available
          on email sessions so you don&apos;t lock yourself out of the app.
          To lock down a shared kiosk (so anyone walking up can&apos;t open
          the gear icon and reconfigure the family), use the per-device
          module list inside <strong>Local devices</strong> below.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-2">
        {globallyHideable.map((m) => {
          const enabled = !globalDisabled.has(m.id);
          return (
            <label
              key={m.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-[rgb(var(--border))] px-3 py-2.5 cursor-pointer hover:bg-[rgb(var(--surface-2))] transition-colors"
            >
              <span className="text-sm font-medium">{m.label}</span>
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => toggleGlobal(m.id, e.target.checked)}
              />
            </label>
          );
        })}
      </div>
    </div>
  );
}

// ------------------------- v4.7.9: Notifications -------------------------
//
// Per-user push enrolment management. Each browser/device the user has
// enrolled appears as a row, with controls to enable/disable on the
// CURRENT device, send a test push, or remove a remote enrolment.
//
// Settings is currently parent-only at the page level so children enrol
// via the top-of-app banner. This card is still the canonical place for
// the parent to inspect their own subscriptions and verify push works.

type PushDevice = {
  id: string;
  userAgent: string | null;
  createdAt: string;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
};

function urlBase64ToUint8(b64: string): Uint8Array {
  const padding = "=".repeat((4 - (b64.length % 4)) % 4);
  const norm = (b64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(norm);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function NotificationsCard() {
  const [devices, setDevices] = useState<PushDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | "test" | "enrol" | string>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [supported, setSupported] = useState<boolean>(false);
  const [enrolledHere, setEnrolledHere] = useState<boolean>(false);
  // v4.8.1 — parent's shadow-my-kid's-reminders toggle. Hydrated from
  // /api/auth/me on mount; flips PATCH the current user's permissions row.
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [notifyOnChildren, setNotifyOnChildren] = useState<boolean>(false);
  const [savingNotify, setSavingNotify] = useState(false);

  async function loadDevices() {
    setLoading(true);
    try {
      const r = await fetch("/api/push/devices");
      if (r.ok) {
        const j = await r.json();
        setDevices(j.devices || []);
      }
    } finally {
      setLoading(false);
    }
  }

  async function evaluateLocal() {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setSupported(false);
      return;
    }
    setSupported(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setEnrolledHere(Boolean(sub));
    } catch {
      setEnrolledHere(false);
    }
  }

  useEffect(() => {
    loadDevices();
    evaluateLocal();
    // v4.8.1 — pull the parent's own permission flag for the new shadow-
    // -reminders checkbox. Settings is parent-only (page-level redirect),
    // so we can assume role=PARENT here.
    (async () => {
      try {
        const r = await fetch("/api/auth/me");
        if (!r.ok) return;
        const j = await r.json();
        if (j?.user?.id) setMyUserId(j.user.id);
        if (j?.user?.permissions?.notifyOnChildEventReminders === true) {
          setNotifyOnChildren(true);
        }
      } catch {
        /* ignore — fall back to defaults */
      }
    })();
  }, []);

  async function toggleNotifyOnChildren(next: boolean) {
    if (!myUserId) return;
    setSavingNotify(true);
    // Optimistic: flip the UI immediately so the toggle feels snappy.
    setNotifyOnChildren(next);
    try {
      const r = await fetch(`/api/users/${myUserId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          permissions: { notifyOnChildEventReminders: next },
        }),
      });
      if (!r.ok) {
        // Roll back if the server refused.
        setNotifyOnChildren(!next);
        const j = await r.json().catch(() => ({}));
        setError(j.error || "Could not save preference");
      }
    } catch (e) {
      setNotifyOnChildren(!next);
      setError(e instanceof Error ? e.message : "Could not save preference");
    } finally {
      setSavingNotify(false);
    }
  }

  async function enrolThisDevice() {
    setBusy("enrol");
    setError(null);
    setMessage(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") throw new Error("Permission not granted");
      const keyRes = await fetch("/api/push/vapid-key");
      const { publicKey } = await keyRes.json();
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8(publicKey),
      });
      const json = sub.toJSON();
      const post = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: json.keys,
          userAgent: navigator.userAgent,
        }),
      });
      if (!post.ok) {
        const j = await post.json().catch(() => ({}));
        throw new Error(j.error || "Could not enrol");
      }
      setMessage("This device is now enrolled.");
      await evaluateLocal();
      await loadDevices();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not enrol");
    } finally {
      setBusy(null);
    }
  }

  async function unenrolThisDevice() {
    setBusy("enrol");
    setError(null);
    setMessage(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch(
          `/api/push/subscribe?endpoint=${encodeURIComponent(sub.endpoint)}`,
          { method: "DELETE" },
        );
        await sub.unsubscribe();
      }
      setMessage("Push disabled on this device.");
      await evaluateLocal();
      await loadDevices();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not unenrol");
    } finally {
      setBusy(null);
    }
  }

  async function removeRemote(id: string) {
    if (!confirm("Remove this device from your push enrolments?")) return;
    setBusy(id);
    try {
      await fetch(`/api/push/devices/${id}`, { method: "DELETE" });
      await loadDevices();
      await evaluateLocal();
    } finally {
      setBusy(null);
    }
  }

  async function sendTest() {
    setBusy("test");
    setError(null);
    setMessage(null);
    try {
      const r = await fetch("/api/push/test", { method: "POST" });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || "Test failed");
      }
      const j = await r.json();
      const d = j.result?.delivered ?? 0;
      setMessage(
        d === 0
          ? "No enrolled devices yet — enable push on a phone or laptop first."
          : `Test sent to ${d} device${d === 1 ? "" : "s"}.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Test failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Bell size={18} />
        <h2 className="font-bold text-lg">Notifications</h2>
      </div>

      <p className="text-sm muted">
        Push notifications fire even when Family Hub is closed or
        backgrounded — useful for reminders that you&apos;d otherwise miss.
        Each browser / device enrols separately.
      </p>

      {/* v4.8.1 — parent's shadow-my-kid's-event-reminders toggle. Sits
          alongside the per-device enrolment because it's the other half of
          the same routing decision. */}
      <label
        className="flex items-start gap-3 rounded-xl border border-[rgb(var(--border))] p-3 cursor-pointer hover:bg-[rgb(var(--surface-2))] transition-colors"
        title="When on, you get a copy of every event reminder that fires on any of your children."
      >
        <input
          type="checkbox"
          className="mt-1"
          checked={notifyOnChildren}
          disabled={!myUserId || savingNotify}
          onChange={(e) => toggleNotifyOnChildren(e.target.checked)}
        />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">
            Also notify me of my children&apos;s event reminders
          </div>
          <div className="text-xs muted">
            When a child has an event with a reminder, you&apos;ll get the
            same push at the same lead time. Per-child opt-outs live in
            Family settings.
          </div>
        </div>
      </label>

      {!supported && (
        <div className="text-sm rounded-xl px-3 py-2 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-200">
          This browser does not support Web Push. On iOS, install Family Hub
          to your home screen first (Share → Add to Home Screen) and re-open
          it from there.
        </div>
      )}

      {supported && (
        <div className="flex gap-2 flex-wrap">
          {enrolledHere ? (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={unenrolThisDevice}
              disabled={busy !== null}
            >
              {busy === "enrol" ? "Working…" : "Disable on this device"}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={enrolThisDevice}
              disabled={busy !== null}
            >
              <Bell size={14} />
              {busy === "enrol" ? "Enabling…" : "Enable on this device"}
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={sendTest}
            disabled={busy !== null}
          >
            {busy === "test" ? "Sending…" : "Send test push"}
          </button>
        </div>
      )}

      <div>
        <div className="text-sm font-medium mb-2">Your enrolled devices</div>
        {loading ? (
          <p className="text-xs muted">Loading…</p>
        ) : devices.length === 0 ? (
          <p className="text-xs muted">No devices enrolled yet.</p>
        ) : (
          <ul className="space-y-2">
            {devices.map((d) => (
              <li
                key={d.id}
                className="text-sm border border-[rgb(var(--border))] rounded-xl p-2 flex items-start gap-2"
              >
                <Bell
                  size={14}
                  className="mt-1 text-violet-500 shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="truncate">
                    {d.userAgent || "Unknown device"}
                  </div>
                  <div className="text-xs muted">
                    Enrolled{" "}
                    {new Date(d.createdAt).toLocaleString(undefined, {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                    {d.lastSuccessAt && (
                      <>
                        {" · last delivered "}
                        {new Date(d.lastSuccessAt).toLocaleString()}
                      </>
                    )}
                    {d.lastError && (
                      <>
                        {" · "}
                        <span className="text-rose-600 dark:text-rose-300">
                          last error: {d.lastError}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm text-rose-600 dark:text-rose-300"
                  onClick={() => removeRemote(d.id)}
                  disabled={busy !== null}
                  aria-label="Remove device"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && (
        <div className="text-sm rounded-xl px-3 py-2 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-900 dark:text-rose-200">
          {error}
        </div>
      )}
      {message && (
        <div className="text-sm rounded-xl px-3 py-2 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-emerald-900 dark:text-emerald-200">
          {message}
        </div>
      )}
    </div>
  );
}

// ------------------------- v4.7.8: Backup & Export -------------------------
//
// Three actions in a single parent-only card:
//
//   1. Download backup       → GET  /api/admin/backup       (zip)
//   2. Restore from backup   → POST /api/admin/restore       (zip upload)
//   3. Download family PDF   → GET  /api/admin/family-pdf    (pdf)
//
// Restore is destructive: it wipes the database and re-seeds from the
// uploaded archive. The UI gates it behind two confirms and a typed
// "RESTORE" prompt so it can't be hit by accident. After a successful
// restore the page hard-reloads so every component re-fetches its data.

function BackupExportCard() {
  const [working, setWorking] = useState<null | "backup" | "restore" | "pdf">(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);

  async function downloadBackup() {
    setWorking("backup");
    setError(null);
    setMessage(null);
    try {
      // Issue a real navigation so the browser handles the download. We
      // use a hidden anchor click so we don't lose the SettingsView state.
      const res = await fetch("/api/admin/backup");
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Backup failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      a.download = `family-hub-backup-${stamp}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setMessage("Backup downloaded.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Backup failed");
    } finally {
      setWorking(null);
    }
  }

  async function downloadFamilyPdf() {
    setWorking("pdf");
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/family-pdf");
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "PDF export failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `family-hub-export-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setMessage("Family PDF downloaded.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF export failed");
    } finally {
      setWorking(null);
    }
  }

  async function performRestore(file: File) {
    setWorking("restore");
    setError(null);
    setMessage(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/admin/restore", {
        method: "POST",
        body: fd,
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(j.error || "Restore failed");
      }
      setMessage(
        `Restore complete — re-loading the app now to pick up the new data…`,
      );
      // Give the user a chance to read the message before the reload.
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Restore failed");
    } finally {
      setWorking(null);
    }
  }

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Archive size={18} />
        <h2 className="font-bold text-lg">Backup &amp; Export</h2>
      </div>

      <div className="text-sm space-y-3">
        <div>
          <div className="font-medium mb-1">Backup (.zip)</div>
          <p className="muted text-xs mb-2">
            Single archive containing every database row plus every uploaded
            photo, recipe image, receipt, reward image and maintenance
            document. Can be restored to a fresh install on a different host
            in case of disaster.
          </p>
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={downloadBackup}
              disabled={working !== null}
            >
              <Download size={14} />
              {working === "backup" ? "Building…" : "Download backup"}
            </button>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={() => setRestoreOpen(true)}
              disabled={working !== null}
              title="Wipe and replace from a backup zip"
            >
              <Upload size={14} /> Restore from backup…
            </button>
          </div>
        </div>

        <div className="border-t border-[rgb(var(--border))] pt-3">
          <div className="font-medium mb-1">Family PDF</div>
          <p className="muted text-xs mb-2">
            A printable take-it-with-you document of every family-facing
            thing in the app — calendar, birthdays, todos, shopping list,
            menu plan, recipes (with photos), photo grid, reminders,
            points ledger, redemption history, maintenance log, and tax
            records. App settings are not included.
          </p>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={downloadFamilyPdf}
            disabled={working !== null}
          >
            <FileText size={14} />
            {working === "pdf" ? "Building…" : "Download family PDF"}
          </button>
        </div>
      </div>

      {error && (
        <div className="text-sm rounded-xl px-3 py-2 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-900 dark:text-rose-200">
          {error}
        </div>
      )}
      {message && (
        <div className="text-sm rounded-xl px-3 py-2 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-emerald-900 dark:text-emerald-200">
          {message}
        </div>
      )}

      {restoreOpen && (
        <RestoreDialog
          onClose={() => setRestoreOpen(false)}
          onConfirm={(file) => {
            setRestoreOpen(false);
            performRestore(file);
          }}
        />
      )}
    </div>
  );
}

function RestoreDialog({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: (file: File) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [confirmWord, setConfirmWord] = useState("");

  return (
    <div className="fixed inset-0 z-40 bg-black/50 overflow-y-auto">
      <div className="flex min-h-full items-start sm:items-center justify-center p-3 sm:p-4">
        <div className="card w-full max-w-md p-4 sm:p-5 relative my-4 sm:my-8">
          <button
            onClick={onClose}
            className="absolute right-3 top-3 btn btn-ghost"
            aria-label="Close"
          >
            <X size={18} />
          </button>
          <h3 className="text-lg font-bold mb-2 pr-10">Restore from backup</h3>

          <div className="text-sm rounded-xl px-3 py-2 mb-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-900 dark:text-rose-200">
            <div className="font-bold mb-1">Destructive action</div>
            This will <span className="font-semibold">delete every family
            row and uploaded file</span> currently in this Family Hub
            instance and replace them with the contents of the chosen
            backup. App settings will be replaced too. Sessions will be
            invalidated — everyone will need to sign in again.
          </div>

          {step === 1 && (
            <>
              <label className="text-sm font-medium">
                Choose a Family Hub backup zip
              </label>
              <input
                type="file"
                accept="application/zip,.zip"
                className="input mt-1"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <div className="flex justify-end gap-2 mt-4">
                <button className="btn btn-secondary" onClick={onClose}>
                  Cancel
                </button>
                <button
                  className="btn btn-danger"
                  onClick={() => setStep(2)}
                  disabled={!file}
                >
                  Continue…
                </button>
              </div>
            </>
          )}

          {step === 2 && file && (
            <>
              <p className="text-sm mb-2">
                You're about to restore from{" "}
                <span className="font-semibold">{file.name}</span>{" "}
                ({Math.round(file.size / 1024 / 1024).toLocaleString()} MB).
                Type <span className="font-mono font-bold">RESTORE</span> below
                to confirm.
              </p>
              <input
                className="input"
                value={confirmWord}
                onChange={(e) => setConfirmWord(e.target.value)}
                placeholder="Type RESTORE"
                autoFocus
              />
              <div className="flex justify-between gap-2 mt-4">
                <button className="btn btn-secondary" onClick={() => setStep(1)}>
                  Back
                </button>
                <button
                  className="btn btn-danger"
                  disabled={confirmWord !== "RESTORE"}
                  onClick={() => onConfirm(file)}
                >
                  Wipe and restore
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ------------------------- v4.9.0: Integrations -------------------------
//
// Parent-only card with two stacked sub-sections:
//   • API tokens — bearer tokens for the read-only /api/v1/* surface
//   • Webhooks   — outbound subscriptions for the event bus
//
// Both follow the same one-shot reveal pattern as GitHub PATs: the secret
// (token string / webhook signing secret) is shown EXACTLY ONCE at create
// time, then only the leading prefix is ever returned by subsequent reads.
// The UI keeps the freshly-revealed secret in component state until the
// user dismisses the reveal banner, then it's gone forever.

const SCOPE_LABELS: Record<string, string> = {
  "events:read": "Read calendar events",
  "todos:read": "Read to-dos",
  "shopping:read": "Read the shopping list",
  "reminders:read": "Read reminders",
  "*": "Full read access (any scope)",
};
const SCOPE_ORDER = [
  "events:read",
  "todos:read",
  "shopping:read",
  "reminders:read",
  "*",
];

const EVENT_LABELS: Record<string, string> = {
  "reminder.fired": "Reminder fired",
  "todo.created": "To-do created",
  "todo.completed": "To-do completed",
  "event.created": "Calendar event created",
  "event.starting": "Calendar event starting now",
  "device.sleep_started": "Kiosk entered sleep window",
  "device.sleep_ended": "Kiosk left sleep window",
};
const EVENT_ORDER = [
  "reminder.fired",
  "todo.created",
  "todo.completed",
  "event.created",
  "event.starting",
  "device.sleep_started",
  "device.sleep_ended",
];

interface ApiTokenRow {
  id: string;
  name: string;
  token_prefix: string;
  scopes?: string[];
  enabled: boolean;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
}
interface WebhookRow {
  id: string;
  name: string;
  url: string;
  secret_prefix: string;
  events?: string[];
  enabled: boolean;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error: string | null;
  created_at: string;
}

function IntegrationsCard() {
  const [tokens, setTokens] = useState<ApiTokenRow[] | null>(null);
  const [webhooks, setWebhooks] = useState<WebhookRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Freshly-revealed secrets stay here until dismissed. Format-agnostic:
  // could be a token, a webhook secret, or a rotated secret. We never
  // persist this anywhere — losing the component (e.g. tab close) loses
  // the reveal, by design.
  const [reveal, setReveal] = useState<
    | null
    | { kind: "token" | "webhook" | "rotate"; label: string; secret: string }
  >(null);

  async function loadTokens() {
    try {
      const r = await fetch("/api/admin/api-tokens");
      if (!r.ok) return;
      const j = await r.json();
      setTokens(j.tokens || []);
    } catch {
      setTokens([]);
    }
  }
  async function loadWebhooks() {
    try {
      const r = await fetch("/api/admin/webhooks");
      if (!r.ok) return;
      const j = await r.json();
      setWebhooks(j.webhooks || []);
    } catch {
      setWebhooks([]);
    }
  }
  useEffect(() => {
    loadTokens();
    loadWebhooks();
  }, []);

  return (
    <div className="card p-5 space-y-5">
      <div>
        <h2 className="font-bold text-lg">Integrations</h2>
        <p className="text-sm muted mt-1">
          Connect Family Hub to Home Assistant, n8n, or your own scripts.
          The <strong>read-only REST API</strong> lives at <code>/api/v1/*</code>{" "}
          and is gated by bearer-token auth. <strong>Webhooks</strong> push
          events to a URL of your choice the moment they happen (reminder
          fired, to-do completed, event starting). See <code>docs/api.md</code>{" "}
          on GitHub for payload shapes and signature verification.
        </p>
      </div>

      {error && (
        <div className="text-sm rounded-xl px-3 py-2 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-900 dark:text-rose-200">
          {error}
        </div>
      )}

      {reveal && (
        <SecretRevealPanel
          kind={reveal.kind}
          label={reveal.label}
          secret={reveal.secret}
          onDismiss={() => setReveal(null)}
        />
      )}

      <ApiTokensSubcard
        tokens={tokens}
        onError={setError}
        onReveal={(label, secret) =>
          setReveal({ kind: "token", label, secret })
        }
        reload={loadTokens}
      />

      <WebhooksSubcard
        webhooks={webhooks}
        onError={setError}
        onReveal={(kind, label, secret) =>
          setReveal({ kind, label, secret })
        }
        reload={loadWebhooks}
      />
    </div>
  );
}

function SecretRevealPanel({
  kind,
  label,
  secret,
  onDismiss,
}: {
  kind: "token" | "webhook" | "rotate";
  label: string;
  secret: string;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — user can still triple-click the textarea */
    }
  }
  const heading =
    kind === "rotate"
      ? `Rotated signing secret for "${label}"`
      : kind === "webhook"
        ? `New webhook secret for "${label}"`
        : `New API token "${label}"`;
  return (
    <div className="rounded-xl px-3 py-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 space-y-2">
      <div className="text-sm font-semibold text-amber-900 dark:text-amber-100">
        {heading}
      </div>
      <p className="text-xs text-amber-900/80 dark:text-amber-100/80">
        Copy this now — it won&apos;t be shown again. Family Hub stores it
        for comparison only and there&apos;s no way to retrieve it later.
      </p>
      <textarea
        readOnly
        value={secret}
        className="input font-mono text-xs w-full"
        rows={2}
        onFocus={(e) => e.currentTarget.select()}
      />
      <div className="flex items-center gap-2">
        <button type="button" className="btn btn-primary btn-sm" onClick={copy}>
          {copied ? "Copied!" : "Copy"}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onDismiss}
        >
          I&apos;ve saved it
        </button>
      </div>
    </div>
  );
}

function ApiTokensSubcard({
  tokens,
  onError,
  onReveal,
  reload,
}: {
  tokens: ApiTokenRow[] | null;
  onError: (e: string | null) => void;
  onReveal: (label: string, secret: string) => void;
  reload: () => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [chosenScopes, setChosenScopes] = useState<string[]>(["*"]);
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    onError(null);
    if (!name.trim()) {
      onError("Token name is required.");
      return;
    }
    if (chosenScopes.length === 0) {
      onError("Pick at least one scope.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/api-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), scopes: chosenScopes }),
      });
      const j = await res.json();
      if (!res.ok) {
        onError(j.error || "Could not create token");
        return;
      }
      onReveal(j.name, j.token);
      setName("");
      setChosenScopes(["*"]);
      setCreating(false);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function revoke(t: ApiTokenRow) {
    if (!confirm(`Revoke token "${t.name}"? Any integration using it will break immediately.`)) return;
    await fetch(`/api/admin/api-tokens/${t.id}`, { method: "DELETE" });
    await reload();
  }

  async function toggle(t: ApiTokenRow) {
    await fetch(`/api/admin/api-tokens/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !t.enabled }),
    });
    await reload();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">API tokens</h3>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => setCreating((v) => !v)}
        >
          <Plus size={14} /> New token
        </button>
      </div>

      {creating && (
        <form
          onSubmit={create}
          className="rounded-xl border border-[rgb(var(--border))] p-3 space-y-3"
        >
          <label className="text-sm block">
            <span className="block font-medium mb-1">Label</span>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="HomeAssistant"
              maxLength={120}
              autoFocus
            />
          </label>
          <div>
            <div className="text-sm font-medium mb-1">Scopes</div>
            <div className="grid sm:grid-cols-2 gap-1.5">
              {SCOPE_ORDER.map((s) => {
                const checked = chosenScopes.includes(s);
                return (
                  <label
                    key={s}
                    className="flex items-center gap-2 text-sm rounded-lg px-2 py-1.5 cursor-pointer hover:bg-[rgb(var(--surface-2))]"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setChosenScopes((cur) =>
                            cur.includes(s) ? cur : [...cur, s],
                          );
                        } else {
                          setChosenScopes((cur) => cur.filter((x) => x !== s));
                        }
                      }}
                    />
                    <span>
                      <code className="text-xs">{s}</code>{" "}
                      <span className="muted">— {SCOPE_LABELS[s]}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Creating…" : "Create token"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setCreating(false)}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {tokens === null ? (
        <p className="text-sm muted">Loading…</p>
      ) : tokens.length === 0 ? (
        <p className="text-sm muted italic">
          No tokens yet. Create one to start using the REST API.
        </p>
      ) : (
        <ul className="divide-y divide-[rgb(var(--border))] rounded-xl border border-[rgb(var(--border))]">
          {tokens.map((t) => (
            <li
              key={t.id}
              className="flex items-start gap-3 px-3 py-2.5 flex-wrap"
            >
              <div className="flex-1 min-w-0">
                <div className="font-semibold truncate flex items-center gap-2">
                  {t.name}
                  {!t.enabled && (
                    <span className="text-xs px-1.5 py-0.5 rounded-full bg-[rgb(var(--surface-2))] muted">
                      disabled
                    </span>
                  )}
                </div>
                <div className="text-xs muted">
                  <code>{t.token_prefix}</code>
                  {t.scopes && t.scopes.length > 0 && (
                    <>
                      {" · "}
                      {t.scopes.join(", ")}
                    </>
                  )}
                  {t.last_used_at && (
                    <>
                      {" · last used "}
                      {new Date(t.last_used_at).toLocaleString()}
                    </>
                  )}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-ghost text-xs"
                onClick={() => toggle(t)}
              >
                {t.enabled ? "Disable" : "Enable"}
              </button>
              <button
                type="button"
                className="btn btn-ghost text-xs text-red-600 dark:text-red-400"
                onClick={() => revoke(t)}
              >
                <Trash2 size={14} /> Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function WebhooksSubcard({
  webhooks,
  onError,
  onReveal,
  reload,
}: {
  webhooks: WebhookRow[] | null;
  onError: (e: string | null) => void;
  onReveal: (
    kind: "webhook" | "rotate",
    label: string,
    secret: string,
  ) => void;
  reload: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<{
    id: string | null;
    name: string;
    url: string;
    events: string[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  function startCreate() {
    setDraft({ id: null, name: "", url: "", events: [] });
    onError(null);
    setTestResult(null);
  }
  function startEdit(w: WebhookRow) {
    setDraft({
      id: w.id,
      name: w.name,
      url: w.url,
      events: w.events ?? [],
    });
    onError(null);
    setTestResult(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    if (!draft.name.trim() || !draft.url.trim() || draft.events.length === 0) {
      onError("Name, URL, and at least one event are required.");
      return;
    }
    setBusy(true);
    try {
      const url = draft.id
        ? `/api/admin/webhooks/${draft.id}`
        : "/api/admin/webhooks";
      const method = draft.id ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name.trim(),
          url: draft.url.trim(),
          events: draft.events,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        onError(j.error || "Could not save webhook");
        return;
      }
      if (!draft.id && j.secret) {
        onReveal("webhook", j.name, j.secret);
      }
      setDraft(null);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function rotateSecret(w: WebhookRow) {
    if (
      !confirm(
        `Mint a new signing secret for "${w.name}"? You'll need to update HA / n8n with the new value immediately.`,
      )
    )
      return;
    const res = await fetch(`/api/admin/webhooks/${w.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rotate_secret: true }),
    });
    const j = await res.json();
    if (res.ok && j.secret) {
      onReveal("rotate", w.name, j.secret);
      await reload();
    }
  }

  async function remove(w: WebhookRow) {
    if (!confirm(`Delete webhook "${w.name}"?`)) return;
    await fetch(`/api/admin/webhooks/${w.id}`, { method: "DELETE" });
    await reload();
  }

  async function runTest(w: WebhookRow) {
    setTestingId(w.id);
    setTestResult(null);
    try {
      const res = await fetch(`/api/admin/webhooks/${w.id}/test`, {
        method: "POST",
      });
      const j = await res.json();
      if (j.ok) {
        setTestResult(`✓ Test reached "${w.name}" (HTTP ${j.status}).`);
      } else if (j.network_error) {
        setTestResult(`✗ Test to "${w.name}" failed: ${j.network_error}`);
      } else {
        setTestResult(
          `✗ "${w.name}" responded HTTP ${j.status ?? "unknown"}${j.response_snippet ? `: ${j.response_snippet}` : ""}`,
        );
      }
      await reload();
    } finally {
      setTestingId(null);
    }
  }

  return (
    <div className="space-y-3 border-t border-[rgb(var(--border))] pt-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Webhooks</h3>
        {!draft && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={startCreate}
          >
            <Plus size={14} /> New webhook
          </button>
        )}
      </div>

      {testResult && (
        <div
          className={`text-sm rounded-xl px-3 py-2 ${
            testResult.startsWith("✓")
              ? "bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-emerald-900 dark:text-emerald-200"
              : "bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-900 dark:text-rose-200"
          }`}
        >
          {testResult}
        </div>
      )}

      {draft && (
        <form
          onSubmit={submit}
          className="rounded-xl border border-[rgb(var(--border))] p-3 space-y-3"
        >
          <div className="text-sm font-semibold">
            {draft.id ? "Edit webhook" : "New webhook"}
          </div>
          <label className="text-sm block">
            <span className="block font-medium mb-1">Label</span>
            <input
              className="input"
              value={draft.name}
              onChange={(e) =>
                setDraft((d) => d && { ...d, name: e.target.value })
              }
              placeholder="Home Assistant"
              maxLength={120}
            />
          </label>
          <label className="text-sm block">
            <span className="block font-medium mb-1">URL</span>
            <input
              className="input"
              value={draft.url}
              onChange={(e) =>
                setDraft((d) => d && { ...d, url: e.target.value })
              }
              placeholder="https://homeassistant.local:8123/api/webhook/familyhub"
              maxLength={2000}
            />
          </label>
          <div>
            <div className="text-sm font-medium mb-1">Events</div>
            <div className="grid sm:grid-cols-2 gap-1.5">
              {EVENT_ORDER.map((ev) => {
                const checked = draft.events.includes(ev);
                return (
                  <label
                    key={ev}
                    className="flex items-center gap-2 text-sm rounded-lg px-2 py-1.5 cursor-pointer hover:bg-[rgb(var(--surface-2))]"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        setDraft((d) =>
                          d
                            ? {
                                ...d,
                                events: e.target.checked
                                  ? Array.from(new Set([...d.events, ev]))
                                  : d.events.filter((x) => x !== ev),
                              }
                            : d,
                        );
                      }}
                    />
                    <span>
                      <code className="text-xs">{ev}</code>{" "}
                      <span className="muted">— {EVENT_LABELS[ev]}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              <Save size={14} />
              {busy ? "Saving…" : draft.id ? "Save changes" : "Create webhook"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setDraft(null)}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {webhooks === null ? (
        <p className="text-sm muted">Loading…</p>
      ) : webhooks.length === 0 ? (
        <p className="text-sm muted italic">
          No webhooks yet. Create one to start pushing events to Home
          Assistant or any other system.
        </p>
      ) : (
        <ul className="divide-y divide-[rgb(var(--border))] rounded-xl border border-[rgb(var(--border))]">
          {webhooks.map((w) => {
            const ok = w.last_success_at && (!w.last_failure_at ||
              new Date(w.last_success_at) > new Date(w.last_failure_at));
            return (
              <li key={w.id} className="px-3 py-2.5">
                <div className="flex items-start gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold truncate flex items-center gap-2">
                      {w.name}
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                          ok
                            ? "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300"
                            : w.last_failure_at
                              ? "bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300"
                              : "bg-[rgb(var(--surface-2))] muted"
                        }`}
                      >
                        {ok ? "healthy" : w.last_failure_at ? "failing" : "untested"}
                      </span>
                    </div>
                    <div className="text-xs muted truncate font-mono">
                      {w.url}
                    </div>
                    <div className="text-xs muted mt-0.5">
                      {(w.events ?? []).join(", ")}
                    </div>
                    {w.last_error && (
                      <div className="text-xs text-rose-600 dark:text-rose-300 mt-0.5">
                        Last error: {w.last_error}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-wrap">
                    <button
                      type="button"
                      className="btn btn-ghost text-xs"
                      onClick={() => runTest(w)}
                      disabled={testingId === w.id}
                    >
                      {testingId === w.id ? "Testing…" : "Test"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost text-xs"
                      onClick={() => startEdit(w)}
                    >
                      <Pencil size={14} /> Edit
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost text-xs"
                      onClick={() => rotateSecret(w)}
                    >
                      Rotate secret
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost text-xs text-red-600 dark:text-red-400"
                      onClick={() => remove(w)}
                    >
                      <Trash2 size={14} /> Delete
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

