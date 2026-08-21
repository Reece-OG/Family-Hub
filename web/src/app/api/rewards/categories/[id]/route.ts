import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { handleError } from "@/lib/http";

const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  hint: z.string().max(280).optional().nullable(),
  hidden: z.boolean().optional(),
  position: z.number().int().min(0).max(10000).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const me = await requireUser();
    if (me.role !== "PARENT") {
      throw new HttpError(403, "Only parents can edit reward categories");
    }
    const existing = await prisma.rewardCategory.findUnique({
      where: { id: params.id },
    });
    if (!existing) throw new HttpError(404, "Category not found");
    const input = patchSchema.parse(await req.json());
    const category = await prisma.rewardCategory.update({
      where: { id: params.id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.hint !== undefined
          ? { hint: input.hint?.trim() || null }
          : {}),
        ...(input.hidden !== undefined ? { hidden: input.hidden } : {}),
        ...(input.position !== undefined ? { position: input.position } : {}),
      },
    });
    return NextResponse.json({ category });
  } catch (e: unknown) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: e.errors },
        { status: 400 },
      );
    }
    if (
      typeof e === "object" &&
      e !== null &&
      "code" in e &&
      (e as { code?: string }).code === "P2002"
    ) {
      return NextResponse.json(
        { error: "A category with that name already exists" },
        { status: 409 },
      );
    }
    return handleError(e);
  }
}

// Hard delete. Existing items in this category have their categoryId
// nulled (SetNull on the schema) so historical redemption rows are kept.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const me = await requireUser();
    if (me.role !== "PARENT") {
      throw new HttpError(403, "Only parents can delete reward categories");
    }
    const existing = await prisma.rewardCategory.findUnique({
      where: { id: params.id },
    });
    if (!existing) throw new HttpError(404, "Category not found");
    await prisma.rewardCategory.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
