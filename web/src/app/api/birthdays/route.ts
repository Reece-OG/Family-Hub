import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { handleError } from "@/lib/http";
import { asBirthdayDay, syncBirthdayEvent } from "@/lib/birthdays";

const createSchema = z.object({
  name: z.string().min(1).max(100),
  dateOfBirth: z.string(), // ISO date
  yearKnown: z.boolean().optional(),
  notes: z.string().max(500).optional().nullable(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional()
    .nullable(),
  avatarEmoji: z.string().max(8).optional(),
});

export async function GET() {
  try {
    const me = await requireUser();
    if (!can(me, "canViewCalendar")) {
      throw new HttpError(403, "No permission to view birthdays");
    }
    const birthdays = await prisma.birthday.findMany({
      orderBy: { dateOfBirth: "asc" },
    });
    return NextResponse.json({ birthdays });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const me = await requireUser();
    if (!can(me, "canEditCalendar")) {
      throw new HttpError(403, "No permission to add birthdays");
    }
    const input = createSchema.parse(await req.json());
    const yearKnown = input.yearKnown !== false;
    const dob = asBirthdayDay(input.dateOfBirth, yearKnown);
    if (isNaN(dob.getTime())) throw new HttpError(400, "Invalid date");

    const birthday = await prisma.birthday.create({
      data: {
        name: input.name.trim(),
        dateOfBirth: dob,
        yearKnown,
        notes: input.notes ?? null,
        color: input.color ?? null,
        avatarEmoji: input.avatarEmoji || "🎂",
        createdById: me.id,
      },
    });
    await syncBirthdayEvent({
      birthdayId: birthday.id,
      name: birthday.name,
      dateOfBirth: birthday.dateOfBirth,
      color: birthday.color,
      notes: birthday.notes,
      createdById: me.id,
    });
    const saved = await prisma.birthday.findUnique({
      where: { id: birthday.id },
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
