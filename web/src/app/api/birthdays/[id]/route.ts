import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { handleError } from "@/lib/http";
import {
  asBirthdayDay,
  deleteBirthdayEvent,
  syncBirthdayEvent,
} from "@/lib/birthdays";

const patchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  dateOfBirth: z.string().optional(),
  yearKnown: z.boolean().optional(),
  notes: z.string().max(500).optional().nullable(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional()
    .nullable(),
  avatarEmoji: z.string().max(8).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const me = await requireUser();
    if (!can(me, "canEditCalendar")) {
      throw new HttpError(403, "No permission to edit birthdays");
    }
    const input = patchSchema.parse(await req.json());

    const existing = await prisma.birthday.findUnique({
      where: { id: params.id },
    });
    if (!existing) throw new HttpError(404, "Birthday not found");

    const data: {
      name?: string;
      dateOfBirth?: Date;
      yearKnown?: boolean;
      notes?: string | null;
      color?: string | null;
      avatarEmoji?: string;
    } = {};
    if (input.name !== undefined) data.name = input.name.trim();
    // `yearKnown` can flip independently of `dateOfBirth`; resolve the
    // effective value so we canonicalise the stored DOB consistently.
    const effectiveYearKnown =
      input.yearKnown !== undefined ? input.yearKnown : existing.yearKnown;
    if (input.yearKnown !== undefined) data.yearKnown = input.yearKnown;
    if (input.dateOfBirth !== undefined) {
      const dob = asBirthdayDay(input.dateOfBirth, effectiveYearKnown);
      if (isNaN(dob.getTime())) throw new HttpError(400, "Invalid date");
      data.dateOfBirth = dob;
    } else if (
      input.yearKnown !== undefined &&
      input.yearKnown !== existing.yearKnown
    ) {
      // yearKnown is flipping without a new DOB — re-canonicalise the
      // existing DOB so a previous real year gets wiped (or a placeholder
      // year gets restored to its real value only by re-picking a date,
      // not here — we just zero it out).
      data.dateOfBirth = asBirthdayDay(
        existing.dateOfBirth,
        input.yearKnown,
      );
    }
    if (input.notes !== undefined) data.notes = input.notes ?? null;
    if (input.color !== undefined) data.color = input.color ?? null;
    if (input.avatarEmoji !== undefined && input.avatarEmoji)
      data.avatarEmoji = input.avatarEmoji;

    const updated = await prisma.birthday.update({
      where: { id: params.id },
      data,
    });
    await syncBirthdayEvent({
      birthdayId: updated.id,
      name: updated.name,
      dateOfBirth: updated.dateOfBirth,
      color: updated.color,
      notes: updated.notes,
      createdById: existing.createdById,
    });
    const saved = await prisma.birthday.findUnique({
      where: { id: params.id },
    });
    return NextResponse.json({ birthday: saved });
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
    if (!can(me, "canEditCalendar")) {
      throw new HttpError(403, "No permission to delete birthdays");
    }
    await deleteBirthdayEvent(params.id);
    await prisma.birthday.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
