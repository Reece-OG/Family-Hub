"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Cake, Gift, Pencil, Plus, Trash2, X } from "lucide-react";
import { useAutoRefresh } from "@/lib/use-auto-refresh";

type UserRecord = {
  id: string;
  name: string;
  color: string;
  avatarEmoji: string;
  role: "PARENT" | "CHILD";
  dateOfBirth: string | null;
};

type Birthday = {
  id: string;
  name: string;
  dateOfBirth: string;
  yearKnown: boolean;
  notes: string | null;
  color: string | null;
  avatarEmoji: string;
  linkedEventId: string | null;
};

type Row = {
  kind: "user" | "manual";
  id: string;
  name: string;
  color: string;
  avatarEmoji: string;
  dob: Date;
  yearKnown: boolean;
  nextBirthday: Date;
  daysUntil: number;
  ageOnNext: number | null;
  currentAge: number | null;
  notes?: string | null;
  sourceId: string; // user.id or birthday.id
};

const DEFAULT_COLORS = [
  "#f43f5e",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

export function BirthdaysView({
  canManage,
  canEdit,
}: {
  canManage: boolean;
  canEdit: boolean;
}) {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [birthdays, setBirthdays] = useState<Birthday[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editing, setEditing] = useState<Birthday | null>(null);
  // v4.9.1 — name-substring filter, case-insensitive. Empty string shows
  // everything. No icon on the input (matches the catalog search style).
  const [query, setQuery] = useState("");

  // v4.7.17 — refresh is now a useCallback so useAutoRefresh can manage the
  // mount + tab-focus + polling lifecycle. A 5-min interval is plenty here.
  const refresh = useCallback(async () => {
    const [u, b] = await Promise.all([
      fetch("/api/users").then((r) => r.json()),
      fetch("/api/birthdays").then((r) => r.json()),
    ]);
    setUsers(u.users || []);
    setBirthdays(b.birthdays || []);
    setLoading(false);
  }, []);
  useAutoRefresh(refresh, { intervalMs: 5 * 60_000 });

  const rows = useMemo<Row[]>(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const out: Row[] = [];

    for (const u of users) {
      if (!u.dateOfBirth) continue;
      const dob = new Date(u.dateOfBirth);
      const nextBirthday = computeNextBirthday(dob, today);
      const daysUntil = Math.round(
        (nextBirthday.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
      );
      out.push({
        kind: "user",
        id: `user:${u.id}`,
        name: u.name,
        color: u.color,
        avatarEmoji: u.avatarEmoji,
        dob,
        yearKnown: true,
        nextBirthday,
        daysUntil,
        ageOnNext: nextBirthday.getFullYear() - dob.getFullYear(),
        currentAge: computeCurrentAge(dob, today),
        sourceId: u.id,
      });
    }

    for (const b of birthdays) {
      const dob = new Date(b.dateOfBirth);
      const nextBirthday = computeNextBirthday(dob, today);
      const daysUntil = Math.round(
        (nextBirthday.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
      );
      out.push({
        kind: "manual",
        id: `manual:${b.id}`,
        name: b.name,
        color: b.color || "#ec4899",
        avatarEmoji: b.avatarEmoji || "🎂",
        dob,
        yearKnown: b.yearKnown,
        nextBirthday,
        daysUntil,
        ageOnNext: b.yearKnown
          ? nextBirthday.getFullYear() - dob.getFullYear()
          : null,
        currentAge: b.yearKnown ? computeCurrentAge(dob, today) : null,
        notes: b.notes,
        sourceId: b.id,
      });
    }

    return out.sort((a, b) => a.daysUntil - b.daysUntil);
  }, [users, birthdays]);

  // v4.9.1 — apply the search filter after sorting so chronological order
  // is preserved within results. Trim + lowercase the query once.
  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q));
  }, [rows, query]);

  if (loading) return <p className="muted text-sm">Loading Birthdays…</p>;

  const empty = filteredRows.length === 0;
  const noBirthdaysAtAll = rows.length === 0;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {/* v4.9.1 — name search. Bare text input, no magnifying-glass
            icon (kept consistent with the shopping catalog search bar). */}
        <input
          type="search"
          className="input flex-1 min-w-[180px] max-w-sm"
          placeholder="Search Birthdays"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search Birthdays"
        />
        <div className="flex-1" />
        {canEdit && (
          <button
            className="btn btn-primary btn-sm inline-flex items-center"
            onClick={() => {
              setEditing(null);
              setShowDialog(true);
            }}
          >
            <Plus size={14} /> New Birthday
          </button>
        )}
      </div>

      {empty ? (
        <div className="card p-6 text-center">
          <Cake className="mx-auto mb-2 text-pink-500" size={36} />
          {noBirthdaysAtAll ? (
            <>
              <p className="font-semibold mb-1">No Birthdays On File</p>
              <p className="text-sm muted">
                {canEdit
                  ? "Add a birthday with the button above, or add dates of birth to family members on the Family page."
                  : canManage
                    ? "Open the Family page and add a date of birth to a member."
                    : "Ask a parent to add your date of birth on the Family page."}
              </p>
              {canManage && (
                <Link
                  href="/family"
                  className="btn btn-primary mt-4 inline-flex"
                >
                  Go to Family
                </Link>
              )}
            </>
          ) : (
            <>
              <p className="font-semibold mb-1">No matches</p>
              <p className="text-sm muted">
                No birthdays match &ldquo;{query.trim()}&rdquo;. Try a different name.
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {filteredRows.map((r) => {
            const isToday = r.daysUntil === 0;
            return (
              <div
                key={r.id}
                className="card p-4 flex items-center gap-4 relative overflow-hidden"
                style={{
                  borderColor: isToday ? r.color : undefined,
                  background: isToday ? `${r.color}15` : undefined,
                }}
              >
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl shrink-0"
                  style={{
                    background: r.color + "33",
                    border: `1px solid ${r.color}`,
                  }}
                >
                  {r.avatarEmoji}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-bold flex items-center gap-2">
                    {r.name}
                    {isToday && (
                      <Gift
                        size={16}
                        className="text-pink-500 fill-pink-500/40"
                      />
                    )}
                  </div>
                  <div className="text-sm muted">
                    {r.yearKnown
                      ? r.dob.toLocaleDateString(undefined, {
                          day: "numeric",
                          month: "long",
                          year: "numeric",
                        })
                      : r.dob.toLocaleDateString(undefined, {
                          day: "numeric",
                          month: "long",
                        })}
                    {r.yearKnown && r.currentAge !== null && (
                      <>
                        {" · currently "}
                        {r.currentAge}
                      </>
                    )}
                  </div>
                  <div className="text-sm font-semibold mt-1">
                    {isToday
                      ? r.ageOnNext !== null
                        ? `🎉 Turning ${r.ageOnNext} today!`
                        : `🎉 Happy Birthday!`
                      : r.daysUntil === 1
                        ? r.ageOnNext !== null
                          ? `Tomorrow — turning ${r.ageOnNext}`
                          : `Tomorrow!`
                        : r.ageOnNext !== null
                          ? `${r.daysUntil} days away — turning ${r.ageOnNext}`
                          : `${r.daysUntil} days away`}
                  </div>
                  {r.notes && (
                    <div className="text-xs muted mt-1 italic">{r.notes}</div>
                  )}
                </div>
                {canEdit && r.kind === "manual" && (
                  <div className="flex flex-col gap-1 shrink-0">
                    <button
                      className="icon-btn"
                      aria-label="Edit"
                      onClick={() => {
                        const b = birthdays.find((x) => x.id === r.sourceId);
                        if (b) {
                          setEditing(b);
                          setShowDialog(true);
                        }
                      }}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      className="icon-btn text-red-500"
                      aria-label="Delete"
                      onClick={async () => {
                        if (
                          !confirm(`Delete ${r.name}'s birthday?`)
                        )
                          return;
                        await fetch(`/api/birthdays/${r.sourceId}`, {
                          method: "DELETE",
                        });
                        await refresh();
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showDialog && (
        <BirthdayDialog
          initial={editing}
          onClose={() => {
            setShowDialog(false);
            setEditing(null);
          }}
          onSaved={async () => {
            setShowDialog(false);
            setEditing(null);
            await refresh();
          }}
        />
      )}
    </>
  );
}

function BirthdayDialog({
  initial,
  onClose,
  onSaved,
}: {
  initial: Birthday | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial?.name || "");
  // `yearKnown` drives whether we show the full date picker or the month/day
  // select pair. When flipping on/off we preserve the month+day so the user
  // doesn't have to re-pick them.
  const [yearKnown, setYearKnown] = useState<boolean>(
    initial ? initial.yearKnown : true,
  );
  const [dateOfBirth, setDateOfBirth] = useState(
    initial ? initial.dateOfBirth.slice(0, 10) : "",
  );
  // Separate month / day state for the "year unknown" path. 1-indexed month.
  const initialMonth =
    initial && !initial.yearKnown
      ? new Date(initial.dateOfBirth).getUTCMonth() + 1
      : initial && initial.dateOfBirth
        ? Number(initial.dateOfBirth.slice(5, 7))
        : 1;
  const initialDay =
    initial && !initial.yearKnown
      ? new Date(initial.dateOfBirth).getUTCDate()
      : initial && initial.dateOfBirth
        ? Number(initial.dateOfBirth.slice(8, 10))
        : 1;
  const [month, setMonth] = useState<number>(initialMonth);
  const [day, setDay] = useState<number>(initialDay);
  const [notes, setNotes] = useState(initial?.notes || "");
  const [color, setColor] = useState(initial?.color || DEFAULT_COLORS[4]);
  const [avatarEmoji, setAvatarEmoji] = useState(initial?.avatarEmoji || "🎂");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // When switching to "year unknown", pre-fill the month/day from any date
  // already entered so nothing is lost.
  const toggleYearKnown = (next: boolean) => {
    if (!next && dateOfBirth) {
      setMonth(Number(dateOfBirth.slice(5, 7)) || month);
      setDay(Number(dateOfBirth.slice(8, 10)) || day);
    } else if (next && !dateOfBirth) {
      // Going back to year-known with no prior date — seed a plausible one
      // using today's year and the chosen month/day.
      const y = new Date().getFullYear();
      setDateOfBirth(
        `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      );
    }
    setYearKnown(next);
  };

  const save = async () => {
    setError(null);
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    // Build the ISO date we'll POST. Year-known → use the date input directly.
    // Year-unknown → synthesise YYYY-MM-DD with a placeholder year; the API
    // canonicalises it to UNKNOWN_BIRTH_YEAR server-side (2000, a leap year).
    let isoDob: string;
    if (yearKnown) {
      if (!dateOfBirth) {
        setError("Date of birth is required");
        return;
      }
      isoDob = dateOfBirth;
    } else {
      if (!month || !day) {
        setError("Month and day are required");
        return;
      }
      // Sanity check: reject 31 Feb etc before the round-trip. Uses 2000
      // (a leap year) so 29 Feb is valid here — matches the API sentinel.
      const probe = new Date(Date.UTC(2000, month - 1, day));
      if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
        setError("That date doesn't exist — pick a valid month/day");
        return;
      }
      isoDob = `2000-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        dateOfBirth: isoDob,
        yearKnown,
        notes: notes.trim() || null,
        color,
        avatarEmoji: avatarEmoji || "🎂",
      };
      const url = initial
        ? `/api/birthdays/${initial.id}`
        : "/api/birthdays";
      const method = initial ? "PATCH" : "POST";
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || "Failed to save");
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    // v4.7.5 — wrapped layout so tall dialogs scroll cleanly in web mode.
    <div
      className="fixed inset-0 bg-black/50 z-50 overflow-y-auto"
      onClick={onClose}
    >
      <div className="flex min-h-full items-start sm:items-center justify-center p-3 sm:p-4">
        <div
          className="card p-4 sm:p-5 w-full max-w-md relative my-4 sm:my-8"
          onClick={(e) => e.stopPropagation()}
        >
        <button
          className="icon-btn absolute top-2 right-2"
          onClick={onClose}
          aria-label="Close"
        >
          <X size={16} />
        </button>
        <h2 className="text-lg font-bold mb-3 pr-10">
          {initial ? "Edit Birthday" : "New Birthday"}
        </h2>

        <label className="block text-sm font-semibold mb-1">Name</label>
        <input
          className="input w-full mb-3"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Grandma Jo"
        />

        <label className="block text-sm font-semibold mb-1">Date of Birth</label>
        {yearKnown ? (
          <input
            type="date"
            className="input w-full mb-2"
            value={dateOfBirth}
            onChange={(e) => setDateOfBirth(e.target.value)}
          />
        ) : (
          <div className="flex gap-2 mb-2">
            <select
              className="input flex-1"
              value={month}
              onChange={(e) => {
                const m = Number(e.target.value);
                setMonth(m);
                // Clamp day if the new month is shorter (e.g. 31 Jan → Feb).
                const max = daysInMonth(m);
                if (day > max) setDay(max);
              }}
              aria-label="Month"
            >
              {MONTH_NAMES.map((n, i) => (
                <option key={n} value={i + 1}>
                  {n}
                </option>
              ))}
            </select>
            <select
              className="input w-24"
              value={day}
              onChange={(e) => setDay(Number(e.target.value))}
              aria-label="Day"
            >
              {Array.from({ length: daysInMonth(month) }, (_, i) => i + 1).map(
                (d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ),
              )}
            </select>
          </div>
        )}
        <label className="flex items-center gap-2 text-sm mb-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={!yearKnown}
            onChange={(e) => toggleYearKnown(!e.target.checked)}
          />
          Year of birth unknown
        </label>

        <label className="block text-sm font-semibold mb-1">Emoji</label>
        <input
          className="input w-full mb-3"
          value={avatarEmoji}
          onChange={(e) => setAvatarEmoji(e.target.value)}
          placeholder="🎂"
          maxLength={4}
        />

        <label className="block text-sm font-semibold mb-1">Colour</label>
        <div className="flex gap-2 flex-wrap mb-3">
          {DEFAULT_COLORS.map((c) => (
            <button
              key={c}
              className="w-8 h-8 rounded-full border-2"
              style={{
                background: c,
                borderColor: color === c ? "#000" : "transparent",
              }}
              onClick={() => setColor(c)}
              aria-label={`Choose ${c}`}
            />
          ))}
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="w-8 h-8 rounded cursor-pointer"
          />
        </div>

        <label className="block text-sm font-semibold mb-1">Notes</label>
        <textarea
          className="input w-full mb-3"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Gift ideas, allergies, etc."
        />

        {error && (
          <p className="text-sm text-red-500 mb-2">{error}</p>
        )}

        <div className="flex justify-end gap-2">
          <button className="btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={save}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// Works for leap-day handling regardless of year — we use 2020 (a leap year)
// so 29 Feb is accepted in the picker even when the "year unknown" path is
// active. The API canonicalises the stored year to 1900 anyway.
function daysInMonth(month1Based: number): number {
  return new Date(2020, month1Based, 0).getDate();
}

function computeNextBirthday(dob: Date, today: Date): Date {
  let year = today.getFullYear();
  let next = new Date(year, dob.getMonth(), dob.getDate());
  if (next < today) {
    year += 1;
    next = new Date(year, dob.getMonth(), dob.getDate());
  }
  return next;
}

function computeCurrentAge(dob: Date, today: Date): number {
  let age = today.getFullYear() - dob.getFullYear();
  const hadBirthdayThisYear =
    today.getMonth() > dob.getMonth() ||
    (today.getMonth() === dob.getMonth() && today.getDate() >= dob.getDate());
  if (!hadBirthdayThisYear) age -= 1;
  return age;
}
