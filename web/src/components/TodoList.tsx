"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import {
  Plus,
  Trash2,
  Check,
  Pencil,
  Sparkles,
  X,
  Repeat,
  CalendarPlus,
  Tag,
  Eraser,
} from "lucide-react";
import type { RecurrenceFrequency } from "@/lib/recurrence";

type UserMini = { id: string; name: string; color: string; avatarEmoji: string };
type CategoryMini = { id: string; name: string; color: string | null };
type Todo = {
  id: string;
  title: string;
  description: string | null;
  done: boolean;
  dueAt: string | null;
  priority: number;
  createdBy: UserMini;
  assignee: UserMini | null;
  category: CategoryMini | null;
  showOnCalendar: boolean;
  recurrenceFrequency: RecurrenceFrequency | null;
  recurrenceInterval: number | null;
  recurrenceByWeekday: string | null;
  recurrenceEndDate: string | null;
  recurrenceEndCount: number | null;
  // v4.7.7 — points credited to the assignee (if a child) on completion.
  pointsReward: number;
  pointsAwardedTransactionId: string | null;
};

type EditDraft = {
  id: string;
  title: string;
  description: string;
  assigneeId: string;
  categoryId: string;
  dueAt: string;
  priority: number;
  showOnCalendar: boolean;
  recurrenceFrequency: RecurrenceFrequency | null;
  recurrenceInterval: number;
  recurrenceByWeekday: number[];
  recurrenceEndMode: "never" | "count" | "date";
  recurrenceEndCount: number;
  recurrenceEndDate: string;
  pointsReward: number;
};

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Sentinel used by the category tabs for the "all" and "uncategorised" views.
const ALL_CATEGORIES = "__all__";
const UNCATEGORISED = "__none__";

