import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { handleError } from "@/lib/http";
// v4.9.1 — we still call findMaster() to inherit a remembered category
// when the user doesn't pick one, but no longer auto-upsert into the
// catalog on every add. The catalog is now strictly opt-in via the
// explicit "Add master" flow on the Catalog tab.
import { findMaster } from "@/lib/shopping-master";

const createSchema = z.object({
  name: z.string().min(1).max(200),
  quantity: z.string().max(50).optional().nullable(),
  category: z.string().max(50).optional().nullable(),
});

export async function GET() {
  try {
    const me = await requireUser();
    if (!can(me, "canViewShopping")) throw new HttpError(403, "No permission");
    const items = await prisma.shoppingItem.findMany({
      include: { addedBy: { select: { id: true, name: true, color: true, avatarEmoji: true } } },
      orderBy: [{ done: "asc" }, { category: "asc" }, { createdAt: "desc" }],
    });
    return NextResponse.json({ items });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const me = await requireUser();
    if (!can(me, "canEditShopping")) throw new HttpError(403, "No permission");
    const input = createSchema.parse(await req.json());

    // v4.7.19 — if the user didn't pick a category but we've seen this item
    // before, inherit the master's category so the new row drops into the
    // right group instead of "Other". Quantity stays whatever the user typed.
    let resolvedCategory = input.category ?? null;
    if (!resolvedCategory) {
      const master = await findMaster(input.name);
      if (master?.category) resolvedCategory = master.category;
    }

    const item = await prisma.shoppingItem.create({
      data: {
        name: input.name,
        quantity: input.quantity ?? null,
        category: resolvedCategory,
        addedById: me.id,
      },
      include: { addedBy: { select: { id: true, name: true, color: true, avatarEmoji: true } } },
    });

    // v4.9.1 — catalog upsert intentionally removed. Typed shopping-list
    // adds no longer grow the master catalogue; users explicitly add
    // masters from the Catalog tab when they want a recurring item.

    return NextResponse.json({ item });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: e.errors }, { status: 400 });
    }
    return handleError(e);
  }
}
