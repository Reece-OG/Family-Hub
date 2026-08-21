"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import {
  addDays,
  addMonths,
  addWeeks,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import {
  CalendarDays,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Clock,
  Plus,
  Star,
} from "lucide-react";
import {
  EventDialog,
  type EventShape,
  type Me,
  type UserMini,
} from "./EventDialog";
import {
  CalendarItemDialog,
  type EventSummary,
  type TodoSummary,
} from "./CalendarItemDialog";
import {
  expandMany,
  parseByWeekday,
  type Occurrence,
  type RecurrenceFrequency,
  type RecurrenceRule,
} from "@/lib/recurrence";
import { eventDisplayBackground } from "@/lib/event-color";

type ApiEvent = {
  id: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string;
  allDay: boolean;
  location: string | null;
  color: string | null;
  starred: boolean;
  createdById: string;
  participants: { id: string; userId: string; user: UserMini }[];
  createdBy: UserMini;
  recurrenceFrequency: RecurrenceFrequency | null;
  recurrenceInterval: number | null;
  recurrenceByWeekday: string | null;
  recurrenceEndDate: string | null;
  recurrenceEndCount: number | null;
  reminders?: {
    id: string;
    minutesBefore: number;
    deliveryInApp: boolean;
    deliveryEmail: boolean;
  }[];
};

// Version of ApiEvent with Date objects instead of ISO strings, ready for
// the recurrence expander.
type ExpandedEvent = Omit<ApiEvent, "startAt" | "endAt"> & {
  startAt: Date;
  endAt: Date;
  recurrence: RecurrenceRule | null;
};

type Holiday = {
  id: string;
  date: string;
  // v4.7.2 — canonical YYYY-MM-DD string computed server-side from the UTC
  // date parts of `date`. Using this instead of re-parsing `date` on the
  // client avoids an off-by-one the other way for viewers east/west of UTC:
  // holidays are a calendar-day concept, not a timestamp, and this string
  // is the day the calendar cell should show.
  dateKey: string;
  name: string;
  localName: string | null;
  global: boolean;
};