export function TodoList({
  canEdit,
  isParent = false,
}: {
  canEdit: boolean;
  isParent?: boolean;
}) {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [users, setUsers] = useState<UserMini[]>([]);
  const [categories, setCategories] = useState<CategoryMini[]>([]);
  const [title, setTitle] = useState("");
  const [assigneeId, setAssigneeId] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [dueAt, setDueAt] = useState<string>("");
  // v4.7.7 — points reward on the inline-create form. Parent-only field.
  const [points, setPoints] = useState<number>(0);
  const [editing, setEditing] = useState<EditDraft | null>(null);

  const [activeCategory, setActiveCategory] = useState<string>(ALL_CATEGORIES);
  const [search, setSearch] = useState("");

  // v5.0.6 — auto-open + scroll-to when the calendar summary dialog links
  // here with ?open=<todoId>. The calendar's per-item summary offers an
  // "Open in To-Dos →" button; clicking it lands the user here with the
  // relevant to-do already open in the edit dialog and scrolled into view,
  // so they don't have to hunt for it in a long list.
  const router = useRouter();
  const searchParams = useSearchParams();
  const rowRefs = useRef<Map<string, HTMLLIElement>>(new Map());
  const handledOpenParam = useRef<string | null>(null);

  // v4.7.17 — wrap load in useCallback so useAutoRefresh's stable-deps
  // contract is honoured. The hook covers initial mount, visibility, and a
  // 60-second polling tick so the list stays fresh on a kiosk left open.
  const load = useCallback(async () => {
    const [t, u, c] = await Promise.all([
      fetch("/api/todos").then((r) => r.json()),
      fetch("/api/users").then((r) => r.json()),
      fetch("/api/todo-categories").then((r) => r.json()),
    ]);
    setTodos(t.todos || []);
    setUsers(u.users || []);
    setCategories(c.categories || []);
  }, []);
  useAutoRefresh(load, { intervalMs: 60_000 });

  // v5.0.6 — react to ?open=<id> once todos are loaded. Guarded by a ref
  // so a subsequent auto-refresh doesn't re-open the dialog after the user
  // has already closed it.
  useEffect(() => {
    const wantedId = searchParams?.get("open");
    if (!wantedId) return;
    if (handledOpenParam.current === wantedId) return;
    const target = todos.find((t) => t.id === wantedId);
    if (!target) return; // may show up on the next auto-refresh tick
    handledOpenParam.current = wantedId;
    beginEdit(target);
    // Scroll the row into view. We do this before the modal opens because
    // the modal takes over the viewport, but the scroll position is what
    // the user returns to when they close the editor.
    requestAnimationFrame(() => {
      const el = rowRefs.current.get(wantedId);
      if (el && "scrollIntoView" in el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
    // Strip the query param so a page refresh doesn't re-open the dialog.
    router.replace("/todos");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todos, searchParams]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const res = await fetch("/api/todos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        assigneeId: assigneeId || null,
        categoryId: categoryId || null,
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
        // Only parents can attach a points reward. The server enforces it
        // too; we just hide the field for children so they don't see it.
        ...(isParent && points > 0 ? { pointsReward: points } : {}),
      }),
    });
    if (res.ok) {
      setTitle("");
      setDueAt("");
      setPoints(0);
      await load();
    }
  }

  async function toggle(t: Todo) {
    await fetch(`/api/todos/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done: !t.done }),
    });
    await load();
  }

  async function remove(t: Todo) {
    if (!confirm("Delete this to-do?")) return;
    await fetch(`/api/todos/${t.id}`, { method: "DELETE" });
    await load();
  }

  // v4.7.15 — bulk-clear completed to-dos. Mirrors the shopping list's
  // "Clear ticked" pattern: tick to mark done (strikethrough sticks around so
  // the user can un-tick if they misclick), then explicitly batch-clear once
  // they're ready. Recurring to-dos already roll the next occurrence over
  // on completion, so removing the "done" historical row here is harmless.
  async function clearCompleted() {
    const doneCount = todos.filter((t) => t.done).length;
    if (doneCount === 0) return;
    const noun = doneCount === 1 ? "to-do" : "to-dos";
    if (
      !confirm(
        `Remove the ${doneCount} completed ${noun}? Outstanding items stay.`,
      )
    )
      return;
    const res = await fetch("/api/todos/done", { method: "DELETE" });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      alert(d.error || "Could not clear completed to-dos");
      return;
    }
    await load();
  }

  function beginEdit(t: Todo) {
    const weekdayList = parseWeekdayList(t.recurrenceByWeekday);
    const endMode: EditDraft["recurrenceEndMode"] = t.recurrenceEndCount
      ? "count"
      : t.recurrenceEndDate
      ? "date"
      : "never";
    setEditing({
      id: t.id,
      title: t.title,
      description: t.description ?? "",
      assigneeId: t.assignee?.id ?? "",
      categoryId: t.category?.id ?? "",
      dueAt: t.dueAt ? toLocalInput(t.dueAt) : "",
      priority: t.priority,
      showOnCalendar: t.showOnCalendar,
      recurrenceFrequency: t.recurrenceFrequency,
      recurrenceInterval: t.recurrenceInterval ?? 1,
      recurrenceByWeekday: weekdayList,
      recurrenceEndMode: endMode,
      recurrenceEndCount: t.recurrenceEndCount ?? 10,
      recurrenceEndDate: t.recurrenceEndDate
        ? new Date(t.recurrenceEndDate).toISOString().slice(0, 10)
        : "",
      pointsReward: t.pointsReward ?? 0,
    });
  }

  async function saveEdit() {
    if (!editing) return;
    if (!editing.title.trim()) {
      alert("To-do title cannot be blank.");
      return;
    }
    // If the user asked for it to appear on the calendar, enforce a due date
    // so we have a point to anchor the event to.
    if (editing.showOnCalendar && !editing.dueAt) {
      alert("Give this to-do a due date before showing it on the calendar.");
      return;
    }
    const payload: Record<string, unknown> = {
      title: editing.title.trim(),
      description: editing.description.trim() || null,
      assigneeId: editing.assigneeId || null,
      categoryId: editing.categoryId || null,
      dueAt: editing.dueAt ? new Date(editing.dueAt).toISOString() : null,
      priority: editing.priority,
      showOnCalendar: editing.showOnCalendar,
      pointsReward: Math.max(0, Math.floor(editing.pointsReward || 0)),
    };
    if (editing.recurrenceFrequency) {
      payload.recurrenceFrequency = editing.recurrenceFrequency;
      payload.recurrenceInterval = Math.max(1, editing.recurrenceInterval || 1);
      payload.recurrenceByWeekday =
        editing.recurrenceFrequency === "WEEKLY" &&
        editing.recurrenceByWeekday.length
          ? editing.recurrenceByWeekday.slice().sort().join(",")
          : null;
      if (editing.recurrenceEndMode === "count") {
        payload.recurrenceEndCount = Math.max(1, editing.recurrenceEndCount || 1);
        payload.recurrenceEndDate = null;
      } else if (editing.recurrenceEndMode === "date") {
        payload.recurrenceEndCount = null;
        payload.recurrenceEndDate = editing.recurrenceEndDate
          ? new Date(editing.recurrenceEndDate).toISOString()
          : null;
      } else {
        payload.recurrenceEndCount = null;
        payload.recurrenceEndDate = null;
      }
    } else {
      payload.recurrenceFrequency = null;
      payload.recurrenceInterval = null;
      payload.recurrenceByWeekday = null;
      payload.recurrenceEndCount = null;
      payload.recurrenceEndDate = null;
    }
    const res = await fetch(`/api/todos/${editing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      setEditing(null);
      await load();
    } else {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Could not save changes");
    }
  }

  // Derived list: filter by category tab, then by text search (title + description).
  const filteredTodos = useMemo(() => {
    const q = search.trim().toLowerCase();
    return todos.filter((t) => {
      if (activeCategory === ALL_CATEGORIES) {
        // no-op
      } else if (activeCategory === UNCATEGORISED) {
        if (t.category) return false;
      } else {
        if (t.category?.id !== activeCategory) return false;
      }
      if (!q) return true;
      return (
        t.title.toLowerCase().includes(q) ||
        (t.description ?? "").toLowerCase().includes(q) ||
        (t.category?.name ?? "").toLowerCase().includes(q)
      );
    });
  }, [todos, activeCategory, search]);

  // Count badges per category to put on the tabs.
  const counts = useMemo(() => {
    const byCategory = new Map<string, number>();
    let uncat = 0;
    for (const t of todos) {
      if (t.done) continue;
      if (!t.category) {
        uncat += 1;
      } else {
        byCategory.set(t.category.id, (byCategory.get(t.category.id) ?? 0) + 1);
      }
    }
    const total = todos.filter((t) => !t.done).length;
    return { byCategory, uncat, total };
  }, [todos]);

  // v4.7.16 — split filteredTodos into open + completed lists so the UI can
  // render them in two clearly distinct sections. Before this they sorted
  // mixed together (open at top, done at bottom) and people perceived the
  // ticked-off rows as "gone" because they didn't notice the strikethrough
  // at the bottom of a long list.
  const openTodos = useMemo(
    () => filteredTodos.filter((t) => !t.done),
    [filteredTodos],
  );
  const completedTodosInView = useMemo(
    () => filteredTodos.filter((t) => t.done),
    [filteredTodos],
  );

  // v4.7.15 — used to drive the Clear completed button label/disabled state.
  // Counts ALL done todos in the database, not just the ones in the current
  // category/search filter, so a parent on "All" knows the global pile.
  const completedCount = useMemo(
    () => todos.filter((t) => t.done).length,
    [todos],
  );

  return (
    <div>
      {/* v4.7.15 — toolbar with Clear completed. Mirrors the shopping-list
          "Clear ticked" affordance. Disabled when nothing's done. */}
      {canEdit && (
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <div className="flex-1" />
          <button
            type="button"
            onClick={clearCompleted}
            disabled={completedCount === 0}
            className="btn btn-ghost btn-sm inline-flex items-center"
            title={
              completedCount === 0
                ? "Nothing completed yet"
                : `Remove the ${completedCount} completed to-do${
                    completedCount === 1 ? "" : "s"
                  }`
            }
          >
            <Eraser size={14} /> Clear completed
            {completedCount > 0 && (
              <span className="ml-1 text-xs muted">({completedCount})</span>
            )}
          </button>
        </div>
      )}

      {/* Category tabs + search */}
      <div className="card p-3 mb-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <CategoryTab
            label="All"
            count={counts.total}
            active={activeCategory === ALL_CATEGORIES}
            onClick={() => setActiveCategory(ALL_CATEGORIES)}
          />
          {categories.map((c) => (
            <CategoryTab
              key={c.id}
              label={c.name}
              color={c.color}
              count={counts.byCategory.get(c.id) ?? 0}
              active={activeCategory === c.id}
              onClick={() => setActiveCategory(c.id)}
            />
          ))}
          {(counts.uncat > 0 || activeCategory === UNCATEGORISED) && (
            <CategoryTab
              label="Uncategorised"
              count={counts.uncat}
              active={activeCategory === UNCATEGORISED}
              onClick={() => setActiveCategory(UNCATEGORISED)}
            />
          )}
          <div className="ml-auto min-w-[180px]">
            <input
              className="input"
              placeholder="Search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        {categories.length === 0 && (
          <p className="text-xs muted">
            Tip: a parent can create categories in Settings to group to-dos.
          </p>
        )}
      </div>

      {canEdit && (
        <form
          onSubmit={create}
          className="card p-3 mb-4 flex flex-wrap items-end gap-2"
        >
          <div className="flex-1 min-w-[180px]">
            <label className="text-xs font-medium muted">New To-Do</label>
            <input
              className="input mt-1"
              placeholder="Take out the trash…"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs font-medium muted">Assign</label>
            <select
              className="select mt-1"
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
            >
              <option value="">Anyone</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.avatarEmoji} {u.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium muted">Category</label>
            <select
              className="select mt-1"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">— None —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium muted">Due</label>
            <input
              type="datetime-local"
              className="input mt-1"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
            />
          </div>
          {isParent && (
            <div className="w-24">
              <label className="text-xs font-medium muted">Points</label>
              <input
                type="number"
                min={0}
                step={1}
                className="input mt-1"
                placeholder="0"
                value={points || ""}
                onChange={(e) =>
                  setPoints(Math.max(0, Math.floor(Number(e.target.value) || 0)))
                }
                title="Points awarded to the assignee (if a child) when this is ticked done"
              />
            </div>
          )}
          <button className="btn btn-primary" type="submit">
            <Plus size={16} /> Add
          </button>
        </form>
      )}

      {/* Edit dialog */}
      {editing && (
        <EditDialog
          editing={editing}
          setEditing={setEditing}
          users={users}
          categories={categories}
          onSave={saveEdit}
          isParent={isParent}
        />
      )}

      {filteredTodos.length === 0 ? (
        <p className="muted text-sm">
          {todos.length === 0
            ? "No to-dos yet."
            : "Nothing matches this filter."}
        </p>
      ) : (
        <>
        {/* Open to-dos */}
        {openTodos.length > 0 && (
        <ul className="space-y-2">
          {openTodos.map((t) => (
            <li
              key={t.id}
              ref={(el) => {
                // v5.0.6 — collect a ref per row so the ?open=<id> effect
                // above can scroll the right row into view when the user
                // arrives here from the calendar summary dialog.
                if (el) rowRefs.current.set(t.id, el);
                else rowRefs.current.delete(t.id);
              }}
              className="card p-3 flex items-center gap-3"
            >
              <button
                onClick={() => canEdit && toggle(t)}
                disabled={!canEdit}
                aria-label={t.done ? "Mark incomplete" : "Mark complete"}
                className={`w-6 h-6 rounded-md border flex items-center justify-center ${
                  t.done
                    ? "bg-green-500 text-white border-green-500"
                    : "border-[rgb(var(--border))]"
                }`}
              >
                {t.done && <Check size={14} />}
              </button>
              <div className="flex-1 min-w-0">
                <div
                  className={`font-medium ${
                    t.done ? "line-through muted" : ""
                  }`}
                >
                  {t.title}
                </div>
                <div className="flex items-center gap-2 text-xs muted flex-wrap mt-0.5">
                  {t.category && (
                    <span
                      className="chip"
                      style={
                        t.category.color
                          ? {
                              background: t.category.color + "33",
                              borderColor: t.category.color,
                            }
                          : undefined
                      }
                    >
                      <Tag size={12} />
                      {t.category.name}
                    </span>
                  )}
                  {t.assignee && (
                    <span
                      className="chip"
                      style={{
                        background: t.assignee.color + "33",
                        borderColor: t.assignee.color,
                      }}
                    >
                      {t.assignee.avatarEmoji} {t.assignee.name}
                    </span>
                  )}
                  {t.pointsReward > 0 && (
                    <span
                      className="chip text-amber-700 dark:text-amber-200"
                      title={
                        t.pointsAwardedTransactionId
                          ? "Points already awarded"
                          : t.assignee
                          ? `Earns ${t.pointsReward} pts when ${t.assignee.name} ticks this off`
                          : `Earns ${t.pointsReward} pts when a child assignee ticks this off`
                      }
                    >
                      <Sparkles size={12} />
                      {t.pointsReward} pts
                      {t.pointsAwardedTransactionId ? " · earned" : ""}
                    </span>
                  )}
                  {t.dueAt && (
                    <span>
                      Due{" "}
                      {new Date(t.dueAt).toLocaleString(undefined, {
                        day: "numeric",
                        month: "short",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                  )}
                  {t.recurrenceFrequency && (
                    <span
                      className="inline-flex items-center gap-1"
                      title="Recurring"
                    >
                      <Repeat size={12} />
                      {recurrenceSummary(
                        t.recurrenceFrequency,
                        t.recurrenceInterval ?? 1,
                      )}
                    </span>
                  )}
                  {t.showOnCalendar && (
                    <span
                      className="inline-flex items-center gap-1"
                      title="Shown on the calendar"
                    >
                      <CalendarPlus size={12} />
                      On calendar
                    </span>
                  )}
                  <span>Added by {t.createdBy.name}</span>
                </div>
              </div>
              {canEdit && (
                <>
                  <button
                    className="btn btn-ghost"
                    aria-label="Edit"
                    title="Edit"
                    onClick={() => beginEdit(t)}
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    className="btn btn-ghost text-red-500"
                    aria-label="Delete"
                    onClick={() => remove(t)}
                  >
                    <Trash2 size={16} />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
        )}

        {/* v4.7.16 — Completed section. Rendered as its own block with a
            divider header + an in-context "Clear all" button so ticked-off
            rows are obviously still around (just done). Before this users
            were perceiving ticked items as "cleared" because the API sorted
            them to the bottom of a single mixed list. */}
        {completedTodosInView.length > 0 && (
          <div className="mt-6">
            <div className="flex items-center justify-between gap-2 mb-2 pt-3 border-t border-[rgb(var(--border))]">
              <h3 className="text-sm font-semibold muted">
                Completed ({completedTodosInView.length})
              </h3>
              {canEdit && (
                <button
                  type="button"
                  onClick={clearCompleted}
                  className="btn btn-ghost btn-sm inline-flex items-center"
                  title={`Remove the ${completedCount} completed to-do${
                    completedCount === 1 ? "" : "s"
                  }`}
                >
                  <Eraser size={14} /> Clear all
                </button>
              )}
            </div>
            <ul className="space-y-2 opacity-70">
              {completedTodosInView.map((t) => (
                <li
                  key={t.id}
                  className="card p-3 flex items-center gap-3"
                >
                  <button
                    onClick={() => canEdit && toggle(t)}
                    disabled={!canEdit}
                    aria-label="Mark incomplete"
                    className="w-6 h-6 rounded-md border flex items-center justify-center bg-green-500 text-white border-green-500"
                  >
                    <Check size={14} />
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium line-through muted">
                      {t.title}
                    </div>
                    <div className="text-xs muted">
                      {t.assignee
                        ? `${t.assignee.avatarEmoji} ${t.assignee.name}`
                        : "Anyone"}
                      {t.category ? ` · ${t.category.name}` : ""}
                    </div>
                  </div>
                  {canEdit && (
                    <button
                      className="btn btn-ghost text-red-500"
                      aria-label="Delete"
                      onClick={() => remove(t)}
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        </>
      )}
    </div>
  );
}

function CategoryTab({
  label,
  count,
  color,
  active,
  onClick,
}: {
  label: string;
  count: number;
  color?: string | null;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`chip transition-colors ${
        active ? "ring-2 ring-offset-1 ring-violet-500" : ""
      }`}
      style={
        color
          ? { background: color + "33", borderColor: color }
          : undefined
      }
    >
      <span>{label}</span>
      <span className="muted text-[11px]">{count}</span>
    </button>
  );
}

function EditDialog({
  editing,
  setEditing,
  users,
  categories,
  onSave,
  isParent,
}: {
  editing: EditDraft;
  setEditing: (v: EditDraft | null) => void;
  users: UserMini[];
  categories: CategoryMini[];
  onSave: () => void;
  isParent: boolean;
}) {
  return (
    // v4.7.5 — wrapped layout so tall dialogs scroll cleanly in web mode.
    <div className="fixed inset-0 z-40 bg-black/50 overflow-y-auto">
      <div className="flex min-h-full items-start sm:items-center justify-center p-3 sm:p-4">
        <div className="card w-full max-w-lg p-4 sm:p-5 relative my-4 sm:my-8">
        <button
          onClick={() => setEditing(null)}
          className="absolute right-3 top-3 btn btn-ghost"
          aria-label="Close"
        >
          <X size={18} />
        </button>
        <h3 className="text-lg font-bold mb-4 pr-10">Edit To-Do</h3>
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium">Title</label>
            <input
              className="input mt-1"
              value={editing.title}
              autoFocus
              onChange={(e) =>
                setEditing({ ...editing, title: e.target.value })
              }
            />
          </div>
          <div>
            <label className="text-sm font-medium">Description</label>
            <textarea
              className="textarea mt-1"
              rows={2}
              value={editing.description}
              onChange={(e) =>
                setEditing({ ...editing, description: e.target.value })
              }
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">Assign</label>
              <select
                className="select mt-1"
                value={editing.assigneeId}
                onChange={(e) =>
                  setEditing({ ...editing, assigneeId: e.target.value })
                }
              >
                <option value="">Anyone</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.avatarEmoji} {u.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">Category</label>
              <select
                className="select mt-1"
                value={editing.categoryId}
                onChange={(e) =>
                  setEditing({ ...editing, categoryId: e.target.value })
                }
              >
                <option value="">— None —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">Due</label>
              <input
                type="datetime-local"
                className="input mt-1"
                value={editing.dueAt}
                onChange={(e) =>
                  setEditing({ ...editing, dueAt: e.target.value })
                }
              />
            </div>
            <div>
              <label className="text-sm font-medium">Priority</label>
              <select
                className="select mt-1"
                value={editing.priority}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    priority: Number(e.target.value) || 0,
                  })
                }
              >
                <option value={0}>Normal</option>
                <option value={1}>High</option>
                <option value={2}>Urgent</option>
              </select>
            </div>
          </div>

          {isParent && (
            <div>
              <label className="text-sm font-medium">Points reward</label>
              <input
                type="number"
                min={0}
                step={1}
                className="input mt-1"
                value={editing.pointsReward || ""}
                placeholder="0"
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    pointsReward: Math.max(
                      0,
                      Math.floor(Number(e.target.value) || 0),
                    ),
                  })
                }
              />
              <p className="text-xs muted mt-1">
                Points the assignee earns when this is ticked done. Only awarded
                when the assignee is a child.
              </p>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={editing.showOnCalendar}
              onChange={(e) =>
                setEditing({ ...editing, showOnCalendar: e.target.checked })
              }
            />
            <CalendarPlus size={14} className="muted" />
            Show on the calendar
            <span className="muted text-xs">(requires a due date)</span>
          </label>

          {/* Recurrence */}
          <div className="border rounded-xl p-3 space-y-2 bg-black/[0.02] dark:bg-white/[0.03]">
            <div className="flex items-center gap-2">
              <Repeat size={16} className="muted" />
              <label className="text-sm font-medium">Repeat</label>
              <select
                className="input ml-auto max-w-[180px]"
                value={editing.recurrenceFrequency ?? "NONE"}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "NONE") {
                    setEditing({
                      ...editing,
                      recurrenceFrequency: null,
                    });
                  } else {
                    setEditing({
                      ...editing,
                      recurrenceFrequency: v as RecurrenceFrequency,
                      recurrenceInterval: editing.recurrenceInterval || 1,
                    });
                  }
                }}
              >
                <option value="NONE">Does not repeat</option>
                <option value="DAILY">Daily</option>
                <option value="WEEKLY">Weekly</option>
                <option value="MONTHLY">Monthly</option>
                <option value="YEARLY">Yearly</option>
              </select>
            </div>

            {editing.recurrenceFrequency && (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-sm muted">Every</span>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    className="input w-20"
                    value={editing.recurrenceInterval}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        recurrenceInterval: Math.max(
                          1,
                          Number(e.target.value) || 1,
                        ),
                      })
                    }
                  />
                  <span className="text-sm muted">
                    {unitLabel(
                      editing.recurrenceFrequency,
                      editing.recurrenceInterval,
                    )}
                  </span>
                </div>

                {editing.recurrenceFrequency === "WEEKLY" && (
                  <div>
                    <div className="text-xs muted mb-1">On</div>
                    <div className="flex gap-1">
                      {WEEKDAY_LABELS.map((lbl, idx) => {
                        const on = editing.recurrenceByWeekday.includes(idx);
                        return (
                          <button
                            key={idx}
                            type="button"
                            className={`w-9 h-9 rounded-lg text-xs font-semibold border ${
                              on
                                ? "bg-violet-500 text-white border-violet-500"
                                : "bg-transparent border-black/10 dark:border-white/10"
                            }`}
                            onClick={() => {
                              const set = new Set(editing.recurrenceByWeekday);
                              if (set.has(idx)) set.delete(idx);
                              else set.add(idx);
                              setEditing({
                                ...editing,
                                recurrenceByWeekday: Array.from(set).sort(),
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
                    value={editing.recurrenceEndMode}
                    onChange={(e) => {
                      const v = e.target.value as EditDraft["recurrenceEndMode"];
                      setEditing({ ...editing, recurrenceEndMode: v });
                    }}
                  >
                    <option value="never">Never</option>
                    <option value="count">After…</option>
                    <option value="date">On date</option>
                  </select>
                  {editing.recurrenceEndMode === "count" && (
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        max={5000}
                        className="input w-24"
                        value={editing.recurrenceEndCount}
                        onChange={(e) =>
                          setEditing({
                            ...editing,
                            recurrenceEndCount: Math.max(
                              1,
                              Number(e.target.value) || 1,
                            ),
                          })
                        }
                      />
                      <span className="text-sm muted">occurrences</span>
                    </div>
                  )}
                  {editing.recurrenceEndMode === "date" && (
                    <input
                      type="date"
                      className="input"
                      value={editing.recurrenceEndDate}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          recurrenceEndDate: e.target.value,
                        })
                      }
                    />
                  )}
                </div>
              </>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button
            className="btn btn-secondary"
            onClick={() => setEditing(null)}
          >
            Cancel
          </button>
          <button className="btn btn-primary" onClick={onSave}>
            Save
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}

function toLocalInput(iso: string | Date): string {
  const d = new Date(iso);
  const pad = (n: number) => `${n}`.padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

function parseWeekdayList(s: string | null): number[] {
  if (!s) return [];
  return s
    .split(",")
    .map((p) => Number(p.trim()))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
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

function recurrenceSummary(freq: RecurrenceFrequency, interval: number) {
  if (interval === 1) {
    switch (freq) {
      case "DAILY":
        return "Daily";
      case "WEEKLY":
        return "Weekly";
      case "MONTHLY":
        return "Monthly";
      case "YEARLY":
        return "Yearly";
    }
  }
  return `Every ${interval} ${unitLabel(freq, interval)}`;
}
