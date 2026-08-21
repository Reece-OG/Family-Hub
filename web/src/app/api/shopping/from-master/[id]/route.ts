// v4.7.19 — quick-add a ShoppingItem from a catalog master with a single POST.
//
// Body is optional. If the caller supplies `quantity`, it overrides the
// master's defaultQuantity for this one row (without changing the master).
// This is what the catalog UI's "+" button hits.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { handleError } from "@/lib/http";

const bodySchema = z.object({
  quantity: z.string().max(50).optional().nullable(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const me = await requireUser();
    if (!can(me, "canEditShopping")) throw new HttpError(403, "No permission");

    // The body might be empty (the catalog "+" button sends none). Tolerate it.
    let body: { quantity?: string | null } = {};
    try {
      body = bodySchema.parse(await req.json());
    } catch {
      body = {};
    }

    const master = await prisma.shoppingMaster.findUnique({
      where: { id: params.id },
    });
    if (!master || master.hidden) {
      throw new HttpError(404, "Item not in catalog");
    }

    const quantity = body.quantity ?? master.defaultQuantity ?? null;

    const item = await prisma.shoppingItem.create({
      data: {
        name: master.name,
        quantity,
        category: master.category,
        addedById: me.id,
      },
      include: { addedBy: { select: { id: true, name: true, color: true, avatarEmoji: true } } },
    });

    // Bump the master's usage so it climbs the "recent" sort.
    await prisma.shoppingMaster.update({
      where: { id: master.id },
      data: {
        useCount: { increment: 1 },
        lastUsedAt: new Date(),
      },
    });

    return NextResponse.json({ item });
  } catch (e) {
    return handleError(e);
  }
}
