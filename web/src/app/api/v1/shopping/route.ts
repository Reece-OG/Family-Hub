// v4.9.0 — public REST: GET /api/v1/shopping
//
// Returns the shopping list. By default only outstanding (done=false)
// items; pass ?include_done=1 to include ticked rows.
//   ?category=<name>   filter to one category bucket
//   ?limit=<n>         cap 500, default 200
//
// Authn via Authorization: Bearer <token> with scope "shopping:read".

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiToken } from "@/lib/api-auth";
import { handleError } from "@/lib/http";

export async function GET(req: NextRequest) {
  try {
    await requireApiToken(req, "shopping:read");

    const url = new URL(req.url);
    const includeDone = url.searchParams.get("include_done") === "1";
    const category = url.searchParams.get("category");
    const limitParam = Number(url.searchParams.get("limit"));
    const limit =
      Number.isFinite(limitParam) && limitParam > 0
        ? Math.min(500, Math.floor(limitParam))
        : 200;

    const where: { done?: boolean; category?: string } = {};
    if (!includeDone) where.done = false;
    if (category) where.category = category;

    const items = await prisma.shoppingItem.findMany({
      where,
      take: limit,
      orderBy: [
        { done: "asc" },
        { category: "asc" },
        { createdAt: "desc" },
      ],
      include: {
        addedBy: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({
      count: items.length,
      items: items.map((i) => ({
        id: i.id,
        name: i.name,
        quantity: i.quantity,
        category: i.category,
        done: i.done,
        added_by_id: i.addedById,
        added_by_name: i.addedBy?.name ?? null,
        created_at: i.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    return handleError(e);
  }
}
