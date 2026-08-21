// Recurrence expansion engine.
// Given a base event with an optional recurrence rule, expand it into concrete
// occurrences that overlap a given [rangeStart, rangeEnd] window.
//
// Rules we support:
//   - DAILY / WEEKLY / MONTHLY / YEARLY with an interval (every N)
//   - WEEKLY + byWeekday list (0 = Sunday ... 6 = Saturday)
//   - endDate (inclusive) OR endCount (max occurrences, inclusive of first)
//
// We intentionally do NOT support RRULE exceptions or complex BYxxx rules.
// Those belong to a v3 upgrade if the user outgrows the simple UI.

import { addDays, addMonths, addYears, isAfter, isBefore } from "date-fns";

export type RecurrenceFrequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

export interface RecurrenceRule {
  frequency: RecurrenceFrequency;
  interval: number; // >= 1
  byWeekday?: number[]; // 0..6, weekly only
  endDate?: Date | null;
  endCount?: number | null;
}

export interface RecurrableEvent {
  id: string;
  startAt: Date;
  endAt: Date;
  recurrence?: RecurrenceRule | null;
}

export interface Occurrence<E extends RecurrableEvent = RecurrableEvent> {
  event: E;
  occurrenceStart: Date;
  occurrenceEnd: Date;
  isRecurringInstance: boolean;
  instanceKey: string; // stable id for UI keys
}

// Upper-bound safety valve so a malformed rule can never loop forever.
const MAX_OCCURRENCES = 5000;

export function expandOccurrences<E extends RecurrableEvent>(
  event: E,
  rangeStart: Date,
  rangeEnd: Date,
): Occurrence<E>[] {
  const rule = event.recurrence;
  const baseDurationMs = event.endAt.getTime() - event.startAt.getTime();

  // One-off event: include if it overlaps the window.
  if (!rule) {
    if (event.endAt < rangeStart || event.startAt > rangeEnd) return [];
    return [
      {
        event,
        occurrenceStart: event.startAt,
        occurrenceEnd: event.endAt,
        isRecurringInstance: false,
        instanceKey: event.id,
      },
    ];
  }

  const interval = Math.max(1, Math.floor(rule.interval));
  const byWeekday =
    rule.frequency === "WEEKLY" && rule.byWeekday && rule.byWeekday.length > 0
      ? [...new Set(rule.byWeekday)].sort()
      : null;

  const hardEnd = rule.endDate ?? null;
  const maxCount = rule.endCount ?? null;

  const out: Occurrence<E>[] = [];
  let produced = 0;
  let safety = 0;

  const pushIfInRange = (occStart: Date) => {
    const occEnd = new Date(occStart.getTime() + baseDurationMs);
    if (hardEnd && isAfter(occStart, hardEnd)) return "stop" as const;
    if (maxCount !== null && produced >= maxCount) return "stop" as const;
    produced += 1;
    if (occEnd < rangeStart) return "continue" as const;
    if (occStart > rangeEnd) return "beyond" as const;
    out.push({
      event,
      occurrenceStart: occStart,
      occurrenceEnd: occEnd,
      isRecurringInstance: true,
      instanceKey: `${event.id}:${occStart.toISOString()}`,
    });
    return "continue" as const;
  };

  switch (rule.frequency) {
    case "DAILY": {
      let cursor = new Date(event.startAt);
      while (safety++ < MAX_OCCURRENCES) {
        const status = pushIfInRange(cursor);
        if (status === "stop") break;
        if (status === "beyond") break;
        cursor = addDays(cursor, interval);
      }
      break;
    }
    case "WEEKLY": {
      if (!byWeekday) {
        // Same weekday as startAt, every `interval` weeks.
        let cursor = new Date(event.startAt);
        while (safety++ < MAX_OCCURRENCES) {
          const status = pushIfInRange(cursor);
          if (status === "stop") break;
          if (status === "beyond") break;
          cursor = addDays(cursor, 7 * interval);
        }
      } else {
        // Emit one occurrence per selected weekday per `interval`-week block.
        const weekBlockStart = startOfWeekSun(event.startAt);
        let block = 0;
        while (safety++ < MAX_OCCURRENCES) {
          const blockStart = addDays(weekBlockStart, 7 * interval * block);
          let anyInBlock = false;
          for (const wd of byWeekday) {
            const occDay = addDays(blockStart, wd);
            // Preserve the time-of-day from the base event
            const occStart = applyTimeOfDay(occDay, event.startAt);
            if (isBefore(occStart, event.startAt)) continue; // don't emit before event.startAt
            const status = pushIfInRange(occStart);
            if (status === "stop") return out;
            if (status === "beyond") return out;
            anyInBlock = true;
          }
          // If we've already passed rangeEnd AND produced nothing in this block,
          // we can stop — later blocks are also beyond.
          if (!anyInBlock && isAfter(blockStart, rangeEnd)) break;
          block += 1;
        }
      }
      break;
    }
    case "MONTHLY": {
      let step = 0;
      while (safety++ < MAX_OCCURRENCES) {
        const cursor = addMonths(event.startAt, interval * step);
        const status = pushIfInRange(cursor);
        if (status === "stop") break;
        if (status === "beyond") break;
        step += 1;
      }
      break;
    }
    case "YEARLY": {
      let step = 0;
      while (safety++ < MAX_OCCURRENCES) {
        const cursor = addYears(event.startAt, interval * step);
        const status = pushIfInRange(cursor);
        if (status === "stop") break;
        if (status === "beyond") break;
        step += 1;
      }
      break;
    }
  }

  return out;
}

