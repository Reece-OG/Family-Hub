import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePrivateUser, HttpError } from "@/lib/auth";
import { handleError } from "@/lib/http";

const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  hint: z.string().max(280).optional().nullable(),
  hidden: z.boolean().optional(),
  position: z.number().int().min(0).max(10000).optional(),
});

async function loadOwnedCategory(ownerId: string, id: string) {
  const c = await prisma.taxCategory.findUnique({ where: { id } });
  if (!c || c.ownerId !== ownerId) {
    // Don't leak existence — return 404 either way.
    throw new HttpError(404, "Category not found");
  }
  return c;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const me = await requirePrivateUser();
    await loadOwnedCategory(me.id, params.id);
    const input = patchSchema.parse(await req.json());
    const category = await prisma.taxCategory.update({
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

// DELETE /api/taxes/categories/[id] — hard delete. Existing line items have
// their categoryId nulled (SetNull on the schema) so historical totals are
// preserved as "Uncategorised".
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const me = await requirePrivateUser();
    await loadOwnedCategory(me.id, params.id);
    await prisma.taxCategory.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
