import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { handleError } from "@/lib/http";

const createSchema = z.object({
  name: z.string().min(1).max(60),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional()
    .nullable(),
  position: z.number().int().optional(),
});

export async function GET() {
  try {
    const me = await requireUser();
    if (!can(me, "canViewTodos")) throw new HttpError(403, "No permission");
    const categories = await prisma.todoCategory.findMany({
      orderBy: [{ position: "asc" }, { name: "asc" }],
    });
    return NextResponse.json({ categories });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const me = await requireUser();
    // Managing the category list is a parent concern — editing todos
    // themselves is open to any family member with canEditTodos.
    if (!can(me, "canManageUsers")) {
      throw new HttpError(403, "Only parents can manage to-do categories");
    }
    const input = createSchema.parse(await req.json());
    // Append to the end of the list by default so new categories land
    // predictably.
    let position = input.position;
    if (position === undefined) {
      const last = await prisma.todoCategory.findFirst({
        orderBy: { position: "desc" },
        select: { position: true },
      });
      position = (last?.position ?? -1) + 1;
    }
    const category = await prisma.todoCategory.create({
      data: {
        name: input.name.trim(),
        color: input.color ?? null,
        position,
        createdById: me.id,
      },
    });
    return NextResponse.json({ category });
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
