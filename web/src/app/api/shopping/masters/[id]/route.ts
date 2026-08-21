// v4.7.19 — single ShoppingMaster: rename, recategorise, hide, delete.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { handleError } from "@/lib/http";
import { normaliseKey } from "@/lib/shopping-master";

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  category: z.string().max(50).nullable().optional(),
  defaultQuantity: z.string().max(50).nullable().optional(),
  hidden: z.boolean().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const me = await requireUser();
    if (!can(me, "canEditShopping")) throw new HttpError(403, "No permission");
    const input = patchSchema.parse(await req.json());

    const data: {
      name?: string;
      nameKey?: string;
      category?: string | null;
      defaultQuantity?: string | null;
      hidden?: boolean;
    } = {};

    if (input.name !== undefined) {
      const trimmed = input.name.trim();
      const key = normaliseKey(trimmed);
      if (!key) throw new HttpError(400, "Name cannot be blank");
      // Guard against renaming onto another existing master's key.
      const collision = await prisma.shoppingMaster.findUnique({
        where: { nameKey: key },
      });
      if (collision && collision.id !== params.id) {
        throw new HttpError(409, `"${trimmed}" already exists in the catalog`);
      }
      data.name = trimmed;
      data.nameKey = key;
    }
    if (input.category !== undefined) data.category = input.category;
    if (input.defaultQuantity !== undefined) data.defaultQuantity = input.defaultQuantity;
    if (input.hidden !== undefined) data.hidden = input.hidden;

    const master = await prisma.shoppingMaster.update({
      where: { id: params.id },
      data,
    });
    return NextResponse.json({ master });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: e.errors }, { status: 400 });
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
    if (!can(me, "canEditShopping")) throw new HttpError(403, "No permission");
    await prisma.shoppingMaster.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
