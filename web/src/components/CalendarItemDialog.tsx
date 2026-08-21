"use client";

// v5.0.6 — read-only summary dialog for calendar clicks.
//
// Before v5.0.6 the calendar opened the full EventDialog editor the moment
// you clicked any event, and clicking a to-do just popped a "Edit this from
// the To-Dos tab" alert. That's fine for someone who wants to modify the
// row, but the common case on a family calendar is a quick "what's this
// again?" glance. Dropping straight into the editor is heavy, easy to
// accidentally mutate, and confusing on a kiosk where the user only wants
// to check what's on.
//
// This component shows a small read-only card summarising the item, with
// two exits:
//
//   • Close — dismiss without doing anything (the common case).
//   • Edit — for events, flip the caller into the existing EventDialog for
//     the same row. For to-dos, take the user to the To-Dos tab with
//     ?open=<id> so the row is scrolled into view and opened for editing.
//   • Delete — events only, and only when the caller says the current
//     user has permission. Mirrors the delete affordance in EventDialog
//     so parents don't have to enter the editor just to remove something.
//
// The dialog is deliberately dumb: it receives fully-prepared display
// strings and callbacks from CalendarView. No fetching, no permission
// checks — the parent knows more than we do.

import { format } from "date-fns";
import {
  X,
  Pencil,
  Trash2,
  Star,
  Repeat,
  Bell,
  MapPin,
  Clock,
  User as UserIcon,
  Tag,
  CheckCircle2,
  Circle,
  CalendarDays,
  ArrowRight,
} from "lucide-react";
import type { RecurrenceFrequency } from "@/lib/recurrence";

// Kept in sync with CalendarView's ApiEvent / ApiTodo but narrowed to what
// the summary actually renders. Duplicating the shape here (rather than
// importing) keeps CalendarView's internal types from leaking out to any
// future consumer of this component.
export type SummaryUser = {
  id: string;
  name: string;
  color: string;
  avatarEmoji: string;
};

export type EventSummary = {
  kind: "event";
  id: string;
  title: string;
  description: string | null;
  // Absolute occurrence timestamps for the specific instance clicked, NOT
  // the row's first-ever startAt — matters for weekly-recurring events
  // where "next occurrence" is the useful number to show.
  occurrenceStart: Date;
  occurrenceEnd: Date;
  allDay: boolean;
  location: string | null;
  color: string | null;
  starred: boolean;
  participants: SummaryUser[];
  recurrence: {
    frequency: RecurrenceFrequency;
    interval: number;
    byWeekday: number[] | null | undefined;
    endDate: string | null;
    endCount: number | null;
  } | null;
  remindersCount: number;
};

export type TodoSummary = {
  kind: "todo";
  id: string;
  title: string;
  description: string | null;
  dueAt: Date | null;
  done: boolean;
  assignee: SummaryUser | null;
  category: { id: string; name: string; color: string | null } | null;
  recurrence: {
    frequency: RecurrenceFrequency;
    interval: number;
    byWeekday: number[] | null | undefined;
    endDate: string | null;
    endCount: number | null;
  } | null;
};

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatRange(start: Date, end: Date, allDay: boolean, timeZone?: string) {
  const dOpts: Intl.DateTimeFormatOptions = {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: timeZone || undefined,
  };
  const tOpts: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timeZone || undefined,
  };
  if (allDay) {
    const sameDay =
      start.toDateString() === end.toDateString() ||
      end.getTime() - start.getTime() <= 24 * 60 * 60 * 1000;
    if (sameDay) return `${start.toLocaleDateString(undefined, dOpts)} · All day`;
    return `${start.toLocaleDateString(undefined, dOpts)} → ${end.toLocaleDateString(undefined, dOpts)}`;
  }
  const sameDay = start.toDateString() === end.toDateString();
  if (sameDay) {
    return `${start.toLocaleDateString(undefined, dOpts)} · ${start.toLocaleTimeString(
      undefined,
      tOpts,
    )}–${end.toLocaleTimeString(undefined, tOpts)}`;
  }
  return `${start.toLocaleString(undefined, { ...dOpts, ...tOpts })} → ${end.toLocaleString(
    undefined,
    { ...dOpts, ...tOpts },
  )}`;
}

function formatRecurrence(
  rule: {
    frequency: RecurrenceFrequency;
    interval: number;
    byWeekday: number[] | null | undefined;
    endDate: string | null;
    endCount: number | null;
  } | null,
): string | null {
  if (!rule) return null;
  const every = rule.interval > 1 ? `Every ${rule.interval} ` : "Every ";
  let base: string;
  switch (rule.frequency) {
    case "DAILY":
      base = `${every}${rule.interval > 1 ? "days" : "day"}`;
      break;
    case "WEEKLY": {
      const days = (rule.byWeekday || []).map((d) => WEEKDAY_NAMES[d]).join(", ");
      base = `${every}${rule.interval > 1 ? "weeks" : "week"}${days ? ` on ${days}` : ""}`;
      break;
    }
    case "MONTHLY":
      base = `${every}${rule.interval > 1 ? "months" : "month"}`;
      break;
    case "YEARLY":
      base = `${every}${rule.interval > 1 ? "years" : "year"}`;
      break;
    default:
      base = "Repeats";
  }
  if (rule.endDate) {
    const d = new Date(rule.endDate);
    base += ` · ends ${format(d, "d MMM yyyy")}`;
  } else if (rule.endCount) {
    base += ` · ${rule.endCount} times`;
  }
  return base;
}

