import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { handleError } from "@/lib/http";

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  quantity: z.string().max(50).nullable().optional(),
  category: z.string().max(50).nullable().optional(),
  done: z.boolean().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const me = await requireUser();
    if (!can(me, "canEditShopping")) throw new HttpError(403, "No permission");
    const input = patchSchema.parse(await req.json());
    const item = await prisma.shoppingItem.update({
      where: { id: params.id },
      data: input,
      include: { addedBy: { select: { id: true, name: true, color: true, avatarEmoji: true } } },
    });
    return NextResponse.json({ item });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: e.errors }, { status: 400 });
    }
    return handleError(e);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const me = await requireUser();
    if (!can(me, "canEditShopping")) throw new HttpError(403, "No permission");
    await prisma.shoppingItem.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
