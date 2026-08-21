import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireParent } from "@/lib/auth";
import { handleError } from "@/lib/http";
import { featurePermissionKeys } from "@/lib/permissions";
import { syncUserBirthdayEvent, deleteUserBirthdayEvent } from "@/lib/birthdays";

const permissionsShape = Object.fromEntries(
  featurePermissionKeys().map((k) => [k, z.boolean().optional()])
) as Record<string, z.ZodOptional<z.ZodBoolean>>;

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  email: z.string().email().max(200).optional(),
  role: z.enum(["PARENT", "CHILD"]).optional(),
  password: z.string().min(4).max(200).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  avatarEmoji: z.string().max(8).optional(),
  dateOfBirth: z.string().nullable().optional(),
  // v4.7.15 — per-member opt-in/out for the shared calendar birthday event.
  showBirthdayOnCalendar: z.boolean().optional(),
  // v4.8.1 — parent-managed kill switch for this user's event reminders.
  // When false, no event-reminder Reminder rows are spawned for this user.
  receivesOwnEventReminders: z.boolean().optional(),
  permissions: z.object(permissionsShape).partial().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireParent();
    const input = updateSchema.parse(await req.json());
    const data: any = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.email !== undefined) data.email = input.email.toLowerCase();
    if (input.role !== undefined) data.role = input.role;
    if (input.color !== undefined) data.color = input.color;
    if (input.avatarEmoji !== undefined) data.avatarEmoji = input.avatarEmoji;
    if (input.dateOfBirth !== undefined)
      data.dateOfBirth = input.dateOfBirth ? new Date(input.dateOfBirth) : null;
    if (input.showBirthdayOnCalendar !== undefined)
      data.showBirthdayOnCalendar = input.showBirthdayOnCalendar;
    if (input.receivesOwnEventReminders !== undefined)
      data.receivesOwnEventReminders = input.receivesOwnEventReminders;
    if (input.password !== undefined)
      data.passwordHash = await bcrypt.hash(input.password, 10);

    if (input.permissions) {
      data.permissions = {
        upsert: {
          create: input.permissions as any,
          update: input.permissions as any,
        },
      };
    }

    const user = await prisma.user.update({
      where: { id: params.id },
      data,
      include: { permissions: true },
    });
    // v4.7.15 — keep the calendar in sync after touching any field that
    // affects how the birthday event renders. Cheap; bails out of the work
    // when there's nothing to do (no DOB / opted out).
    if (
      input.dateOfBirth !== undefined ||
      input.showBirthdayOnCalendar !== undefined ||
      input.name !== undefined ||
      input.color !== undefined ||
      input.avatarEmoji !== undefined
    ) {
      await syncUserBirthdayEvent(user.id);
    }
    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        color: user.color,
        avatarEmoji: user.avatarEmoji,
        dateOfBirth: user.dateOfBirth,
        showBirthdayOnCalendar: user.showBirthdayOnCalendar,
        receivesOwnEventReminders: user.receivesOwnEventReminders,
        permissions: user.permissions,
      },
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: e.errors },
        { status: 400 }
      );
    }
    return handleError(e);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const me = await requireParent();
    if (me.id === params.id) {
      return NextResponse.json(
        { error: "You cannot delete your own account while signed in." },
        { status: 400 }
      );
    }
    // Refuse to delete the last remaining parent
    const target = await prisma.user.findUnique({ where: { id: params.id } });
    if (!target) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    if (target.role === "PARENT") {
      const parentCount = await prisma.user.count({ where: { role: "PARENT" } });
      if (parentCount <= 1) {
        return NextResponse.json(
          { error: "Cannot delete the last parent account." },
          { status: 400 }
        );
      }
    }
    // v4.7.15 — clean up the linked birthday event first. Doing it before
    // the user row goes lets the SetNull on the FK relation stay tidy and
    // also ensures we don't leave an orphan Event with createdById pointing
    // at the about-to-be-deleted user.
    await deleteUserBirthdayEvent(params.id);
    await prisma.user.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
