import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireParent, requireUser } from "@/lib/auth";
import { handleError } from "@/lib/http";
import { syncUserBirthdayEvent } from "@/lib/birthdays";

const createSchema = z.object({
  email: z.string().email().max(200),
  name: z.string().min(1).max(100),
  password: z.string().min(4).max(200),
  role: z.enum(["PARENT", "CHILD"]).default("CHILD"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  avatarEmoji: z.string().max(8).optional(),
  dateOfBirth: z.string().optional().nullable(),
  // v4.7.15 — defaults to true so adding a member with a DOB drops their
  // birthday on the shared calendar automatically. Parent can override.
  showBirthdayOnCalendar: z.boolean().optional(),
});

export async function GET() {
  try {
    const me = await requireUser();
    // Children can see other family members (names/colors) but not emails etc.
    if (me.role === "PARENT") {
      const users = await prisma.user.findMany({
        include: { permissions: true },
        orderBy: [{ role: "asc" }, { name: "asc" }],
      });
      return NextResponse.json({
        users: users.map((u) => ({
          id: u.id,
          email: u.email,
          name: u.name,
          role: u.role,
          color: u.color,
          avatarEmoji: u.avatarEmoji,
          dateOfBirth: u.dateOfBirth,
          showBirthdayOnCalendar: u.showBirthdayOnCalendar,
          receivesOwnEventReminders: u.receivesOwnEventReminders,
          permissions: u.permissions,
        })),
      });
    }
    const users = await prisma.user.findMany({
      orderBy: [{ role: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        color: true,
        avatarEmoji: true,
        role: true,
        dateOfBirth: true,
        showBirthdayOnCalendar: true,
      },
    });
    return NextResponse.json({ users });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireParent();
    const body = await req.json();
    const input = createSchema.parse(body);
    const passwordHash = await bcrypt.hash(input.password, 10);
    const user = await prisma.user.create({
      data: {
        email: input.email.toLowerCase(),
        name: input.name,
        passwordHash,
        role: input.role,
        color: input.color ?? "#7c3aed",
        avatarEmoji: input.avatarEmoji ?? (input.role === "PARENT" ? "👑" : "🧒"),
        dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : null,
        showBirthdayOnCalendar:
          input.showBirthdayOnCalendar === undefined
            ? true
            : input.showBirthdayOnCalendar,
        permissions: {
          create: {
            canManageUsers: input.role === "PARENT",
          },
        },
      },
      include: { permissions: true },
    });
    // v4.7.15 — drop the birthday on the shared calendar if the new user has
    // a DOB + the flag is on. No-op when DOB is null or opted out.
    await syncUserBirthdayEvent(user.id);
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
    // Unique-email conflict
    const msg = (e as any)?.message || "";
    if (msg.includes("Unique constraint")) {
      return NextResponse.json(
        { error: "A user with that email already exists." },
        { status: 409 }
      );
    }
    return handleError(e);
  }
}