// Expand many events at once, flattening results.
export function expandMany<E extends RecurrableEvent>(
  events: E[],
  rangeStart: Date,
  rangeEnd: Date,
): Occurrence<E>[] {
  const out: Occurrence<E>[] = [];
  for (const e of events) {
    out.push(...expandOccurrences(e, rangeStart, rangeEnd));
  }
  out.sort((a, b) => a.occurrenceStart.getTime() - b.occurrenceStart.getTime());
  return out;
}

// Serialize the DB's comma-separated byWeekday string into a number[].
export function parseByWeekday(raw: string | null | undefined): number[] | undefined {
  if (!raw) return undefined;
  const parts = raw
    .split(",")
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  return parts.length ? parts : undefined;
}

export function serializeByWeekday(days: number[] | undefined): string | null {
  if (!days || days.length === 0) return null;
  return [...new Set(days)].sort().join(",");
}

// Build a RecurrenceRule from the flat DB columns, or null if no recurrence.
export function ruleFromRow(row: {
  recurrenceFrequency: RecurrenceFrequency | null;
  recurrenceInterval: number | null;
  recurrenceByWeekday: string | null;
  recurrenceEndDate: Date | null;
  recurrenceEndCount: number | null;
}): RecurrenceRule | null {
  if (!row.recurrenceFrequency) return null;
  return {
    frequency: row.recurrenceFrequency,
    interval: row.recurrenceInterval && row.recurrenceInterval > 0 ? row.recurrenceInterval : 1,
    byWeekday: parseByWeekday(row.recurrenceByWeekday),
    endDate: row.recurrenceEndDate ?? null,
    endCount: row.recurrenceEndCount ?? null,
  };
}

// Short human description for the UI, e.g. "Every 2 weeks on Mon, Wed".
export function describeRule(rule: RecurrenceRule | null): string {
  if (!rule) return "Does not repeat";
  const i = Math.max(1, Math.floor(rule.interval));
  const unitSingular = { DAILY: "day", WEEKLY: "week", MONTHLY: "month", YEARLY: "year" }[
    rule.frequency
  ];
  const head = i === 1 ? `Every ${unitSingular}` : `Every ${i} ${unitSingular}s`;
  if (rule.frequency === "WEEKLY" && rule.byWeekday && rule.byWeekday.length > 0) {
    const names = rule.byWeekday
      .slice()
      .sort()
      .map((d) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d])
      .join(", ");
    return `${head} on ${names}`;
  }
  return head;
}

// v4.7.5 — helper used by the to-do "complete = roll forward" logic. Given
// the rule and the most-recent occurrence date, returns the next occurrence
// strictly after `from`. Returns null when the recurrence has hit its end
// (endDate or endCount exhausted by the caller — we don't track count here,
// the caller is responsible for decrementing it before/after this call).
export function nextOccurrenceAfter(
  rule: RecurrenceRule,
  from: Date,
): Date | null {
  const interval = Math.max(1, Math.floor(rule.interval));

  let next: Date;
  switch (rule.frequency) {
    case "DAILY":
      next = addDays(from, interval);
      break;
    case "WEEKLY": {
      const wd = rule.byWeekday && rule.byWeekday.length > 0
        ? [...new Set(rule.byWeekday)].sort()
        : null;
      if (!wd) {
        next = addDays(from, 7 * interval);
        break;
      }
      // Find the next selected weekday after `from`. Try days +1..+7; if none
      // hit, jump `7 * (interval - 1)` more days into the next interval block
      // and try again.
      const currentDow = from.getDay();
      let candidate: Date | null = null;
      for (let offset = 1; offset <= 7; offset++) {
        const dow = (currentDow + offset) % 7;
        if (wd.includes(dow)) {
          candidate = addDays(from, offset);
          break;
        }
      }
      if (!candidate) {
        // Shouldn't happen because there's at least one weekday selected, but
        // be defensive: jump a full interval-week.
        candidate = addDays(from, 7 * interval);
      } else if (interval > 1) {
        // For multi-week intervals we need to skip the (interval-1) blocks
        // BETWEEN the current and next selected day. Easiest: if the
        // candidate date crosses into a new week, add (interval-1) weeks.
        const fromWeekStart = startOfWeekSun(from).getTime();
        const candidateWeekStart = startOfWeekSun(candidate).getTime();
        if (candidateWeekStart > fromWeekStart) {
          candidate = addDays(candidate, 7 * (interval - 1));
        }
      }
      next = candidate;
      break;
    }
    case "MONTHLY":
      next = addMonths(from, interval);
      break;
    case "YEARLY":
      next = addYears(from, interval);
      break;
  }

  if (rule.endDate && isAfter(next, rule.endDate)) return null;
  return next;
}

// --- internal helpers ---

function startOfWeekSun(d: Date): Date {
  const day = d.getDay();
  const s = new Date(d);
  s.setHours(0, 0, 0, 0);
  return addDays(s, -day);
}

function applyTimeOfDay(day: Date, source: Date): Date {
  const out = new Date(day);
  out.setHours(
    source.getHours(),
    source.getMinutes(),
    source.getSeconds(),
    source.getMilliseconds(),
  );
  return out;
}

// Exported only for tests / debugging.
export const _internals = { startOfWeekSun, applyTimeOfDay };
