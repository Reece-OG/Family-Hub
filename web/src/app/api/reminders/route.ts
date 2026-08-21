import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { handleError } from "@/lib/http";

const createSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(2000).optional().nullable(),
  remindAt: z.string(), // ISO
  deliveryInApp: z.boolean().optional(),
  deliveryEmail: z.boolean().optional(),
  // Parents may set reminders for another family member; children can only
  // set reminders for themselves. Omit to default to self.
  userId: z.string().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const me = await requireUser();
    if (!can(me, "canViewReminders")) {
      throw new HttpError(403, "No permission to view reminders");
    }
    const url = new URL(req.url);
    const scope = url.searchParams.get("scope") ?? "mine";

    // Children only ever see their own reminders. Parents can request "all"
    // to manage the family inbox.
    const where =
      me.role === "PARENT" && scope === "all" ? {} : { userId: me.id };

    const reminders = await prisma.reminder.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, color: true, avatarEmoji: true } },
      },
      orderBy: { remindAt: "asc" },
    });
    return NextResponse.json({ reminders });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const me = await requireUser();
    if (!can(me, "canEditReminders")) {
      throw new HttpError(403, "No permission to add reminders");
    }
    const input = createSchema.parse(await req.json());
    const remindAt = new Date(input.remindAt);
    if (isNaN(remindAt.getTime())) {
      throw new HttpError(400, "Invalid date");
    }

    // Resolve target user. Children can only target themselves.
    let targetUserId = me.id;
    if (input.userId && input.userId !== me.id) {
      if (me.role !== "PARENT") {
        throw new HttpError(403, "Only parents can set reminders for others");
      }
      const target = await prisma.user.findUnique({ where: { id: input.userId } });
      if (!target) throw new HttpError(400, "Target user not found");
      targetUserId = target.id;
    }

    const reminder = await prisma.reminder.create({
      data: {
        userId: targetUserId,
        title: input.title,
        body: input.body ?? null,
        remindAt,
        deliveryInApp: input.deliveryInApp ?? true,
        deliveryEmail: input.deliveryEmail ?? false,
      },
      include: {
        user: { select: { id: true, name: true, color: true, avatarEmoji: true } },
      },
    });
    return NextResponse.json({ reminder });
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
