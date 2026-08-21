import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { handleError } from "@/lib/http";
// v4.9.1 — auto-upsert into the catalog has been removed across every
// shopping flow. Users add masters explicitly from the Catalog tab.

const schema = z.object({
  from: z.string(),
  to: z.string(),
});

function dayKey(iso: string): Date {
  const d = new Date(iso);
  if (isNaN(d.getTime())) throw new HttpError(400, "Invalid date");
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// POST /api/menu/to-shopping { from, to }
//
// Collect every ingredient from every recipe assigned to a menu slot in the
// [from, to] window and push them into the shopping list as unchecked items.
// Duplicate ingredient names (case-insensitive) are coalesced by summing their
// text quantities (naively — we just concatenate distinct quantities).
export async function POST(req: NextRequest) {
  try {
    const me = await requireUser();
    if (!can(me, "canEditMenu") || !can(me, "canEditShopping")) {
      throw new HttpError(403, "No permission to build a shopping list");
    }
    const input = schema.parse(await req.json());
    const from = dayKey(input.from);
    const to = dayKey(input.to);

    const entries = await prisma.menuEntry.findMany({
      where: { date: { gte: from, lte: to }, recipeId: { not: null } },
      include: {
        recipe: { include: { ingredients: true } },
      },
    });

    // Merge by lowercased name
    const merged = new Map<
      string,
      { name: string; quantity: string | null; category: string | null }
    >();
    for (const entry of entries) {
      if (!entry.recipe) continue;
      for (const ing of entry.recipe.ingredients) {
        const key = ing.name.trim().toLowerCase();
        if (!key) continue;
        const existing = merged.get(key);
        const qty = [ing.quantity, ing.unit].filter(Boolean).join(" ").trim() || null;
        if (!existing) {
          merged.set(key, {
            name: ing.name,
            quantity: qty,
            category: ing.category ?? null,
          });
        } else {
          if (qty && (!existing.quantity || !existing.quantity.includes(qty))) {
            existing.quantity = existing.quantity
              ? `${existing.quantity} + ${qty}`
              : qty;
          }
          if (!existing.category && ing.category) existing.category = ing.category;
        }
      }
    }

    let added = 0;
    for (const item of merged.values()) {
      // Skip if an unchecked item with the same name already exists.
      const dup = await prisma.shoppingItem.findFirst({
        where: {
          name: { equals: item.name, mode: "insensitive" },
          done: false,
        },
      });
      if (dup) continue;
      await prisma.shoppingItem.create({
        data: {
          name: item.name,
          quantity: item.quantity,
          category: item.category,
          addedById: me.id,
        },
      });
      // v4.9.1 — no longer auto-upserts the master. The catalog is
      // exclusively maintained via explicit "Add master" actions.
      added += 1;
    }

    return NextResponse.json({ ok: true, added, scanned: merged.size });
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
