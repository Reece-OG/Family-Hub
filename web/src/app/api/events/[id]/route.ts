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
  minutesBefore: z.number().int().min(0).max(60 * 24 * 30),
  deliveryInApp: z.boolean().optional(),
  deliveryEmail: z.boolean().optional(),
});

const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  startAt: z.string().optional(),
  endAt: z.string().optional(),
  allDay: z.boolean().optional(),
  location: z.string().max(200).nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  starred: z.boolean().optional(),
  participantIds: z.array(z.string()).optional(),
  recurrence: recurrenceSchema,
  reminders: z.array(reminderInputSchema).max(10).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const me = await requireUser();
    if (!can(me, "canEditCalendar")) {
      throw new HttpError(403, "No permission to edit events");
    }
    const input = patchSchema.parse(await req.json());
    const existing = await prisma.event.findUnique({ where: { id: params.id } });
    if (!existing) throw new HttpError(404, "Event not found");
    if (me.role !== "PARENT" && existing.createdById !== me.id) {
      throw new HttpError(403, "You can only edit events you created.");
    }

    const data: any = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.description !== undefined) data.description = input.description;
    if (input.startAt !== undefined) data.startAt = new Date(input.startAt);
    if (input.endAt !== undefined) data.endAt = new Date(input.endAt);
    if (input.allDay !== undefined) data.allDay = input.allDay;
    if (input.location !== undefined) data.location = input.location;
    if (input.color !== undefined) data.color = input.color;
    if (input.starred !== undefined) data.starred = input.starred;

    // recurrence: null clears, object sets, undefined leaves alone
    if (input.recurrence !== undefined) {
      const rec = input.recurrence;
      if (rec === null) {
        data.recurrenceFrequency = null;
        data.recurrenceInterval = null;
        data.recurrenceByWeekday = null;
        data.recurrenceEndDate = null;
        data.recurrenceEndCount = null;
      } else {
        data.recurrenceFrequency = rec.frequency;
        data.recurrenceInterval = rec.interval;
        data.recurrenceByWeekday = serializeByWeekday(rec.byWeekday);
        data.recurrenceEndDate = rec.endDate ? new Date(rec.endDate) : null;
        data.recurrenceEndCount = rec.endCount ?? null;
      }
    }

    if (input.participantIds) {
      await prisma.eventParticipant.deleteMany({ where: { eventId: params.id } });
      data.participants = { create: input.participantIds.map((uid) => ({ userId: uid })) };
    }

    if (input.reminders) {
      // Full replace: wipe the current set and rebuild from the payload. Also
      // invalidate any Reminder rows the scheduler already spawned for this
      // event so stale toasts don't fire after the user removes a lead-time.
      const existingReminders = await prisma.eventReminder.findMany({
        where: { eventId: params.id },
        select: { id: true },
      });
      await prisma.reminder.deleteMany({
        where: {
          sourceEventReminderId: { in: existingReminders.map((r) => r.id) },
          sent: false,
        },
      });
      await prisma.eventReminder.deleteMany({
        where: { eventId: params.id },
      });
      const reminders = dedupeReminders(input.reminders);
      if (reminders.length > 0) {
        data.reminders = {
          create: reminders.map((r) => ({
            minutesBefore: r.minutesBefore,
            deliveryInApp: r.deliveryInApp ?? true,
            deliveryEmail: r.deliveryEmail ?? false,
            createdById: me.id,
          })),
        };
      }
    }

    const event = await prisma.event.update({
      where: { id: params.id },
      data,
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
    return NextResponse.json({ event });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: e.errors }, { status: 400 });
    }
    return handleError(e);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const me = await requireUser();
    if (!can(me, "canEditCalendar")) {
      throw new HttpError(403, "No permission to delete events");
    }
    const existing = await prisma.event.findUnique({ where: { id: params.id } });
    if (!existing) throw new HttpError(404, "Event not found");
    if (me.role !== "PARENT" && existing.createdById !== me.id) {
      throw new HttpError(403, "You can only delete events you created.");
    }
    await prisma.event.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
