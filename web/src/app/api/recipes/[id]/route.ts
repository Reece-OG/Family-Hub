import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { handleError } from "@/lib/http";
import { deleteImage } from "@/lib/recipe-images";

const ingredientSchema = z.object({
  name: z.string().min(1).max(200),
  quantity: z.string().max(40).optional().nullable(),
  unit: z.string().max(40).optional().nullable(),
  category: z.string().max(80).optional().nullable(),
  position: z.number().int().optional(),
});

const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional().nullable(),
  servings: z.number().int().min(1).max(100).optional().nullable(),
  prepMinutes: z.number().int().min(0).max(1000).optional().nullable(),
  cookMinutes: z.number().int().min(0).max(1000).optional().nullable(),
  imageUrl: z.string().url().max(500).optional().nullable(),
  instructions: z.string().max(20_000).optional(),
  tags: z.string().max(200).optional().nullable(),
  // v4.6 nutrition — same rules as create route. Leaving perServing undefined
  // keeps the existing stored value. Passing explicit null clears it.
  caloriesTotal: z.number().int().min(0).max(100_000).optional().nullable(),
  caloriesPerServing: z.number().int().min(0).max(100_000).optional().nullable(),
  ingredients: z.array(ingredientSchema).optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const me = await requireUser();
    if (!can(me, "canViewRecipes")) {
      throw new HttpError(403, "No permission to view recipes");
    }
    const recipe = await prisma.recipe.findUnique({
      where: { id: params.id },
      include: {
        ingredients: { orderBy: { position: "asc" } },
        createdBy: { select: { id: true, name: true, avatarEmoji: true } },
      },
    });
    if (!recipe) throw new HttpError(404, "Recipe not found");
    return NextResponse.json({ recipe });
  } catch (e) {
    return handleError(e);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const me = await requireUser();
    if (!can(me, "canEditRecipes")) {
      throw new HttpError(403, "No permission to edit recipes");
    }
    const existing = await prisma.recipe.findUnique({ where: { id: params.id } });
    if (!existing) throw new HttpError(404, "Recipe not found");

    const input = patchSchema.parse(await req.json());
    const data: Record<string, unknown> = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.description !== undefined) data.description = input.description;
    if (input.servings !== undefined) data.servings = input.servings;
    if (input.prepMinutes !== undefined) data.prepMinutes = input.prepMinutes;
    if (input.cookMinutes !== undefined) data.cookMinutes = input.cookMinutes;
    if (input.imageUrl !== undefined) data.imageUrl = input.imageUrl;
    if (input.instructions !== undefined) data.instructions = input.instructions;
    if (input.tags !== undefined) data.tags = input.tags;

    // Nutrition: when the caller provided a total but no explicit perServing,
    // derive perServing from (total / servings). We read the resolved values
    // from the input first, falling back to the existing row so editing just
    // one of the two numbers still produces sensible results.
    if (input.caloriesTotal !== undefined) data.caloriesTotal = input.caloriesTotal;
    if (input.caloriesPerServing !== undefined) {
      data.caloriesPerServing = input.caloriesPerServing;
    } else if (input.caloriesTotal !== undefined) {
      const servings =
        input.servings !== undefined ? input.servings : existing.servings;
      if (input.caloriesTotal != null && servings && servings > 0) {
        data.caloriesPerServing = Math.round(input.caloriesTotal / servings);
      } else if (input.caloriesTotal == null) {
        data.caloriesPerServing = null;
      }
    }

    // Replace the ingredients list wholesale if supplied.
    if (input.ingredients !== undefined) {
      await prisma.recipeIngredient.deleteMany({ where: { recipeId: params.id } });
      await prisma.recipeIngredient.createMany({
        data: input.ingredients.map((ing, i) => ({
          recipeId: params.id,
          name: ing.name,
          quantity: ing.quantity ?? null,
          unit: ing.unit ?? null,
          category: ing.category ?? null,
          position: ing.position ?? i,
        })),
      });
    }

    const recipe = await prisma.recipe.update({
      where: { id: params.id },
      data,
      include: {
        ingredients: { orderBy: { position: "asc" } },
        createdBy: { select: { id: true, name: true, avatarEmoji: true } },
      },
    });
    return NextResponse.json({ recipe });
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
    if (!can(me, "canEditRecipes")) {
      throw new HttpError(403, "No permission to delete recipes");
    }
    // Grab the uploaded image filename first so we can tidy up the file on
    // disk alongside the row.
    const existing = await prisma.recipe.findUnique({
      where: { id: params.id },
      select: { imageFilename: true },
    });
    await prisma.recipe.delete({ where: { id: params.id } });
    if (existing?.imageFilename) {
      await deleteImage(existing.imageFilename).catch(() => {});
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
