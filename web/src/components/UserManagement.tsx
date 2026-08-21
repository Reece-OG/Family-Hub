"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, X, Check } from "lucide-react";
import { permissionLabels } from "@/lib/permissions";

type Perm = Record<string, boolean>;
type UserRow = {
  id: string;
  email: string;
  name: string;
  role: "PARENT" | "CHILD";
  color: string;
  avatarEmoji: string;
  dateOfBirth: string | null;
  // v4.7.15 — controls whether this member's birthday appears as a yearly
  // all-day event on the shared calendar. Defaults to true server-side.
  showBirthdayOnCalendar?: boolean;
  // v4.8.1 — parent-managed kill switch for this user's event reminders.
  // Defaults true so existing accounts keep getting reminders.
  receivesOwnEventReminders?: boolean;
  permissions: Perm | null;
};

const EMOJIS = ["👑", "🧒", "👧", "👦", "🧑", "👩", "👨", "🐻", "🦊", "🐱", "🐶", "🦄"];

export function UserManagement({ myId }: { myId: string }) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [creating, setCreating] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);

  async function load() {
    const r = await fetch("/api/users");
    const j = await r.json();
    setUsers(j.users || []);
  }
  useEffect(() => {
    load();
  }, []);

  async function remove(u: UserRow) {
    if (u.id === myId) {
      alert("You can't delete your own account while signed in.");
      return;
    }
    if (!confirm(`Remove ${u.name}? This deletes their events, to-dos, and shopping contributions.`))
      return;
    const res = await fetch(`/api/users/${u.id}`, { method: "DELETE" });
    if (!res.ok) {
      const j = await res.json();
      alert(j.error || "Could not delete");
    }
    await load();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">Family Members</h2>
        <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
          <Plus size={14} /> Add member
        </button>
      </div>

      <ul className="space-y-2">
        {users.map((u) => (
          <li key={u.id} className="card p-3 flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-xl border"
              style={{ background: u.color + "33", borderColor: u.color }}
            >
              {u.avatarEmoji}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold">
                {u.name}{" "}
                <span className="chip ml-1" style={{ background: "transparent" }}>
                  {u.role === "PARENT" ? "Parent" : "Child"}
                </span>
              </div>
              <div className="text-sm muted truncate">{u.email}</div>
            </div>
            <button className="btn btn-secondary" onClick={() => setEditingUser(u)}>
              Edit
            </button>
            <button
              className="btn btn-ghost text-red-500"
              onClick={() => remove(u)}
              aria-label="Delete"
            >
              <Trash2 size={16} />
            </button>
          </li>
        ))}
      </ul>

      {creating && (
        <CreateUserDialog
          onClose={() => setCreating(false)}
          onDone={async () => {
            setCreating(false);
            await load();
          }}
        />
      )}

      {editingUser && (
        <EditUserDialog
          user={editingUser}
          onClose={() => setEditingUser(null)}
          onDone={async () => {
            setEditingUser(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function CreateUserDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "CHILD",
    color: "#7c3aed",
    avatarEmoji: "🧒",
    dateOfBirth: "",
    // v4.7.15 — defaults to true so the birthday lands on the calendar
    // automatically when a DOB is provided. Tickbox below lets the parent
    // turn it off at create time.
    showBirthdayOnCalendar: true,
  });
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const payload = {
      ...form,
      dateOfBirth: form.dateOfBirth ? new Date(form.dateOfBirth).toISOString() : null,
    };
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const j = await res.json();
      setErr(j.error || "Could not create");
      return;
    }
    onDone();
  }

  return (
    <Modal onClose={onClose} title="Add Family Member">
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="text-sm font-medium">Name</label>
          <input
            className="input mt-1"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </div>
        <div>
          <label className="text-sm font-medium">Email (used to sign in)</label>
          <input
            type="email"
            className="input mt-1"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
          />
        </div>
        <div>
          <label className="text-sm font-medium">Temporary password</label>
          <input
            className="input mt-1"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
            minLength={4}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium">Role</label>
            <select
              className="select mt-1"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
            >
              <option value="CHILD">Child</option>
              <option value="PARENT">Parent</option>
            </select>
          </div>
          <div>
            <label className="text-sm font-medium">Colour</label>
            <input
              type="color"
              className="input mt-1 p-1 h-[42px]"
              value={form.color}
              onChange={(e) => setForm({ ...form, color: e.target.value })}
            />
          </div>
        </div>
        <div>
          <label className="text-sm font-medium">Date of birth (optional)</label>
          <input
            type="date"
            className="input mt-1"
            value={form.dateOfBirth}
            onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })}
          />
        </div>
        {/* v4.7.16 — pulled out of the DOB div + restyled as its own card
            row so the tickbox is impossible to miss. v4.7.15 had it tucked
            under the date input which users reported they couldn't see. */}
        <label
          className={`flex items-start gap-3 p-3 rounded-xl border border-[rgb(var(--border))] cursor-pointer ${
            form.dateOfBirth ? "" : "opacity-60"
          }`}
        >
          <input
            type="checkbox"
            className="mt-0.5"
            checked={form.showBirthdayOnCalendar}
            disabled={!form.dateOfBirth}
            onChange={(e) =>
              setForm({ ...form, showBirthdayOnCalendar: e.target.checked })
            }
          />
          <span className="text-sm">
            <span className="font-medium">Show birthday on the family calendar</span>
            <span className="block text-xs muted mt-0.5">
              {form.dateOfBirth
                ? "A yearly all-day event will be added/removed when you save."
                : "Set a date of birth above to enable this."}
            </span>
          </span>
        </label>
        <div>
          <label className="text-sm font-medium">Avatar</label>
          <div className="flex gap-2 flex-wrap mt-1">
            {EMOJIS.map((em) => (
              <button
                type="button"
                key={em}
                onClick={() => setForm({ ...form, avatarEmoji: em })}
                className={`w-10 h-10 rounded-full flex items-center justify-center text-xl border ${
                  form.avatarEmoji === em
                    ? "border-[rgb(var(--brand))] ring-2 ring-[rgb(var(--brand))]"
                    : "border-[rgb(var(--border))]"
                }`}
              >
                {em}
              </button>
            ))}
          </div>
        </div>
        {err && (
          <div className="text-sm text-red-600 dark:text-red-400">{err}</div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary">Create</button>
        </div>
      </form>
    </Modal>
  );
}

