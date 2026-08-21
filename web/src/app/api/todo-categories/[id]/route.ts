import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { handleError } from "@/lib/http";

const patchSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
  position: z.number().int().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const me = await requireUser();
    if (!can(me, "canManageUsers")) {
      throw new HttpError(403, "Only parents can manage to-do categories");
    }
    const input = patchSchema.parse(await req.json());
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.color !== undefined) data.color = input.color ?? null;
    if (input.position !== undefined) data.position = input.position;

    const category = await prisma.todoCategory.update({
      where: { id: params.id },
      data,
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

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const me = await requireUser();
    if (!can(me, "canManageUsers")) {
      throw new HttpError(403, "Only parents can manage to-do categories");
    }
    // Todos are kept (categoryId -> null via schema `onDelete: SetNull`).
    await prisma.todoCategory.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