export function CalendarItemDialog({
  item,
  canEdit,
  onClose,
  onEdit,
  onDelete,
  timeZone,
}: {
  item: EventSummary | TodoSummary;
  canEdit: boolean;
  onClose: () => void;
  // For events: opens EventDialog on this event. For to-dos: navigates to
  // /todos?open=<id>.
  onEdit: () => void;
  // Only meaningful for events. TodoSummary always ignores this — deletion
  // stays in the To-Dos tab to avoid a stray tap wiping a chore from the
  // wrong screen.
  onDelete?: () => void;
  timeZone?: string;
}) {
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

          {item.kind === "event" ? (
            <EventBody item={item} timeZone={timeZone} />
          ) : (
            <TodoBody item={item} />
          )}

          <div className="flex items-center justify-between gap-2 mt-5 pt-3 border-t border-[rgb(var(--border))]">
            {/* Delete lives on the left for events (destructive left, primary
                right — standard convention). To-dos never show it here. */}
            <div>
              {item.kind === "event" && canEdit && onDelete && (
                <button
                  type="button"
                  className="btn btn-ghost text-rose-600 hover:text-rose-700"
                  onClick={onDelete}
                >
                  <Trash2 size={16} />
                  <span className="ml-1">Delete</span>
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Close
              </button>
              {canEdit && (
                <button type="button" className="btn btn-primary" onClick={onEdit}>
                  {item.kind === "todo" ? (
                    <>
                      Open in To-Dos <ArrowRight size={16} className="ml-1" />
                    </>
                  ) : (
                    <>
                      <Pencil size={16} />
                      <span className="ml-1">Edit</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function EventBody({ item, timeZone }: { item: EventSummary; timeZone?: string }) {
  const recurrenceText = formatRecurrence(item.recurrence);
  return (
    <>
      <div className="flex items-start gap-2 mb-3 pr-8">
        <div
          className="w-2 self-stretch rounded-full shrink-0"
          style={{ background: item.color || "#7c3aed" }}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {item.starred && (
              <Star size={16} className="fill-yellow-400 text-yellow-500 shrink-0" />
            )}
            <h3 className="text-lg font-bold truncate">{item.title || "(untitled)"}</h3>
          </div>
          <div className="text-xs muted mt-0.5">Event</div>
        </div>
      </div>

      <ul className="space-y-2 text-sm">
        <SummaryRow icon={<Clock size={14} />}>
          {formatRange(item.occurrenceStart, item.occurrenceEnd, item.allDay, timeZone)}
        </SummaryRow>
        {recurrenceText && (
          <SummaryRow icon={<Repeat size={14} />}>{recurrenceText}</SummaryRow>
        )}
        {item.location && (
          <SummaryRow icon={<MapPin size={14} />}>{item.location}</SummaryRow>
        )}
        {item.participants.length > 0 && (
          <SummaryRow icon={<UserIcon size={14} />}>
            <div className="flex flex-wrap items-center gap-1">
              {item.participants.map((p) => (
                <span
                  key={p.id}
                  className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
                  style={{
                    background: p.color + "22",
                    borderColor: p.color,
                  }}
                >
                  <span>{p.avatarEmoji}</span>
                  <span>{p.name}</span>
                </span>
              ))}
            </div>
          </SummaryRow>
        )}
        {item.remindersCount > 0 && (
          <SummaryRow icon={<Bell size={14} />}>
            {item.remindersCount} reminder{item.remindersCount === 1 ? "" : "s"}
          </SummaryRow>
        )}
        {item.description && (
          <SummaryRow icon={<CalendarDays size={14} />}>
            <span className="whitespace-pre-wrap">{item.description}</span>
          </SummaryRow>
        )}
      </ul>
    </>
  );
}

function TodoBody({ item }: { item: TodoSummary }) {
  const recurrenceText = formatRecurrence(item.recurrence);
  return (
    <>
      <div className="flex items-start gap-2 mb-3 pr-8">
        <div
          className="w-2 self-stretch rounded-full shrink-0"
          style={{ background: item.category?.color || item.assignee?.color || "#f59e0b" }}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {item.done ? (
              <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />
            ) : (
              <Circle size={16} className="text-slate-400 shrink-0" />
            )}
            <h3
              className={`text-lg font-bold truncate ${
                item.done ? "line-through opacity-60" : ""
              }`}
            >
              {item.title || "(untitled)"}
            </h3>
          </div>
          <div className="text-xs muted mt-0.5">
            To-do · {item.done ? "Done" : "Open"}
          </div>
        </div>
      </div>

      <ul className="space-y-2 text-sm">
        {item.dueAt && (
          <SummaryRow icon={<Clock size={14} />}>
            Due {item.dueAt.toLocaleString(undefined, {
              weekday: "short",
              day: "numeric",
              month: "short",
              hour: "numeric",
              minute: "2-digit",
            })}
          </SummaryRow>
        )}
        {recurrenceText && (
          <SummaryRow icon={<Repeat size={14} />}>{recurrenceText}</SummaryRow>
        )}
        {item.assignee && (
          <SummaryRow icon={<UserIcon size={14} />}>
            <span
              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
              style={{
                background: item.assignee.color + "22",
                borderColor: item.assignee.color,
              }}
            >
              <span>{item.assignee.avatarEmoji}</span>
              <span>{item.assignee.name}</span>
            </span>
          </SummaryRow>
        )}
        {item.category && (
          <SummaryRow icon={<Tag size={14} />}>
            <span
              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
              style={{
                background: (item.category.color || "#94a3b8") + "22",
                borderColor: item.category.color || "#94a3b8",
              }}
            >
              {item.category.name}
            </span>
          </SummaryRow>
        )}
        {item.description && (
          <SummaryRow icon={<CalendarDays size={14} />}>
            <span className="whitespace-pre-wrap">{item.description}</span>
          </SummaryRow>
        )}
      </ul>
    </>
  );
}

function SummaryRow({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-[3px] muted shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </li>
  );
}
