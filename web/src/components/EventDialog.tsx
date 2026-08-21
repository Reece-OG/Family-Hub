"use client";

import { useMemo } from "react";
import { Star, Trash2, X, Repeat, Bell, Plus } from "lucide-react";
import type { RecurrenceFrequency } from "@/lib/recurrence";

export type UserMini = {
  id: string;
  name: string;
  color: string;
  avatarEmoji: string;
  role?: string;
};
export type Participant = { id?: string; userId: string; user?: UserMini };
export type ReminderInput = {
  id?: string;
  minutesBefore: number;
  deliveryInApp?: boolean;
  deliveryEmail?: boolean;
};
export type EventShape = {
  id?: string;
  title?: string;
  description?: string | null;
  startAt?: string;
  endAt?: string;
  allDay?: boolean;
  location?: string | null;
  color?: string | null;
  starred?: boolean;
  createdById?: string;
  participants?: Participant[];
  recurrence?: {
    frequency: RecurrenceFrequency;
    interval: number;
    byWeekday?: number[];
    endDate?: string | null;
    endCount?: number | null;
  } | null;
  reminders?: ReminderInput[];
};

const REMINDER_PRESETS: { label: string; minutes: number }[] = [
  { label: "At start", minutes: 0 },
  { label: "5 min before", minutes: 5 },
  { label: "15 min before", minutes: 15 },
  { label: "30 min before", minutes: 30 },
  { label: "1 hour before", minutes: 60 },
  { label: "2 hours before", minutes: 120 },
  { label: "1 day before", minutes: 60 * 24 },
  { label: "2 days before", minutes: 60 * 24 * 2 },
  { label: "1 week before", minutes: 60 * 24 * 7 },
];

function reminderLabel(minutes: number): string {
  if (minutes <= 0) return "At start";
  if (minutes % (60 * 24 * 7) === 0) {
    const w = minutes / (60 * 24 * 7);
    return `${w} week${w === 1 ? "" : "s"} before`;
  }
  if (minutes % (60 * 24) === 0) {
    const d = minutes / (60 * 24);
    return `${d} day${d === 1 ? "" : "s"} before`;
  }
  if (minutes % 60 === 0) {
    const h = minutes / 60;
    return `${h} hour${h === 1 ? "" : "s"} before`;
  }
  return `${minutes} min before`;
}