function EditUserDialog({
  user,
  onClose,
  onDone,
}: {
  user: UserRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    name: user.name,
    email: user.email,
    color: user.color,
    avatarEmoji: user.avatarEmoji,
    role: user.role,
    password: "",
    dateOfBirth: user.dateOfBirth ? user.dateOfBirth.slice(0, 10) : "",
    // v4.7.15 — server defaults this to true for existing rows, so undefined
    // here means "missing from the response" (older server) — treat as true.
    showBirthdayOnCalendar:
      user.showBirthdayOnCalendar === undefined ? true : user.showBirthdayOnCalendar,
    // v4.8.1 — kid-side kill switch (server default true).
    receivesOwnEventReminders:
      user.receivesOwnEventReminders === undefined
        ? true
        : user.receivesOwnEventReminders,
  });
  const [perms, setPerms] = useState<Perm>(() => ({ ...(user.permissions || {}) }));
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const body: any = {
      name: form.name,
      email: form.email,
      color: form.color,
      avatarEmoji: form.avatarEmoji,
      role: form.role,
      dateOfBirth: form.dateOfBirth
        ? new Date(form.dateOfBirth).toISOString()
        : null,
      showBirthdayOnCalendar: form.showBirthdayOnCalendar,
      receivesOwnEventReminders: form.receivesOwnEventReminders,
      permissions: perms,
    };
    if (form.password) body.password = form.password;
    const res = await fetch(`/api/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const j = await res.json();
      setErr(j.error || "Save failed");
      return;
    }
    onDone();
  }

  const keys = Object.keys(permissionLabels);

  return (
    <Modal onClose={onClose} title={`Edit ${user.name}`} wide>
      <form onSubmit={save} className="grid md:grid-cols-2 gap-5">
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium">Name</label>
            <input
              className="input mt-1"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="text-sm font-medium">Email</label>
            <input
              type="email"
              className="input mt-1"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">Role</label>
              <select
                className="select mt-1"
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as any })}
              >
                <option value="CHILD">Child</option>
                <option value="PARENT">Parent</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">Colour</label>
              <input
                type="color"
                className="input mt-1 p-1 h-[42px]"
                value={form.color}
                onChange={(e) => setForm({ ...form, color: e.target.value })}
              />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium">Avatar</label>
            <div className="flex gap-2 flex-wrap mt-1">
              {EMOJIS.map((em) => (
                <button
                  type="button"
                  key={em}
                  onClick={() => setForm({ ...form, avatarEmoji: em })}
                  className={`w-10 h-10 rounded-full flex items-center justify-center text-xl border ${
                    form.avatarEmoji === em
                      ? "border-[rgb(var(--brand))] ring-2 ring-[rgb(var(--brand))]"
                      : "border-[rgb(var(--border))]"
                  }`}
                >
                  {em}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-sm font-medium">Date of birth (optional)</label>
            <input
              type="date"
              className="input mt-1"
              value={form.dateOfBirth}
              onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })}
            />
          </div>
          {/* v4.7.16 — pulled out of the DOB div + restyled as its own
              card row so the tickbox is impossible to miss. v4.7.15 had it
              tucked under the date input and users reported not seeing it. */}
          <label
            className={`flex items-start gap-3 p-3 rounded-xl border border-[rgb(var(--border))] cursor-pointer ${
              form.dateOfBirth ? "" : "opacity-60"
            }`}
          >
            <input
              type="checkbox"
              className="mt-0.5"
              checked={form.showBirthdayOnCalendar}
              disabled={!form.dateOfBirth}
              onChange={(e) =>
                setForm({
                  ...form,
                  showBirthdayOnCalendar: e.target.checked,
                })
              }
            />
            <span className="text-sm">
              <span className="font-medium">Show birthday on the family calendar</span>
              <span className="block text-xs muted mt-0.5">
                {form.dateOfBirth
                  ? "A yearly all-day event will be added/removed when you save."
                  : "Set a date of birth above to enable this."}
              </span>
            </span>
          </label>
          {/* v4.8.1 — per-user event-reminder kill switch. Defaults on; flip
              it off for a child who shouldn't get pinged (e.g. a kiosk that
              lives in their room and you'd rather not ding overnight). */}
          <label className="flex items-start gap-3 p-3 rounded-xl border border-[rgb(var(--border))] cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={form.receivesOwnEventReminders}
              onChange={(e) =>
                setForm({
                  ...form,
                  receivesOwnEventReminders: e.target.checked,
                })
              }
            />
            <span className="text-sm">
              <span className="font-medium">Send event reminders to this user</span>
              <span className="block text-xs muted mt-0.5">
                When off, this user gets no push or email reminders for
                events they&apos;re a participant on. To-do, maintenance, and
                tax reminders are unaffected.
              </span>
            </span>
          </label>
          <div>
            <label className="text-sm font-medium">Reset password</label>
            <input
              className="input mt-1"
              placeholder="Leave blank to keep current"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </div>
        </div>
        <div>
          <div className="text-sm font-medium mb-2">Permissions</div>
          <div className="space-y-1.5 card p-3">
            {form.role === "PARENT" && (
              <p className="text-xs muted mb-1">
                Parents automatically have full access. Permissions apply to children.
              </p>
            )}
            {keys.map((k) => (
              <label
                key={k}
                className="flex items-center gap-2 text-sm cursor-pointer select-none"
              >
                <input
                  type="checkbox"
                  checked={!!perms[k]}
                  disabled={form.role === "PARENT"}
                  onChange={(e) => setPerms({ ...perms, [k]: e.target.checked })}
                />
                <span>{permissionLabels[k]}</span>
              </label>
            ))}
          </div>
        </div>
        {err && (
          <div className="md:col-span-2 text-sm text-red-600 dark:text-red-400">
            {err}
          </div>
        )}
        <div className="md:col-span-2 flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary">
            <Check size={16} /> Save
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Modal({
  title,
  children,
  onClose,
  wide,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    // v4.7.5 — wrapped layout so tall dialogs scroll cleanly in web mode.
    <div className="fixed inset-0 z-40 bg-black/50 overflow-y-auto">
      <div className="flex min-h-full items-start sm:items-center justify-center p-3 sm:p-4">
        <div className={`card ${wide ? "max-w-3xl" : "max-w-lg"} w-full p-4 sm:p-5 relative my-4 sm:my-8`}>
        <button
          onClick={onClose}
          className="absolute right-3 top-3 btn btn-ghost"
          aria-label="Close"
        >
          <X size={18} />
        </button>
        <h3 className="text-lg font-bold mb-4 pr-10">{title}</h3>
        {children}
        </div>
      </div>
    </div>
  );
}
