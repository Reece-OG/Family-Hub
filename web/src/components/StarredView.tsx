"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Star } from "lucide-react";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import {
  EventDialog,
  type EventShape,
  type Me,
  type UserMini,
} from "./EventDialog";
import {
  expandMany,
  parseByWeekday,
  type Occurrence,
  type RecurrenceFrequency,
  type RecurrenceRule,
} from "@/lib/recurrence";
import { eventPrimaryColor } from "@/lib/event-color";

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
};

// ApiEvent has string dates (from JSON); RecurrableEvent needs real Dates.
// This type is the coerced version we feed into the expansion engine.
type ExpandedEvent = Omit<ApiEvent, "startAt" | "endAt"> & {
  startAt: Date;
  endAt: Date;
  recurrence: RecurrenceRule | null;
};

export function StarredView({ me }: { me: Me }) {
  const [events, setEvents] = useState<ApiEvent[]>([]);
  const [users, setUsers] = useState<UserMini[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EventShape | null>(null);

  // Show a 1-year forward window so recurring starred events expand nicely.
  const rangeStart = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const rangeEnd = useMemo(() => {
    const d = new Date(rangeStart);
    d.setFullYear(d.getFullYear() + 1);
    return d;
  }, [rangeStart]);

  const load = useCallback(async () => {
    // v4.7.18 — keep existing data on screen during refreshes. See MenuView
    // for the full rationale. Initial useState(true) handles the first paint.
    try {
      const [ev, u] = await Promise.all([
        fetch(
          `/api/events?starred=1&from=${rangeStart.toISOString()}&to=${rangeEnd.toISOString()}`,
        ).then((r) => r.json()),
        fetch("/api/users").then((r) => r.json()),
      ]);
      setEvents(ev.events || []);
      setUsers(u.users || []);
    } finally {
      setLoading(false);
    }
  }, [rangeStart, rangeEnd]);

  // v4.7.17 — refresh on mount + tab focus + every 60 s.
  useAutoRefresh(load, { intervalMs: 60_000 });

  const occurrences = useMemo<Occurrence<ExpandedEvent>[]>(() => {
    const rec: ExpandedEvent[] = events.map((e) => ({
      ...e,
      startAt: new Date(e.startAt),
      endAt: new Date(e.endAt),
      recurrence: e.recurrenceFrequency
        ? {
            frequency: e.recurrenceFrequency,
            interval: e.recurrenceInterval ?? 1,
            byWeekday: parseByWeekday(e.recurrenceByWeekday),
            endDate: e.recurrenceEndDate ? new Date(e.recurrenceEndDate) : null,
            endCount: e.recurrenceEndCount ?? null,
          }
        : null,
    }));
    return expandMany(rec, rangeStart, rangeEnd);
  }, [events, rangeStart, rangeEnd]);

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

  if (loading) return <p className="muted text-sm">Loading starred events…</p>;
  if (occurrences.length === 0) {
    return (
      <div className="card p-6 text-center">
        <Star className="mx-auto mb-2 text-yellow-500" size={36} />
        <p className="font-semibold mb-1">No starred events yet</p>
        <p className="text-sm muted">
          Open any event and tap the star to mark it as important.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {occurrences.map((occ) => {
        const e = occ.event;
        // Look up the original ApiEvent so openExisting gets string dates.
        const apiEv = events.find((x) => x.id === e.id);
        return (
          <button
            key={occ.instanceKey}
            onClick={() => apiEv && openExisting(apiEv)}
            className="card p-4 w-full text-left flex items-start gap-3 hover:brightness-105"
          >
            <div
              className="w-1 self-stretch rounded-full"
              style={{ background: eventPrimaryColor(e) }}
            />
            <Star size={18} className="fill-yellow-400 text-yellow-400 mt-1 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="font-semibold">{e.title}</div>
              <div className="text-sm muted">
                {format(occ.occurrenceStart, "EEE, MMM d yyyy")}
                {!e.allDay &&
                  ` · ${format(occ.occurrenceStart, "HH:mm")}–${format(occ.occurrenceEnd, "HH:mm")}`}
                {e.location ? ` · ${e.location}` : ""}
              </div>
              {e.participants.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {e.participants.map((p) => (
                    <span
                      key={p.id}
                      className="chip"
                      style={{ background: p.user.color + "33", borderColor: p.user.color }}
                    >
                      <span>{p.user.avatarEmoji}</span>
                      <span>{p.user.name}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </button>
        );
      })}

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
    </div>
  );
}