// Format a local-midnight Date (as produced by date-fns startOfDay / startOfMonth
// / startOfWeek) as YYYY-MM-DD using LOCAL date parts. We deliberately avoid
// `toISOString()` here: it converts to UTC, which for anyone east of UTC
// (or west, after DST) shifts the date by a day and silently breaks holiday
// alignment, multi-day event buckets, and "today" highlighting.
function dayKey(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

// Todos the user has ticked "show on calendar" get expanded into ExpandedEvent
// rows with a synthetic `todo:` id prefix and rendered alongside real events.
// Clicking them is a no-op on the calendar — the user edits them in the
// to-dos tab. We keep the shape compatible so all existing renderers just
// work.
type ApiTodo = {
  id: string;
  title: string;
  description: string | null;
  dueAt: string | null;
  done: boolean;
  showOnCalendar: boolean;
  recurrenceFrequency: RecurrenceFrequency | null;
  recurrenceInterval: number | null;
  recurrenceByWeekday: string | null;
  recurrenceEndDate: string | null;
  recurrenceEndCount: number | null;
  createdBy: UserMini;
  assignee: UserMini | null;
  category: { id: string; name: string; color: string | null } | null;
};

type ViewMode = "month" | "week" | "day";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function CalendarView({
  me,
  weekStartsOn = 0,
}: {
  me: Me;
  weekStartsOn?: 0 | 1;
}) {
  const [view, setView] = useState<ViewMode>("month");
  const [cursor, setCursor] = useState<Date>(() => new Date());
  const [events, setEvents] = useState<ApiEvent[]>([]);
  const [users, setUsers] = useState<UserMini[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [calendarTodos, setCalendarTodos] = useState<ApiTodo[]>([]);
  const [todoColor, setTodoColor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EventShape | null>(null);

  // v5.0.6 — read-only "what is this?" summary shown when the user clicks an
  // event or to-do on the calendar. Before v5.0.6 a click opened the full
  // EventDialog editor (or, for to-dos, just fired an alert). The common
  // case is a glance, not an edit — so we open this summary first and only
  // flip into the editor when the user explicitly asks to edit.
  const [viewing, setViewing] = useState<EventSummary | TodoSummary | null>(null);
  const router = useRouter();

  // Range that defines what's visible / what we fetch
  const { rangeStart, rangeEnd } = useMemo(() => {
    if (view === "month") {
      const s = startOfWeek(startOfMonth(cursor), { weekStartsOn });
      const e = endOfWeek(endOfMonth(cursor), { weekStartsOn });
      return { rangeStart: s, rangeEnd: e };
    }
    if (view === "week") {
      return {
        rangeStart: startOfWeek(cursor, { weekStartsOn }),
        rangeEnd: endOfWeek(cursor, { weekStartsOn }),
      };
    }
    return { rangeStart: startOfDay(cursor), rangeEnd: endOfDay(cursor) };
  }, [view, cursor, weekStartsOn]);

  const load = useCallback(async () => {
    // v4.7.18 — keep existing data on screen during refreshes. See MenuView
    // for the full rationale. Initial useState(true) handles the first paint.
    try {
      const [ev, u, h, td, s] = await Promise.all([
        fetch(
          `/api/events?from=${rangeStart.toISOString()}&to=${rangeEnd.toISOString()}`,
        ).then((r) => r.json()),
        fetch(`/api/users`).then((r) => r.json()),
        fetch(
          `/api/holidays?from=${rangeStart.toISOString()}&to=${rangeEnd.toISOString()}`,
        ).then((r) => r.json()),
        fetch(`/api/todos`).then((r) => r.json()),
        fetch(`/api/settings`)
          .then((r) => (r.ok ? r.json() : { settings: null }))
          .catch(() => ({ settings: null })),
      ]);
      setEvents(ev.events || []);
      setUsers(u.users || []);
      setHolidays(h.holidays || []);
      const todos: ApiTodo[] = td.todos || [];
      // Only the ones the user asked to appear on the calendar and that
      // actually have an anchor date.
      setCalendarTodos(todos.filter((t) => t.showOnCalendar && t.dueAt));
      setTodoColor(s?.settings?.todoColor ?? null);
    } finally {
      setLoading(false);
    }
  }, [rangeStart, rangeEnd]);

  // v4.7.17 — auto-refresh on mount, tab focus, and a 60-s tick so a kiosk
  // sees new events others added without a manual reload.
  useAutoRefresh(load, { intervalMs: 60_000 });

  // Expand recurring events into concrete occurrences in the visible window.
  const occurrences = useMemo<Occurrence<ExpandedEvent>[]>(() => {
    const recurrable: ExpandedEvent[] = events.map((e) => {
      const r: RecurrenceRule | null = e.recurrenceFrequency
        ? {
            frequency: e.recurrenceFrequency,
            interval: e.recurrenceInterval ?? 1,
            byWeekday: parseByWeekday(e.recurrenceByWeekday),
            endDate: e.recurrenceEndDate ? new Date(e.recurrenceEndDate) : null,
            endCount: e.recurrenceEndCount ?? null,
          }
        : null;
      return {
        ...e,
        startAt: new Date(e.startAt),
        endAt: new Date(e.endAt),
        recurrence: r,
      };
    });
    const eventOccs = expandMany(recurrable, rangeStart, rangeEnd);

    // Synthesise ExpandedEvent rows out of calendar-flagged todos so they
    // participate in the same recurrence expansion + grouping pipeline.
    const fallbackTodoColor = todoColor ?? "#f59e0b"; // amber by default
    const todoEvents: ExpandedEvent[] = calendarTodos.map((t) => {
      const due = new Date(t.dueAt!);
      const end = new Date(due.getTime() + 60 * 60 * 1000);
      const r: RecurrenceRule | null = t.recurrenceFrequency
        ? {
            frequency: t.recurrenceFrequency,
            interval: t.recurrenceInterval ?? 1,
            byWeekday: parseByWeekday(t.recurrenceByWeekday),
            endDate: t.recurrenceEndDate ? new Date(t.recurrenceEndDate) : null,
            endCount: t.recurrenceEndCount ?? null,
          }
        : null;
      const chipColor =
        t.category?.color || t.assignee?.color || fallbackTodoColor;
      // Prefix "✓" gives the chip a visual marker that it's a to-do.
      return {
        id: `todo:${t.id}`,
        title: `✓ ${t.title}`,
        description: t.description,
        startAt: due,
        endAt: end,
        allDay: false,
        location: null,
        color: chipColor,
        starred: false,
        createdById: t.createdBy.id,
        createdBy: t.createdBy,
        participants: t.assignee
          ? [{ id: `todo-p:${t.id}`, userId: t.assignee.id, user: t.assignee }]
          : [],
        recurrenceFrequency: t.recurrenceFrequency,
        recurrenceInterval: t.recurrenceInterval,
        recurrenceByWeekday: t.recurrenceByWeekday,
        recurrenceEndDate: t.recurrenceEndDate,
        recurrenceEndCount: t.recurrenceEndCount,
        reminders: [],
        recurrence: r,
      };
    });
    const todoOccs = expandMany(todoEvents, rangeStart, rangeEnd);

    return [...eventOccs, ...todoOccs];
  }, [events, calendarTodos, todoColor, rangeStart, rangeEnd]);

  const occurrencesByDay = useMemo(() => {
    const map = new Map<string, typeof occurrences>();
    for (const occ of occurrences) {
      // An occurrence can span multiple days; push it into every day it covers.
      let d = startOfDay(occ.occurrenceStart);
      const last = startOfDay(occ.occurrenceEnd);
      while (d <= last) {
        const key = dayKey(d);
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(occ);
        d = addDays(d, 1);
      }
    }
    return map;
  }, [occurrences]);

  const holidaysByDay = useMemo(() => {
    const map = new Map<string, Holiday[]>();
    for (const h of holidays) {
      // h.dateKey is the server-computed YYYY-MM-DD — use it directly so
      // we don't re-introduce the UTC-vs-local shift that used to move
      // Anzac Day to April 26 in Sydney and April 24 in Los Angeles.
      if (!map.has(h.dateKey)) map.set(h.dateKey, []);
      map.get(h.dateKey)!.push(h);
    }
    return map;
  }, [holidays]);

  function openNew(day?: Date) {
    const base = day ?? new Date();
    const startAt = new Date(base);
    startAt.setHours(9, 0, 0, 0);
    const endAt = new Date(base);
    endAt.setHours(10, 0, 0, 0);
    setEditing({
      title: "",
      description: "",
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      allDay: false,
      location: "",
      color: "#7c3aed",
      starred: false,
      participants: [{ userId: me.id }],
      recurrence: null,
      reminders: [],
    });
  }

  // v5.0.6 — first click now opens the summary (see the `viewing` state
  // above). The old direct-to-editor behaviour is preserved for the "Edit"
  // button inside the summary via editEvent()/editTodo() below.
  //
  // occStart/occEnd are the specific instance the user clicked. Passing
  // them through matters for recurring rows so a Wednesday click on a
  // weekly-recurring meeting shows "Wed 3pm" — not the row's first-ever
  // startAt from months ago.
  function openExistingById(id: string, occStart: Date, occEnd: Date) {
    if (id.startsWith("todo:")) {
      const todoId = id.slice("todo:".length);
      const t = calendarTodos.find((x) => x.id === todoId);
      if (!t) return;
      setViewing({
        kind: "todo",
        id: t.id,
        title: t.title,
        description: t.description,
        dueAt: t.dueAt ? new Date(t.dueAt) : null,
        done: t.done,
        assignee: t.assignee
          ? {
              id: t.assignee.id,
              name: t.assignee.name,
              color: t.assignee.color,
              avatarEmoji: t.assignee.avatarEmoji,
            }
          : null,
        category: t.category,
        recurrence: t.recurrenceFrequency
          ? {
              frequency: t.recurrenceFrequency,
              interval: t.recurrenceInterval ?? 1,
              byWeekday: parseByWeekday(t.recurrenceByWeekday),
              endDate: t.recurrenceEndDate,
              endCount: t.recurrenceEndCount,
            }
          : null,
      });
      return;
    }
    const ev = events.find((e) => e.id === id);
    if (!ev) return;
    setViewing({
      kind: "event",
      id: ev.id,
      title: ev.title,
      description: ev.description,
      occurrenceStart: occStart,
      occurrenceEnd: occEnd,
      allDay: ev.allDay,
      location: ev.location,
      color: ev.color,
      starred: ev.starred,
      participants: ev.participants.map((p) => ({
        id: p.id,
        name: p.user.name,
        color: p.user.color,
        avatarEmoji: p.user.avatarEmoji,
      })),
      recurrence: ev.recurrenceFrequency
        ? {
            frequency: ev.recurrenceFrequency,
            interval: ev.recurrenceInterval ?? 1,
            byWeekday: parseByWeekday(ev.recurrenceByWeekday),
            endDate: ev.recurrenceEndDate,
            endCount: ev.recurrenceEndCount,
          }
        : null,
      remindersCount: ev.reminders?.length ?? 0,
    });
  }

  // v5.0.6 — invoked by the summary dialog's Edit button for events. Closes
  // the summary and hands the same row to the full EventDialog editor,
  // preserving the pre-v5.0.6 edit experience.
  function editFromSummary() {
    if (!viewing) return;
    if (viewing.kind === "todo") {
      // To-do edits happen on the To-Dos tab so we don't have to duplicate
      // the whole todo editor here. The ?open= param is picked up by
      // TodoList to scroll the row into view and open it for editing.
      const id = viewing.id;
      setViewing(null);
      router.push(`/todos?open=${encodeURIComponent(id)}`);
      return;
    }
    const ev = events.find((e) => e.id === viewing.id);
    setViewing(null);
    if (ev) openExisting(ev);
  }

  // v5.0.6 — invoked by the summary dialog's Delete button (events only).
  // Mirrors the delete-and-refresh flow that used to live in the EventDialog
  // path so parents don't have to enter the editor just to remove a row.
  async function deleteFromSummary() {
    if (!viewing || viewing.kind !== "event") return;
    if (!confirm("Delete this event? All repeats will also be removed.")) return;
    const id = viewing.id;
    await fetch(`/api/events/${id}`, { method: "DELETE" });
    setViewing(null);
    await load();
  }

  function openExisting(ev: ApiEvent) {
    setEditing({
      id: ev.id,
      title: ev.title,
      description: ev.description,
      startAt: ev.startAt,
      endAt: ev.endAt,
      allDay: ev.allDay,
      location: ev.location,
      color: ev.color,
      starred: ev.starred,
      createdById: ev.createdById,
      participants: ev.participants.map((p) => ({ userId: p.userId })),
      recurrence: ev.recurrenceFrequency
        ? {
            frequency: ev.recurrenceFrequency,
            interval: ev.recurrenceInterval ?? 1,
            byWeekday: parseByWeekday(ev.recurrenceByWeekday),
            endDate: ev.recurrenceEndDate,
            endCount: ev.recurrenceEndCount,
          }
        : null,
      reminders: (ev.reminders ?? []).map((r) => ({
        minutesBefore: r.minutesBefore,
        deliveryInApp: r.deliveryInApp,
        deliveryEmail: r.deliveryEmail,
      })),
    });
  }

  async function save() {
    if (!editing) return;
    const body: Record<string, unknown> = {
      title: editing.title,
      description: editing.description,
      startAt: editing.startAt,
      endAt: editing.endAt,
      allDay: editing.allDay ?? false,
      location: editing.location,
      color: editing.color,
      starred: editing.starred ?? false,
      participantIds: (editing.participants || []).map((p) => p.userId),
      recurrence: editing.recurrence ?? null,
      reminders: editing.reminders ?? [],
    };
    const id = editing.id;
    const res = await fetch(id ? `/api/events/${id}` : "/api/events", {
      method: id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      setEditing(null);
      await load();
    } else {
      const data = await res.json();
      alert(data.error || "Could not save event");
    }
  }

  async function remove() {
    const id = editing?.id;
    if (!id) return;
    if (!confirm("Delete this event? All repeats will also be removed.")) return;
    await fetch(`/api/events/${id}`, { method: "DELETE" });
    setEditing(null);
    await load();
  }

  function shift(direction: -1 | 1) {
    if (view === "month") setCursor((c) => addMonths(c, direction));
    else if (view === "week") setCursor((c) => addWeeks(c, direction));
    else setCursor((c) => addDays(c, direction));
  }

  const headerLabel = useMemo(() => {
    if (view === "month") return format(cursor, "MMMM yyyy");
    if (view === "week") {
      const s = startOfWeek(cursor, { weekStartsOn });
      const e = endOfWeek(cursor, { weekStartsOn });
      return `${format(s, "MMM d")} – ${format(e, "MMM d, yyyy")}`;
    }
    return format(cursor, "EEEE, MMMM d, yyyy");
  }, [view, cursor, weekStartsOn]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
          <button
            className="inline-flex items-center gap-1 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface-2))] text-[rgb(var(--text))] px-2.5 py-1.5 text-xs sm:px-3 sm:py-2 sm:text-sm font-semibold"
            onClick={() => shift(-1)}
            aria-label="Previous"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            className="inline-flex items-center gap-1 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface-2))] text-[rgb(var(--text))] px-2.5 py-1.5 text-xs sm:px-3 sm:py-2 sm:text-sm font-semibold"
            onClick={() => setCursor(new Date())}
          >
            Today
          </button>
          <button
            className="inline-flex items-center gap-1 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface-2))] text-[rgb(var(--text))] px-2.5 py-1.5 text-xs sm:px-3 sm:py-2 sm:text-sm font-semibold"
            onClick={() => shift(1)}
            aria-label="Next"
          >
            <ChevronRight size={16} />
          </button>
          <h2 className="text-base sm:text-xl font-bold ml-1 sm:ml-2">{headerLabel}</h2>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-xl border border-black/10 dark:border-white/10 overflow-hidden">
            <button
              className={`px-2.5 py-1.5 text-xs sm:px-3 sm:py-2 sm:text-sm flex items-center gap-1 ${
                view === "day" ? "bg-violet-500 text-white" : ""
              }`}
              onClick={() => setView("day")}
              title="Day view"
            >
              <Clock size={14} /> Day
            </button>
            <button
              className={`px-2.5 py-1.5 text-xs sm:px-3 sm:py-2 sm:text-sm flex items-center gap-1 border-l border-black/10 dark:border-white/10 ${
                view === "week" ? "bg-violet-500 text-white" : ""
              }`}
              onClick={() => setView("week")}
              title="Week view"
            >
              <CalendarRange size={14} /> Week
            </button>
            <button
              className={`px-2.5 py-1.5 text-xs sm:px-3 sm:py-2 sm:text-sm flex items-center gap-1 border-l border-black/10 dark:border-white/10 ${
                view === "month" ? "bg-violet-500 text-white" : ""
              }`}
              onClick={() => setView("month")}
              title="Month view"
            >
              <CalendarDays size={14} /> Month
            </button>
          </div>
          {me.canEdit && (
            // Sized to match the Day/Week/Month tab group so the whole
            // toolbar sits on the same visual line in PWA mode where
            // horizontal space is tight.
            <button
              className="inline-flex items-center gap-1 rounded-xl bg-violet-500 text-white px-2.5 py-1.5 text-xs sm:px-3 sm:py-2 sm:text-sm font-semibold hover:brightness-105"
              onClick={() => openNew()}
            >
              <Plus size={14} /> New event
            </button>
          )}
        </div>
      </div>

      {view === "month" && (
        <MonthView
          cursor={cursor}
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
          occurrencesByDay={occurrencesByDay}
          holidaysByDay={holidaysByDay}
          onOpenNew={openNew}
          onOpenExistingById={openExistingById}
          canEdit={me.canEdit}
          weekStartsOn={weekStartsOn}
        />
      )}

      {view === "week" && (
        <TimeGridView
          days={daysBetween(rangeStart, rangeEnd)}
          occurrencesByDay={occurrencesByDay}
          holidaysByDay={holidaysByDay}
          onOpenNew={openNew}
          onOpenExistingById={openExistingById}
          canEdit={me.canEdit}
        />
      )}

      {view === "day" && (
        <TimeGridView
          days={[cursor]}
          occurrencesByDay={occurrencesByDay}
          holidaysByDay={holidaysByDay}
          onOpenNew={openNew}
          onOpenExistingById={openExistingById}
          canEdit={me.canEdit}
        />
      )}

      {loading && <p className="muted mt-2 text-sm">Loading events…</p>}

      {editing && (
        <EventDialog
          me={me}
          users={users}
          value={editing}
          onChange={setEditing}
          onClose={() => setEditing(null)}
          onSave={save}
          onDelete={editing.id ? remove : undefined}
        />
      )}

      {/* v5.0.6 — read-only "what is this?" panel that opens on first click.
          The Edit button here is what flips into the EventDialog above (or
          navigates to /todos for to-dos). */}
      {viewing && (
        <CalendarItemDialog
          item={viewing}
          canEdit={me.canEdit}
          onClose={() => setViewing(null)}
          onEdit={editFromSummary}
          onDelete={viewing.kind === "event" ? deleteFromSummary : undefined}
        />
      )}
    </div>
  );
}

// ---------- Month view ----------

function MonthView({
  cursor,
  rangeStart,
  rangeEnd,
  occurrencesByDay,
  holidaysByDay,
  onOpenNew,
  onOpenExistingById,
  canEdit,
  weekStartsOn,
}: {
  cursor: Date;
  rangeStart: Date;
  rangeEnd: Date;
  occurrencesByDay: Map<string, Occurrence<ExpandedEvent>[]>;
  holidaysByDay: Map<string, Holiday[]>;
  onOpenNew: (d: Date) => void;
  onOpenExistingById: (id: string, occStart: Date, occEnd: Date) => void;
  canEdit: boolean;
  weekStartsOn: 0 | 1;
}) {
  const days = useMemo(() => daysBetween(rangeStart, rangeEnd), [rangeStart, rangeEnd]);
  const headerDays = useMemo(() => {
    // Rotate so the row label matches the actual first column of the grid.
    return WEEKDAYS.slice(weekStartsOn).concat(WEEKDAYS.slice(0, weekStartsOn));
  }, [weekStartsOn]);
  return (
    <>
      <div className="grid grid-cols-7 gap-px mb-1 text-xs font-semibold muted">
        {headerDays.map((d) => (
          <div key={d} className="px-2">
            {d}
          </div>
        ))}
      </div>
      <div className="cal-grid">
        {days.map((d) => {
          const inMonth = isSameMonth(d, cursor);
          const today = isSameDay(d, new Date());
          const key = dayKey(d);
          const occs = occurrencesByDay.get(key) || [];
          const hols = holidaysByDay.get(key) || [];
          return (
            <div
              key={d.toISOString()}
              className={`cal-cell ${inMonth ? "" : "not-month"} ${today ? "today" : ""}`}
              onDoubleClick={() => canEdit && onOpenNew(d)}
            >
              <div className="flex items-center justify-between">
                <span className="daynum text-xs font-bold">{format(d, "d")}</span>
                {hols.length > 0 && (
                  <span
                    className="text-[9px] font-semibold px-1.5 rounded-full bg-rose-500/20 text-rose-700 dark:text-rose-300 truncate max-w-[80%]"
                    title={hols.map((h) => h.name).join(", ")}
                  >
                    {hols[0].name}
                  </span>
                )}
              </div>
              <div className="mt-1 space-y-0.5">
                {occs.slice(0, 3).map((occ) => {
                  const e = occ.event;
                  return (
                    <button
                      key={occ.instanceKey}
                      type="button"
                      className="cal-event w-full text-left flex items-center gap-1"
                      style={{ background: eventDisplayBackground(e) }}
                      onClick={() =>
                        onOpenExistingById(e.id, occ.occurrenceStart, occ.occurrenceEnd)
                      }
                      title={e.title}
                    >
                      {e.starred && <Star size={10} className="fill-yellow-300 text-yellow-300 shrink-0" />}
                      <span className="truncate">
                        {e.allDay ? "" : `${format(occ.occurrenceStart, "HH:mm")} `}
                        {e.title}
                      </span>
                    </button>
                  );
                })}
                {occs.length > 3 && (
                  <div className="text-[10px] muted">+{occs.length - 3} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ---------- Week & Day (time-grid) view ----------

function TimeGridView({
  days,
  occurrencesByDay,
  holidaysByDay,
  onOpenNew,
  onOpenExistingById,
  canEdit,
}: {
  days: Date[];
  occurrencesByDay: Map<string, Occurrence<ExpandedEvent>[]>;
  holidaysByDay: Map<string, Holiday[]>;
  onOpenNew: (d: Date) => void;
  onOpenExistingById: (id: string, occStart: Date, occEnd: Date) => void;
  canEdit: boolean;
}) {
  const HOURS = Array.from({ length: 24 }, (_, i) => i);
  const HOUR_HEIGHT = 48; // px
  const totalHeight = HOURS.length * HOUR_HEIGHT;
  const now = new Date();

  return (
    <div className="border border-black/10 dark:border-white/10 rounded-2xl overflow-hidden">
      {/* Header row with day names */}
      <div
        className="grid border-b border-black/10 dark:border-white/10"
        style={{ gridTemplateColumns: `64px repeat(${days.length}, 1fr)` }}
      >
        <div />
        {days.map((d) => {
          const isToday = isSameDay(d, now);
          const hols = holidaysByDay.get(dayKey(d)) || [];
          return (
            <div
              key={d.toISOString()}
              className={`p-2 text-center border-l border-black/10 dark:border-white/10 ${
                isToday ? "bg-violet-500/10" : ""
              }`}
            >
              <div className="text-xs muted">{format(d, "EEE")}</div>
              <div className="text-lg font-bold">{format(d, "d")}</div>
              {hols.length > 0 && (
                <div
                  className="text-[10px] font-semibold mt-1 truncate"
                  style={{ color: "#e11d48" }}
                  title={hols.map((h) => h.name).join(", ")}
                >
                  {hols[0].name}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* All-day row. Each day-cell is a flex-col so multiple all-day events
          stack top-to-bottom rather than being squeezed onto one line — this
          matters on mobile where the 7 columns are very narrow. */}
      <div
        className="grid border-b border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.03]"
        style={{ gridTemplateColumns: `64px repeat(${days.length}, 1fr)` }}
      >
        <div className="p-1 text-[10px] muted text-right pr-2">all-day</div>
        {days.map((d) => {
          const key = dayKey(d);
          const all = (occurrencesByDay.get(key) || []).filter((o) => o.event.allDay);
          return (
            <div
              key={d.toISOString()}
              className="border-l border-black/10 dark:border-white/10 p-1 min-h-[36px] flex flex-col gap-0.5"
              onDoubleClick={() => canEdit && onOpenNew(d)}
            >
              {all.map((occ) => (
                <button
                  key={occ.instanceKey}
                  type="button"
                  className="cal-event w-full text-left flex items-center gap-1 shrink-0"
                  style={{ background: eventDisplayBackground(occ.event) }}
                  onClick={() =>
                    onOpenExistingById(
                      occ.event.id,
                      occ.occurrenceStart,
                      occ.occurrenceEnd,
                    )
                  }
                >
                  {occ.event.starred && (
                    <Star
                      size={10}
                      className="fill-yellow-300 text-yellow-300 shrink-0"
                    />
                  )}
                  <span className="truncate">{occ.event.title}</span>
                </button>
              ))}
            </div>
          );
        })}
      </div>

      {/* Time grid */}
      <div
        className="grid relative"
        style={{
          gridTemplateColumns: `64px repeat(${days.length}, 1fr)`,
          height: totalHeight,
        }}
      >
        {/* Hour labels + background rows */}
        <div className="relative">
          {HOURS.map((h) => (
            <div
              key={h}
              className="border-t border-black/5 dark:border-white/5 text-[10px] muted text-right pr-1"
              style={{ height: HOUR_HEIGHT }}
            >
              {h === 0 ? "" : `${h.toString().padStart(2, "0")}:00`}
            </div>
          ))}
        </div>

        {/* Day columns */}
        {days.map((d) => {
          const key = dayKey(d);
          const timed = (occurrencesByDay.get(key) || []).filter(
            (o) => !o.event.allDay,
          );
          const isToday = isSameDay(d, now);
          const nowMinutes = now.getHours() * 60 + now.getMinutes();
          return (
            <div
              key={d.toISOString()}
              className="relative border-l border-black/10 dark:border-white/10"
              onDoubleClick={(e) => {
                if (!canEdit) return;
                const bounds = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                const y = e.clientY - bounds.top;
                const minute = Math.max(
                  0,
                  Math.min(1439, Math.round((y / bounds.height) * 1440)),
                );
                const start = new Date(d);
                start.setHours(Math.floor(minute / 60), Math.floor(minute % 60 / 15) * 15, 0, 0);
                onOpenNew(start);
              }}
            >
              {HOURS.map((h) => (
                <div
                  key={h}
                  className="border-t border-black/5 dark:border-white/5"
                  style={{ height: HOUR_HEIGHT }}
                />
              ))}
              {/* Now line */}
              {isToday && (
                <div
                  className="absolute left-0 right-0 border-t-2 border-rose-500 z-10 pointer-events-none"
                  style={{ top: (nowMinutes / 1440) * totalHeight }}
                />
              )}
              {timed.map((occ) => {
                const s = occ.occurrenceStart;
                const e = occ.occurrenceEnd;
                const clampedStart = s < startOfDay(d) ? startOfDay(d) : s;
                const clampedEnd = e > endOfDay(d) ? endOfDay(d) : e;
                const startMin = clampedStart.getHours() * 60 + clampedStart.getMinutes();
                const endMin = clampedEnd.getHours() * 60 + clampedEnd.getMinutes() || 1440;
                const top = (startMin / 1440) * totalHeight;
                const height = Math.max(18, ((endMin - startMin) / 1440) * totalHeight - 2);
                return (
                  <button
                    key={occ.instanceKey}
                    type="button"
                    className="absolute left-1 right-1 rounded-lg text-[11px] text-white p-1 text-left shadow-sm overflow-hidden flex items-start gap-1"
                    style={{
                      top,
                      height,
                      background: eventDisplayBackground(occ.event),
                    }}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onOpenExistingById(
                        occ.event.id,
                        occ.occurrenceStart,
                        occ.occurrenceEnd,
                      );
                    }}
                    onDoubleClick={(ev) => ev.stopPropagation()}
                    title={occ.event.title}
                  >
                    {occ.event.starred && (
                      <Star size={10} className="fill-yellow-300 text-yellow-300 shrink-0 mt-[1px]" />
                    )}
                    <span>
                      <span className="font-semibold">{occ.event.title}</span>
                      <br />
                      <span className="opacity-80">
                        {format(occ.occurrenceStart, "HH:mm")}–
                        {format(occ.occurrenceEnd, "HH:mm")}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- helpers ----------

function daysBetween(start: Date, end: Date): Date[] {
  const out: Date[] = [];
  let d = startOfDay(start);
  const last = startOfDay(end);
  while (d <= last) {
    out.push(d);
    d = addDays(d, 1);
  }
  return out;
}
