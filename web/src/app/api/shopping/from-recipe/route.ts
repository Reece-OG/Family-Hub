// v4.7.19 — POST { recipeId, ingredientIds?: string[] }
//
// Adds the requested ingredients to the shopping list. When `ingredientIds`
// is omitted, ALL ingredients on the recipe are added (this is the "Add all
// to shopping list" toolbar button on the recipe view). Per-ingredient "+"
// buttons send a single-id array.
//
// We skip anything that's already on the open (unticked) shopping list with
// the same normalised name, so re-clicking "Add all" on a recipe doesn't
// duplicate every row. Ticked items are ignored — adding a milk you already
// bought is fine, that's a fresh need.
//
// Returns { added, skipped, items } so the UI can flash a confirmation
// ("Added 8 items, 3 already on the list").

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { handleError } from "@/lib/http";
// v4.9.1 — no longer auto-upserts into the catalog. Recipe ingredients
// land on the shopping list as one-offs; the user explicitly adds a
// master from the Catalog tab if they want it remembered for next time.
import { normaliseKey } from "@/lib/shopping-master";

const bodySchema = z.object({
  recipeId: z.string().min(1),
  ingredientIds: z.array(z.string()).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const me = await requireUser();
    if (!can(me, "canEditShopping")) throw new HttpError(403, "No permission");
    const input = bodySchema.parse(await req.json());

    const recipe = await prisma.recipe.findUnique({
      where: { id: input.recipeId },
      include: {
        ingredients: { orderBy: { position: "asc" } },
      },
    });
    if (!recipe) throw new HttpError(404, "Recipe not found");

    const wanted = input.ingredientIds && input.ingredientIds.length > 0
      ? recipe.ingredients.filter((ing) => input.ingredientIds!.includes(ing.id))
      : recipe.ingredients;

    if (wanted.length === 0) {
      return NextResponse.json({ added: 0, skipped: 0, items: [] });
    }

    // Pull the open (unticked) shopping list once so we can dedupe in memory.
    const openItems = await prisma.shoppingItem.findMany({
      where: { done: false },
      select: { name: true },
    });
    const openKeys = new Set(openItems.map((it) => normaliseKey(it.name)));

    const created: { id: string; name: string }[] = [];
    let skipped = 0;

    for (const ing of wanted) {
      const key = normaliseKey(ing.name);
      if (!key) continue;
      if (openKeys.has(key)) {
        skipped += 1;
        continue;
      }
      // Format quantity as "qty unit" when both are present; either alone is
      // fine; both blank → null.
      const qtyParts = [ing.quantity, ing.unit].filter(
        (p): p is string => !!p && p.trim().length > 0,
      );
      const quantity = qtyParts.length > 0 ? qtyParts.join(" ") : null;

      const item = await prisma.shoppingItem.create({
        data: {
          name: ing.name,
          quantity,
          category: ing.category,
          addedById: me.id,
        },
        select: { id: true, name: true },
      });
      created.push(item);
      openKeys.add(key);
      // v4.9.1 — no auto-upsert into the catalog. See top-of-file note.
    }

    return NextResponse.json({
      added: created.length,
      skipped,
      items: created,
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: e.errors }, { status: 400 });
    }
    return handleError(e);
  }
}
