import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { handleError } from "@/lib/http";
import { serializeByWeekday } from "@/lib/recurrence";

function dedupeReminders<T extends { minutesBefore: number }>(arr: T[]): T[] {
  const seen = new Set<number>();
  const out: T[] = [];
  for (const r of arr) {
    if (seen.has(r.minutesBefore)) continue;
    seen.add(r.minutesBefore);
    out.push(r);
  }
  return out;
}

const recurrenceSchema = z
  .object({
    frequency: z.enum(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]),
    interval: z.number().int().min(1).max(365).default(1),
    byWeekday: z.array(z.number().int().min(0).max(6)).optional(),
    endDate: z.string().optional().nullable(),
    endCount: z.number().int().min(1).max(5000).optional().nullable(),
  })
  .nullable()
  .optional();

const reminderInputSchema = z.object({
  minutesBefore: z.number().int().min(0).max(60 * 24 * 30), // up to 30 days
  deliveryInApp: z.boolean().optional(),
  deliveryEmail: z.boolean().optional(),
});

const createSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  startAt: z.string(), // ISO
  endAt: z.string(),
  allDay: z.boolean().optional(),
  location: z.string().max(200).optional().nullable(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
  starred: z.boolean().optional(),
  participantIds: z.array(z.string()).optional(),
  recurrence: recurrenceSchema,
  reminders: z.array(reminderInputSchema).max(10).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const me = await requireUser();
    if (!can(me, "canViewCalendar")) {
      throw new HttpError(403, "No permission to view calendar");
    }
    const url = new URL(req.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const starredOnly = url.searchParams.get("starred") === "1";

    // For the range filter, we need events whose *base* occurrence OR whose
    // recurrence envelope overlaps the window. Because recurrences can extend
    // indefinitely, we include any event with a recurrence rule, then let the
    // client expand them via lib/recurrence.
    //
    // We build the `where` as a single AND list so that the top-level
    // `starred: true` filter can't accidentally get shadowed by a sibling
    // `OR:` clause on the same object. This keeps the Starred tab correct:
    // if starredOnly is set, *every* branch of the OR must also be starred.
    const and: any[] = [];
    if (starredOnly) and.push({ starred: true });
    if (from || to) {
      const to_ = to ? new Date(to) : null;
      const from_ = from ? new Date(from) : null;
      and.push({
        OR: [
          // Non-recurring event that overlaps the window
          {
            recurrenceFrequency: null,
            AND: [
              ...(to_ ? [{ startAt: { lte: to_ } }] : []),
              ...(from_ ? [{ endAt: { gte: from_ } }] : []),
            ],
          },
          // Any recurring event whose first occurrence is before the window
          // end AND whose recurrence hasn't already ended before the window
          // start.
          {
            recurrenceFrequency: { not: null },
            AND: [
              ...(to_ ? [{ startAt: { lte: to_ } }] : []),
              ...(from_
                ? [
                    {
                      OR: [
                        { recurrenceEndDate: null },
                        { recurrenceEndDate: { gte: from_ } },
                      ],
                    },
                  ]
                : []),
            ],
          },
        ],
      });
    }
    const where: any = and.length ? { AND: and } : {};
    const events = await prisma.event.findMany({
      where,
      include: {
        participants: {
          include: {
            user: { select: { id: true, name: true, color: true, avatarEmoji: true } },
          },
        },
        createdBy: { select: { id: true, name: true, color: true } },
        reminders: {
          select: {
            id: true,
            minutesBefore: true,
            deliveryInApp: true,
            deliveryEmail: true,
          },
          orderBy: { minutesBefore: "asc" },
        },
      },
      orderBy: { startAt: "asc" },
    });
    return NextResponse.json({ events });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const me = await requireUser();
    if (!can(me, "canEditCalendar")) {
      throw new HttpError(403, "No permission to add events");
    }
    const input = createSchema.parse(await req.json());
    const startAt = new Date(input.startAt);
    const endAt = new Date(input.endAt);
    if (isNaN(startAt.getTime()) || isNaN(endAt.getTime())) {
      throw new HttpError(400, "Invalid date");
    }
    if (endAt < startAt) {
      throw new HttpError(400, "End must be after start");
    }
    const participantIds = input.participantIds ?? [me.id];

    const rec = input.recurrence ?? null;
    // Dedupe reminder rows by minutesBefore (the @@unique on the table enforces
    // this but we'd rather fail validation than 409 from the DB).
    const remindersInput = dedupeReminders(input.reminders ?? []);
    const event = await prisma.event.create({
      data: {
        title: input.title,
        description: input.description ?? null,
        startAt,
        endAt,
        allDay: input.allDay ?? false,
        location: input.location ?? null,
        color: input.color ?? null,
        starred: input.starred ?? false,
        recurrenceFrequency: rec ? rec.frequency : null,
        recurrenceInterval: rec ? rec.interval : null,
        recurrenceByWeekday: rec ? serializeByWeekday(rec.byWeekday) : null,
        recurrenceEndDate: rec && rec.endDate ? new Date(rec.endDate) : null,
        recurrenceEndCount: rec ? rec.endCount ?? null : null,
        createdById: me.id,
        participants: {
          create: participantIds.map((uid) => ({ userId: uid })),
        },
        reminders: {
          create: remindersInput.map((r) => ({
            minutesBefore: r.minutesBefore,
            deliveryInApp: r.deliveryInApp ?? true,
            deliveryEmail: r.deliveryEmail ?? false,
            createdById: me.id,
          })),
        },
      },
      include: {
        participants: {
          include: {
            user: { select: { id: true, name: true, color: true, avatarEmoji: true } },
          },
        },
        createdBy: { select: { id: true, name: true, color: true } },
        reminders: {
          select: {
            id: true,
            minutesBefore: true,
            deliveryInApp: true,
            deliveryEmail: true,
          },
          orderBy: { minutesBefore: "asc" },
        },
      },
    });

    // v4.9.0 — public webhook bus. Fire-and-forget; a misbehaving HA
    // subscriber must not block event creation.
    try {
      const { dispatchEvent } = await import("@/lib/webhooks");
      dispatchEvent("event.created", {
        id: event.id,
        title: event.title,
        description: event.description,
        start_at: event.startAt.toISOString(),
        end_at: event.endAt.toISOString(),
        all_day: event.allDay,
        location: event.location,
        starred: event.starred,
        recurring: Boolean(event.recurrenceFrequency),
        created_by_id: event.createdById,
        participant_user_ids: event.participants.map((p) => p.user.id),
      });
    } catch {
      /* non-fatal */
    }

    return NextResponse.json({ event });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: e.errors }, { status: 400 });
    }
    return handleError(e);
  }
}
