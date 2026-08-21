"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { format, formatDistanceToNow, isPast } from "date-fns";
import { Bell, Check, Mail, Plus, Trash2, X } from "lucide-react";
import { useAutoRefresh } from "@/lib/use-auto-refresh";

type UserMini = {
  id: string;
  name: string;
  color: string;
  avatarEmoji: string;
  role?: "PARENT" | "CHILD";
};

type Reminder = {
  id: string;
  userId: string;
  title: string;
  body: string | null;
  remindAt: string;
  deliveryInApp: boolean;
  deliveryEmail: boolean;
  sent: boolean;
  sentAt: string | null;
  deliveryError: string | null;
  acknowledgedAt: string | null;
  user: UserMini;
};

type EditForm = {
  id?: string;
  userId: string;
  title: string;
  body: string;
  remindAt: string;
  deliveryInApp: boolean;
  deliveryEmail: boolean;
};

export function RemindersView({
  me,
}: {
  me: {
    id: string;
    role: "PARENT" | "CHILD";
    canEdit: boolean;
  };
}) {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [users, setUsers] = useState<UserMini[]>([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<"mine" | "all">(
    me.role === "PARENT" ? "all" : "mine",
  );
  const [editing, setEditing] = useState<EditForm | null>(null);

  const load = useCallback(async () => {
    // v4.7.18 — keep existing data on screen during refreshes. See MenuView
    // for the full rationale. Initial useState(true) handles the first paint.
    try {
      const [r, u] = await Promise.all([
        fetch(`/api/reminders?scope=${scope}`).then((r) => r.json()),
        fetch("/api/users").then((r) => r.json()),
      ]);
      setReminders(r.reminders || []);
      setUsers(u.users || []);
    } finally {
      setLoading(false);
    }
  }, [scope]);

  // v4.7.17 — refresh on mount, tab focus, and every 30 s. Reminders care
  // a bit more about staying current than e.g. the menu does, since pushes
  // get materialised from them.
  useAutoRefresh(load, { intervalMs: 30_000 });

  const { upcoming, past } = useMemo(() => {
    const up: Reminder[] = [];
    const pt: Reminder[] = [];
    for (const r of reminders) {
      if (!r.sent) up.push(r);
      else pt.push(r);
    }
    up.sort(
      (a, b) => new Date(a.remindAt).getTime() - new Date(b.remindAt).getTime(),
    );
    pt.sort(
      (a, b) => new Date(b.remindAt).getTime() - new Date(a.remindAt).getTime(),
    );
    return { upcoming: up, past: pt };
  }, [reminders]);

  function openNew() {
    const at = new Date();
    at.setHours(at.getHours() + 1, 0, 0, 0);
    setEditing({
      userId: me.id,
      title: "",
      body: "",
      remindAt: at.toISOString(),
      deliveryInApp: true,
      deliveryEmail: false,
    });
  }

  function openExisting(r: Reminder) {
    setEditing({
      id: r.id,
      userId: r.userId,
      title: r.title,
      body: r.body ?? "",
      remindAt: r.remindAt,
      deliveryInApp: r.deliveryInApp,
      deliveryEmail: r.deliveryEmail,
    });
  }

  async function save() {
    if (!editing) return;
    const body = {
      title: editing.title,
      body: editing.body || null,
      remindAt: editing.remindAt,
      deliveryInApp: editing.deliveryInApp,
      deliveryEmail: editing.deliveryEmail,
      userId: editing.userId,
    };
    const res = await fetch(
      editing.id ? `/api/reminders/${editing.id}` : "/api/reminders",
      {
        method: editing.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (res.ok) {
      setEditing(null);
      await load();
    } else {
      const d = await res.json();
      alert(d.error || "Could not save reminder");
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this reminder?")) return;
    await fetch(`/api/reminders/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {me.role === "PARENT" && (
          <div className="inline-flex rounded-xl border border-[rgb(var(--border))] overflow-hidden">
            <button
              className={`px-2.5 py-1.5 text-xs sm:px-3 sm:py-2 sm:text-sm ${scope === "mine" ? "bg-violet-500 text-white" : ""}`}
              onClick={() => setScope("mine")}
            >
              Mine
            </button>
            <button
              className={`px-2.5 py-1.5 text-xs sm:px-3 sm:py-2 sm:text-sm border-l border-[rgb(var(--border))] ${scope === "all" ? "bg-violet-500 text-white" : ""}`}
              onClick={() => setScope("all")}
            >
              Everyone
            </button>
          </div>
        )}
        <div className="flex-1" />
        {me.canEdit && (
          <button className="btn btn-primary btn-sm" onClick={openNew}>
            <Plus size={14} /> New reminder
          </button>
        )}
      </div>

      {loading ? (
        <p className="muted text-sm">Loading reminders…</p>
      ) : reminders.length === 0 ? (
        <div className="card p-8 text-center">
          <Bell className="mx-auto mb-2 text-violet-500" size={36} />
          <p className="font-semibold mb-1">No reminders yet</p>
          <p className="text-sm muted">
            Create a reminder to get an in-app toast (and email if configured).
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {upcoming.length > 0 && (
            <section>
              <h2 className="font-bold mb-2">Upcoming</h2>
              <ul className="space-y-2">
                {upcoming.map((r) => (
                  <ReminderRow
                    key={r.id}
                    r={r}
                    canEdit={me.canEdit && (me.role === "PARENT" || r.userId === me.id)}
                    onOpen={openExisting}
                    onDelete={remove}
                  />
                ))}
              </ul>
            </section>
          )}
          {past.length > 0 && (
            <section>
              <h2 className="font-bold mb-2 muted">Past</h2>
              <ul className="space-y-2 opacity-80">
                {past.map((r) => (
                  <ReminderRow
                    key={r.id}
                    r={r}
                    canEdit={me.canEdit && (me.role === "PARENT" || r.userId === me.id)}
                    onOpen={openExisting}
                    onDelete={remove}
                  />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {editing && (
        <ReminderDialog
          me={me}
          users={users}
          value={editing}
          onChange={setEditing}
          onClose={() => setEditing(null)}
          onSave={save}
          onDelete={
            editing.id
              ? () => {
                  if (editing.id) remove(editing.id);
                  setEditing(null);
                }
              : undefined
          }
        />
      )}
    </div>
  );
}

function ReminderRow({
  r,
  canEdit,
  onOpen,
  onDelete,
}: {
  r: Reminder;
  canEdit: boolean;
  onOpen: (r: Reminder) => void;
  onDelete: (id: string) => void;
}) {
  const at = new Date(r.remindAt);
  const past = isPast(at);
  return (
    <li className="card p-3 flex items-center gap-3">
      <button
        className="flex-1 text-left min-w-0"
        onClick={() => onOpen(r)}
      >
        <div className="font-semibold truncate">{r.title}</div>
        <div className="text-sm muted">
          {format(at, "EEE d MMM, HH:mm")}
          {" · "}
          {past ? "fired " : ""}
          {formatDistanceToNow(at, { addSuffix: true })}
        </div>
        {r.body && (
          <div className="text-sm muted mt-1 line-clamp-2">{r.body}</div>
        )}
        <div className="flex items-center gap-2 mt-1 text-xs muted">
          <span
            className="chip"
            style={{ background: r.user.color + "33", borderColor: r.user.color }}
          >
            {r.user.avatarEmoji} {r.user.name}
          </span>
          {r.deliveryEmail && (
            <span className="chip" title="Will email this reminder">
              <Mail size={12} /> email
            </span>
          )}
          {r.sent && !r.deliveryError && (
            <span className="chip text-green-700 dark:text-green-300">
              <Check size={12} /> sent
            </span>
          )}
          {r.deliveryError && (
            <span className="chip text-rose-700 dark:text-rose-300" title={r.deliveryError}>
              email failed
            </span>
          )}
        </div>
      </button>
      {canEdit && (
        <button
          className="btn btn-ghost"
          onClick={() => onDelete(r.id)}
          aria-label="Delete"
        >
          <Trash2 size={16} />
        </button>
      )}
    </li>
  );
}

function ReminderDialog({
  me,
  users,
  value,
  onChange,
  onClose,
  onSave,
  onDelete,
}: {
  me: { id: string; role: "PARENT" | "CHILD" };
  users: UserMini[];
  value: EditForm;
  onChange: (v: EditForm) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete?: () => void;
}) {
  const canRetarget = me.role === "PARENT";

  return (
    // v4.7.5 — outer scrolls, inner is min-h-full; prevents top-clipping
    // when the dialog is taller than the viewport in web mode.
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
        <h3 className="text-lg font-bold mb-4 pr-10">
          {value.id ? "Edit Reminder" : "New Reminder"}
        </h3>

        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium">Title</label>
            <input
              className="input mt-1"
              value={value.title}
              onChange={(e) => onChange({ ...value, title: e.target.value })}
              placeholder="Take out the bins"
            />
          </div>

          <div>
            <label className="text-sm font-medium">Remind at</label>
            <input
              type="datetime-local"
              className="input mt-1"
              value={toLocal(value.remindAt)}
              onChange={(e) => onChange({ ...value, remindAt: fromLocal(e.target.value) })}
            />
          </div>

          <div>
            <label className="text-sm font-medium">Notes (optional)</label>
            <textarea
              rows={3}
              className="textarea mt-1"
              value={value.body}
              onChange={(e) => onChange({ ...value, body: e.target.value })}
            />
          </div>

          {canRetarget && (
            <div>
              <label className="text-sm font-medium">For</label>
              <select
                className="input mt-1"
                value={value.userId}
                onChange={(e) => onChange({ ...value, userId: e.target.value })}
              >
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.avatarEmoji} {u.name}
                    {u.id === me.id ? " (me)" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-center gap-4 pt-1">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={value.deliveryInApp}
                onChange={(e) =>
                  onChange({ ...value, deliveryInApp: e.target.checked })
                }
              />
              In-app toast
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={value.deliveryEmail}
                onChange={(e) =>
                  onChange({ ...value, deliveryEmail: e.target.checked })
                }
              />
              Email
            </label>
          </div>
        </div>

        <div className="flex items-center justify-between mt-5">
          {onDelete ? (
            <button className="btn btn-danger" onClick={onDelete}>
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
              disabled={!value.title.trim()}
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

function toLocal(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => `${n}`.padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocal(s: string) {
  return new Date(s).toISOString();
}