export type Me = {
  id: string;
  role: "PARENT" | "CHILD";
  canEdit: boolean;
};

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function EventDialog({
  me,
  users,
  value,
  onChange,
  onClose,
  onSave,
  onDelete,
}: {
  me: Me;
  users: UserMini[];
  value: EventShape;
  onChange: (v: EventShape) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete?: () => void;
}) {
  const canEdit =
    me.canEdit &&
    (me.role === "PARENT" || !value.createdById || value.createdById === me.id);
  const participantIds: string[] = (value.participants || []).map((p) => p.userId);
  const recurrence = value.recurrence ?? null;
  const reminders: ReminderInput[] = value.reminders ?? [];

  function updateReminders(next: ReminderInput[]) {
    // Keep the list deduped by minutesBefore and sorted ascending so the UI is
    // predictable and matches the server's @@unique constraint.
    const seen = new Set<number>();
    const dedup: ReminderInput[] = [];
    for (const r of next) {
      if (seen.has(r.minutesBefore)) continue;
      seen.add(r.minutesBefore);
      dedup.push(r);
    }
    dedup.sort((a, b) => a.minutesBefore - b.minutesBefore);
    onChange({ ...value, reminders: dedup });
  }

  function addReminder(minutes: number) {
    if (reminders.some((r) => r.minutesBefore === minutes)) return;
    updateReminders([
      ...reminders,
      { minutesBefore: minutes, deliveryInApp: true, deliveryEmail: false },
    ]);
  }

  function removeReminder(minutes: number) {
    updateReminders(reminders.filter((r) => r.minutesBefore !== minutes));
  }

  function toggleDelivery(
    minutes: number,
    key: "deliveryInApp" | "deliveryEmail",
  ) {
    updateReminders(
      reminders.map((r) => {
        if (r.minutesBefore !== minutes) return r;
        const nextVal = !(r[key] ?? (key === "deliveryInApp"));
        return { ...r, [key]: nextVal };
      }),
    );
  }

  function setParticipant(userId: string, on: boolean) {
    const next = on
      ? Array.from(new Set([...participantIds, userId]))
      : participantIds.filter((id) => id !== userId);
    onChange({ ...value, participants: next.map((userId) => ({ userId })) });
  }

  function updateRecurrence(patch: Partial<NonNullable<EventShape["recurrence"]>> | null) {
    if (patch === null) {
      onChange({ ...value, recurrence: null });
      return;
    }
    const existing = recurrence ?? {
      frequency: "WEEKLY" as RecurrenceFrequency,
      interval: 1,
      byWeekday: undefined,
      endDate: null,
      endCount: null,
    };
    onChange({ ...value, recurrence: { ...existing, ...patch } });
  }

  const endMode: "never" | "count" | "date" = useMemo(() => {
    if (!recurrence) return "never";
    if (recurrence.endCount) return "count";
    if (recurrence.endDate) return "date";
    return "never";
  }, [recurrence]);

  return (
    // v4.7.5 — outer scrolls, inner is min-h-full so items-center on desktop
    // doesn't clip the top of tall dialogs (the user could no longer reach
    // the title row on long forms in web mode).
    <div className="fixed inset-0 z-40 bg-black/50 overflow-y-auto">
      <div className="flex min-h-full items-start sm:items-center justify-center p-3 sm:p-4">
        <div className="card w-full max-w-lg p-4 sm:p-5 relative my-4 sm:my-8">
        <button
          onClick={onClose}
          className="absolute right-3 top-3 btn btn-ghost"
          aria-label="Close"
        >
          <X size={18} />
        </button>
        {/* v4.7.5 — pr-10 reserves a gutter so the star toggle doesn't slide
            under the absolutely-positioned close button. */}
        <div className="flex items-center gap-2 mb-4 pr-10">
          <h3 className="text-lg font-bold">
            {value.id ? "Edit Event" : "New Event"}
          </h3>
          <button
            type="button"
            className="btn btn-ghost ml-auto"
            aria-label={value.starred ? "Unstar event" : "Star event"}
            onClick={() => onChange({ ...value, starred: !value.starred })}
            disabled={!canEdit}
            title={value.starred ? "Unstar event" : "Mark as important"}
          >
            <Star
              size={20}
              className={value.starred ? "fill-yellow-400 text-yellow-400" : ""}
            />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium">Title</label>
            <input
              className="input mt-1"
              value={value.title || ""}
              disabled={!canEdit}
              onChange={(e) => onChange({ ...value, title: e.target.value })}
              placeholder="Soccer practice"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">Start</label>
              <input
                type="datetime-local"
                className="input mt-1"
                disabled={!canEdit}
                value={toLocal(value.startAt)}
                onChange={(e) =>
                  onChange({ ...value, startAt: fromLocal(e.target.value) })
                }
              />
            </div>
            <div>
              <label className="text-sm font-medium">End</label>
              <input
                type="datetime-local"
                className="input mt-1"
                disabled={!canEdit}
                value={toLocal(value.endAt)}
                onChange={(e) =>
                  onChange({ ...value, endAt: fromLocal(e.target.value) })
                }
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={!!value.allDay}
              disabled={!canEdit}
              onChange={(e) => onChange({ ...value, allDay: e.target.checked })}
            />
            All-day event
          </label>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">Location</label>
              <input
                className="input mt-1"
                disabled={!canEdit}
                value={value.location || ""}
                onChange={(e) => onChange({ ...value, location: e.target.value })}
                placeholder="Optional"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Colour</label>
              <input
                type="color"
                className="input mt-1 p-1 h-[42px]"
                disabled={!canEdit}
                value={value.color || "#7c3aed"}
                onChange={(e) => onChange({ ...value, color: e.target.value })}
              />
            </div>
          </div>

          {/* Recurrence */}
          <div className="border rounded-xl p-3 space-y-2 bg-black/[0.02] dark:bg-white/[0.03]">
            <div className="flex items-center gap-2">
              <Repeat size={16} className="muted" />
              <label className="text-sm font-medium">Repeat</label>
              <select
                className="input ml-auto max-w-[180px]"
                disabled={!canEdit}
                value={recurrence ? recurrence.frequency : "NONE"}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "NONE") updateRecurrence(null);
                  else updateRecurrence({ frequency: v as RecurrenceFrequency });
                }}
              >
                <option value="NONE">Does not repeat</option>
                <option value="DAILY">Daily</option>
                <option value="WEEKLY">Weekly</option>
                <option value="MONTHLY">Monthly</option>
                <option value="YEARLY">Yearly</option>
              </select>
            </div>

            {recurrence && (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-sm muted">Every</span>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    className="input w-20"
                    disabled={!canEdit}
                    value={recurrence.interval}
                    onChange={(e) =>
                      updateRecurrence({
                        interval: Math.max(1, Number(e.target.value) || 1),
                      })
                    }
                  />
                  <span className="text-sm muted">
                    {unitLabel(recurrence.frequency, recurrence.interval)}
                  </span>
                </div>

                {recurrence.frequency === "WEEKLY" && (
                  <div>
                    <div className="text-xs muted mb-1">On</div>
                    <div className="flex gap-1">
                      {WEEKDAY_LABELS.map((lbl, idx) => {
                        const on = (recurrence.byWeekday ?? []).includes(idx);
                        return (
                          <button
                            key={idx}
                            type="button"
                            disabled={!canEdit}
                            className={`w-9 h-9 rounded-lg text-xs font-semibold border ${
                              on
                                ? "bg-violet-500 text-white border-violet-500"
                                : "bg-transparent border-black/10 dark:border-white/10"
                            }`}
                            onClick={() => {
                              const current = new Set(recurrence.byWeekday ?? []);
                              if (current.has(idx)) current.delete(idx);
                              else current.add(idx);
                              updateRecurrence({
                                byWeekday: Array.from(current).sort(),
                              });
                            }}
                            title={WEEKDAY_NAMES[idx]}
                          >
                            {lbl}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm muted">Ends</span>
                  <select
                    className="input max-w-[120px]"
                    disabled={!canEdit}
                    value={endMode}
                    onChange={(e) => {
                      const v = e.target.value as "never" | "count" | "date";
                      if (v === "never")
                        updateRecurrence({ endDate: null, endCount: null });
                      else if (v === "count")
                        updateRecurrence({ endDate: null, endCount: 10 });
                      else
                        updateRecurrence({
                          endDate: new Date(
                            Date.now() + 90 * 24 * 60 * 60 * 1000,
                          ).toISOString(),
                          endCount: null,
                        });
                    }}
                  >
                    <option value="never">Never</option>
                    <option value="count">After…</option>
                    <option value="date">On date</option>
                  </select>
                  {endMode === "count" && (
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        max={5000}
                        className="input w-24"
                        disabled={!canEdit}
                        value={recurrence.endCount ?? 10}
                        onChange={(e) =>
                          updateRecurrence({
                            endCount: Math.max(1, Number(e.target.value) || 1),
                          })
                        }
                      />
                      <span className="text-sm muted">occurrences</span>
                    </div>
                  )}
                  {endMode === "date" && (
                    <input
                      type="date"
                      className="input"
                      disabled={!canEdit}
                      value={
                        recurrence.endDate
                          ? new Date(recurrence.endDate).toISOString().slice(0, 10)
                          : ""
                      }
                      onChange={(e) =>
                        updateRecurrence({
                          endDate: e.target.value
                            ? new Date(e.target.value).toISOString()
                            : null,
                        })
                      }
                    />
                  )}
                </div>
              </>
            )}
          </div>

          {/* Reminders */}
          <div className="border rounded-xl p-3 space-y-2 bg-black/[0.02] dark:bg-white/[0.03]">
            <div className="flex items-center gap-2">
              <Bell size={16} className="muted" />
              <label className="text-sm font-medium">Reminders</label>
              {reminders.length === 0 && (
                <span className="text-xs muted ml-auto">None</span>
              )}
            </div>

            {reminders.length > 0 && (
              <ul className="space-y-1">
                {reminders.map((r) => {
                  const inApp = r.deliveryInApp ?? true;
                  const email = r.deliveryEmail ?? false;
                  return (
                    <li
                      key={r.minutesBefore}
                      className="flex items-center gap-2 text-sm rounded-lg px-2 py-1 bg-black/[0.03] dark:bg-white/[0.04]"
                    >
                      <span className="flex-1">{reminderLabel(r.minutesBefore)}</span>
                      <label className="flex items-center gap-1 text-xs muted">
                        <input
                          type="checkbox"
                          checked={inApp}
                          disabled={!canEdit}
                          onChange={() =>
                            toggleDelivery(r.minutesBefore, "deliveryInApp")
                          }
                        />
                        In-app
                      </label>
                      <label className="flex items-center gap-1 text-xs muted">
                        <input
                          type="checkbox"
                          checked={email}
                          disabled={!canEdit}
                          onChange={() =>
                            toggleDelivery(r.minutesBefore, "deliveryEmail")
                          }
                        />
                        Email
                      </label>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        aria-label="Remove reminder"
                        disabled={!canEdit}
                        onClick={() => removeReminder(r.minutesBefore)}
                      >
                        <X size={14} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {canEdit && (
              <div className="flex items-center gap-2 flex-wrap">
                <select
                  className="input max-w-[200px]"
                  value=""
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) return;
                    if (v === "custom") {
                      const raw = window.prompt(
                        "Minutes before the event:",
                        "10",
                      );
                      if (raw === null) return;
                      const n = Math.max(
                        0,
                        Math.min(60 * 24 * 30, Math.floor(Number(raw) || 0)),
                      );
                      addReminder(n);
                    } else {
                      addReminder(Number(v));
                    }
                    // Reset select so the same preset can be picked again
                    // after a remove.
                    e.target.value = "";
                  }}
                >
                  <option value="">
                    <Plus size={12} /> Add reminder…
                  </option>
                  {REMINDER_PRESETS.map((p) => (
                    <option
                      key={p.minutes}
                      value={p.minutes}
                      disabled={reminders.some(
                        (r) => r.minutesBefore === p.minutes,
                      )}
                    >
                      {p.label}
                    </option>
                  ))}
                  <option value="custom">Custom…</option>
                </select>
              </div>
            )}
          </div>

          <div>
            <label className="text-sm font-medium mb-1 block">For who?</label>
            <div className="flex flex-wrap gap-2">
              {users.map((u) => {
                const on = participantIds.includes(u.id);
                return (
                  <button
                    key={u.id}
                    type="button"
                    disabled={!canEdit}
                    onClick={() => setParticipant(u.id, !on)}
                    className="chip"
                    style={
                      on
                        ? { background: u.color + "33", borderColor: u.color }
                        : undefined
                    }
                  >
                    <span>{u.avatarEmoji}</span>
                    <span>{u.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">Description</label>
            <textarea
              className="textarea mt-1"
              rows={3}
              disabled={!canEdit}
              value={value.description || ""}
              onChange={(e) => onChange({ ...value, description: e.target.value })}
            />
          </div>
        </div>

        <div className="flex items-center justify-between mt-5">
          {onDelete ? (
            <button
              className="btn btn-danger"
              onClick={onDelete}
              disabled={!canEdit}
            >
              <Trash2 size={16} /> Delete
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={onSave}
              disabled={!canEdit || !value.title}
            >
              Save
            </button>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}

function unitLabel(freq: RecurrenceFrequency, interval: number) {
  const map: Record<RecurrenceFrequency, [string, string]> = {
    DAILY: ["day", "days"],
    WEEKLY: ["week", "weeks"],
    MONTHLY: ["month", "months"],
    YEARLY: ["year", "years"],
  };
  return interval === 1 ? map[freq][0] : map[freq][1];
}

function toLocal(iso: string | Date | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => `${n}`.padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}
function fromLocal(s: string) {
  return new Date(s).toISOString();
}
