// v4.9.0 — public REST: GET /api/v1/events
//
// Returns upcoming non-recurring + materialised recurring occurrences in a
// window. Default window is "now → +30 days". Query params:
//   from   ISO datetime (defaults to now)
//   to     ISO datetime (defaults to from + 30 days, capped at +365 days)
//   limit  max events to return (defaults to 200, cap 500)
//
// Authn via Authorization: Bearer <token> with scope "events:read".
// Read-only; we never mutate from /api/v1.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiToken } from "@/lib/api-auth";
import { handleError } from "@/lib/http";
import { expandOccurrences, ruleFromRow } from "@/lib/recurrence";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  try {
    await requireApiToken(req, "events:read");

    const url = new URL(req.url);
    const now = new Date();
    let from = parseDateOr(url.searchParams.get("from"), now);
    let to = parseDateOr(
      url.searchParams.get("to"),
      new Date(from.getTime() + 30 * MS_PER_DAY),
    );
    // Clamp the window to a year so a clumsy ?to=2099 query doesn't fan
    // out the recurrence expander into a CPU spiral.
    const maxTo = new Date(from.getTime() + 365 * MS_PER_DAY);
    if (to > maxTo) to = maxTo;
    if (to < from) [from, to] = [to, from];

    const limitParam = Number(url.searchParams.get("limit"));
    const limit =
      Number.isFinite(limitParam) && limitParam > 0
        ? Math.min(500, Math.floor(limitParam))
        : 200;

    // Fetch the candidate set: all non-recurring events overlapping the
    // window + every recurring row (we let expandOccurrences filter by
    // window). The take=500 cap stops us from melting on a huge calendar.
    const events = await prisma.event.findMany({
      where: {
        OR: [
          { recurrenceFrequency: null, startAt: { lte: to }, endAt: { gte: from } },
          { recurrenceFrequency: { not: null } },
        ],
      },
      take: 500,
      orderBy: { startAt: "asc" },
    });

    type Occurrence = {
      id: string;
      title: string;
      description: string | null;
      start_at: string;
      end_at: string;
      all_day: boolean;
      location: string | null;
      color: string | null;
      starred: boolean;
      recurring: boolean;
      created_by_id: string;
      occurrence_start: string;
    };
    const out: Occurrence[] = [];

    for (const ev of events) {
      const rule = ruleFromRow(ev);
      if (!rule) {
        out.push({
          id: ev.id,
          title: ev.title,
          description: ev.description,
          start_at: ev.startAt.toISOString(),
          end_at: ev.endAt.toISOString(),
          all_day: ev.allDay,
          location: ev.location,
          color: ev.color,
          starred: ev.starred,
          recurring: false,
          created_by_id: ev.createdById,
          occurrence_start: ev.startAt.toISOString(),
        });
        continue;
      }
      const occs = expandOccurrences(
        {
          id: ev.id,
          startAt: ev.startAt,
          endAt: ev.endAt,
          recurrence: rule,
        },
        from,
        to,
      );
      for (const o of occs) {
        out.push({
          id: ev.id,
          title: ev.title,
          description: ev.description,
          start_at: ev.startAt.toISOString(),
          end_at: ev.endAt.toISOString(),
          all_day: ev.allDay,
          location: ev.location,
          color: ev.color,
          starred: ev.starred,
          recurring: true,
          created_by_id: ev.createdById,
          occurrence_start: o.occurrenceStart.toISOString(),
        });
      }
    }

    out.sort((a, b) => a.occurrence_start.localeCompare(b.occurrence_start));
    return NextResponse.json({
      from: from.toISOString(),
      to: to.toISOString(),
      count: Math.min(out.length, limit),
      events: out.slice(0, limit),
    });
  } catch (e) {
    return handleError(e);
  }
}

function parseDateOr(raw: string | null, fallback: Date): Date {
  if (!raw) return fallback;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return fallback;
  return d;
}
