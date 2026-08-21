import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { handleError } from "@/lib/http";

const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  body: z.string().max(2000).optional().nullable(),
  remindAt: z.string().optional(),
  deliveryInApp: z.boolean().optional(),
  deliveryEmail: z.boolean().optional(),
});

// Children can edit/delete only their own reminders. Parents can edit anyone's.
async function assertOwnershipOrParent(userId: string, meId: string, role: string) {
  if (role === "PARENT") return;
  if (userId !== meId) {
    throw new HttpError(403, "Not yours to change");
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const me = await requireUser();
    if (!can(me, "canEditReminders")) {
      throw new HttpError(403, "No permission to edit reminders");
    }
    const reminder = await prisma.reminder.findUnique({ where: { id: params.id } });
    if (!reminder) throw new HttpError(404, "Reminder not found");
    await assertOwnershipOrParent(reminder.userId, me.id, me.role);

    const input = patchSchema.parse(await req.json());
    const data: Record<string, unknown> = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.body !== undefined) data.body = input.body;
    if (input.deliveryInApp !== undefined) data.deliveryInApp = input.deliveryInApp;
    if (input.deliveryEmail !== undefined) data.deliveryEmail = input.deliveryEmail;
    if (input.remindAt !== undefined) {
      const d = new Date(input.remindAt);
      if (isNaN(d.getTime())) throw new HttpError(400, "Invalid date");
      data.remindAt = d;
      // Editing the fire time resets sent so the scheduler re-fires it.
      data.sent = false;
      data.sentAt = null;
      data.acknowledgedAt = null;
    }

    const updated = await prisma.reminder.update({
      where: { id: params.id },
      data,
      include: {
        user: { select: { id: true, name: true, color: true, avatarEmoji: true } },
      },
    });
    return NextResponse.json({ reminder: updated });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: e.errors },
        { status: 400 },
      );
    }
    return handleError(e);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const me = await requireUser();
    if (!can(me, "canEditReminders")) {
      throw new HttpError(403, "No permission to delete reminders");
    }
    const reminder = await prisma.reminder.findUnique({ where: { id: params.id } });
    if (!reminder) throw new HttpError(404, "Reminder not found");
    await assertOwnershipOrParent(reminder.userId, me.id, me.role);

    await prisma.reminder.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
