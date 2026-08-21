import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { handleError } from "@/lib/http";

const patchSchema = z.object({
  recipeId: z.string().optional().nullable(),
  freeformTitle: z.string().max(200).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const me = await requireUser();
    if (!can(me, "canEditMenu")) {
      throw new HttpError(403, "No permission to edit menu");
    }
    const input = patchSchema.parse(await req.json());
    const existing = await prisma.menuEntry.findUnique({
      where: { id: params.id },
    });
    if (!existing) throw new HttpError(404, "Entry not found");

    const data: Record<string, unknown> = {};
    if (input.recipeId !== undefined) data.recipeId = input.recipeId;
    if (input.freeformTitle !== undefined) data.freeformTitle = input.freeformTitle;
    if (input.notes !== undefined) data.notes = input.notes;

    // Don't allow both to become null — that'd be an empty row.
    const nextRecipeId =
      input.recipeId !== undefined ? input.recipeId : existing.recipeId;
    const nextTitle =
      input.freeformTitle !== undefined
        ? input.freeformTitle
        : existing.freeformTitle;
    if (!nextRecipeId && !nextTitle) {
      throw new HttpError(400, "Entry must reference a recipe or have a title");
    }

    const entry = await prisma.menuEntry.update({
      where: { id: params.id },
      data,
      include: {
        recipe: {
          include: { ingredients: { orderBy: { position: "asc" } } },
        },
      },
    });
    return NextResponse.json({ entry });
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
    if (!can(me, "canEditMenu")) {
      throw new HttpError(403, "No permission to edit menu");
    }
    const existing = await prisma.menuEntry.findUnique({
      where: { id: params.id },
    });
    if (!existing) throw new HttpError(404, "Entry not found");
    await prisma.menuEntry.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
