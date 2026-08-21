// v4.7.19 — ShoppingMaster catalogue CRUD.
//
// GET   /api/shopping/masters         — list. ?q= search, ?sort=recent|alpha
// POST  /api/shopping/masters         — create a master manually (catalog UI
//                                       "+ Add master")

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { handleError } from "@/lib/http";
import { normaliseKey } from "@/lib/shopping-master";

const createSchema = z.object({
  name: z.string().min(1).max(200),
  category: z.string().max(50).optional().nullable(),
  defaultQuantity: z.string().max(50).optional().nullable(),
});

export async function GET(req: NextRequest) {
  try {
    const me = await requireUser();
    if (!can(me, "canViewShopping")) throw new HttpError(403, "No permission");
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") || "").trim().toLowerCase();
    const sort = url.searchParams.get("sort") || "alpha";
    // Hidden masters never appear in any list — they're a soft-delete.
    const where: { hidden: boolean; nameKey?: { contains: string } } = {
      hidden: false,
    };
    if (q) where.nameKey = { contains: q };
    const masters = await prisma.shoppingMaster.findMany({
      where,
      orderBy:
        sort === "recent"
          ? [{ lastUsedAt: "desc" }, { name: "asc" }]
          : [{ category: "asc" }, { name: "asc" }],
    });
    return NextResponse.json({ masters });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const me = await requireUser();
    if (!can(me, "canEditShopping")) throw new HttpError(403, "No permission");
    const input = createSchema.parse(await req.json());
    const name = input.name.trim();
    const nameKey = normaliseKey(name);
    if (!nameKey) throw new HttpError(400, "Name cannot be blank");

    // Manual creation goes through findUnique-then-update rather than the
    // upsertMaster helper, because the user is explicitly saying "this is what
    // I want the master to look like" — so we DO honour their category /
    // defaultQuantity values even if a different master exists with the same
    // key (we update it instead).
    const existing = await prisma.shoppingMaster.findUnique({ where: { nameKey } });
    if (existing) {
      const updated = await prisma.shoppingMaster.update({
        where: { id: existing.id },
        data: {
          name,
          category: input.category ?? null,
          defaultQuantity: input.defaultQuantity ?? null,
          hidden: false,
        },
      });
      return NextResponse.json({ master: updated });
    }

    const master = await prisma.shoppingMaster.create({
      data: {
        name,
        nameKey,
        category: input.category ?? null,
        defaultQuantity: input.defaultQuantity ?? null,
        createdById: me.id,
      },
    });
    return NextResponse.json({ master });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: e.errors }, { status: 400 });
    }
    return handleError(e);
  }
}
