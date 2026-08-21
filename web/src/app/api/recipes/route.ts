import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { handleError } from "@/lib/http";

const ingredientSchema = z.object({
  name: z.string().min(1).max(200),
  quantity: z.string().max(40).optional().nullable(),
  unit: z.string().max(40).optional().nullable(),
  category: z.string().max(80).optional().nullable(),
  position: z.number().int().optional(),
});

const createSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  servings: z.number().int().min(1).max(100).optional().nullable(),
  prepMinutes: z.number().int().min(0).max(1000).optional().nullable(),
  cookMinutes: z.number().int().min(0).max(1000).optional().nullable(),
  imageUrl: z.string().url().max(500).optional().nullable(),
  instructions: z.string().max(20_000).optional(),
  tags: z.string().max(200).optional().nullable(),
  // v4.6 — nutrition. Numbers only; per-serving can be left blank and we'll
  // compute it from total/servings below when we can.
  caloriesTotal: z.number().int().min(0).max(100_000).optional().nullable(),
  caloriesPerServing: z.number().int().min(0).max(100_000).optional().nullable(),
  ingredients: z.array(ingredientSchema).optional(),
});

// If the user gave us a total and servings but skipped per-serving, derive
// it. Rounded to whole kcal since no one needs fractional calorie counts.
function derivePerServing(
  total: number | null | undefined,
  perServing: number | null | undefined,
  servings: number | null | undefined,
): number | null {
  if (perServing != null) return perServing;
  if (total == null || servings == null || servings <= 0) return null;
  return Math.round(total / servings);
}

export async function GET(req: NextRequest) {
  try {
    const me = await requireUser();
    if (!can(me, "canViewRecipes")) {
      throw new HttpError(403, "No permission to view recipes");
    }
    const url = new URL(req.url);
    const q = url.searchParams.get("q")?.trim();

    const where = q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" as const } },
            { description: { contains: q, mode: "insensitive" as const } },
            { tags: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {};

    const recipes = await prisma.recipe.findMany({
      where,
      include: {
        ingredients: { orderBy: { position: "asc" } },
        createdBy: { select: { id: true, name: true, avatarEmoji: true } },
      },
      orderBy: { title: "asc" },
    });
    return NextResponse.json({ recipes });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const me = await requireUser();
    if (!can(me, "canEditRecipes")) {
      throw new HttpError(403, "No permission to add recipes");
    }
    const input = createSchema.parse(await req.json());

    const perServing = derivePerServing(
      input.caloriesTotal,
      input.caloriesPerServing,
      input.servings,
    );

    const recipe = await prisma.recipe.create({
      data: {
        title: input.title,
        description: input.description ?? null,
        servings: input.servings ?? null,
        prepMinutes: input.prepMinutes ?? null,
        cookMinutes: input.cookMinutes ?? null,
        imageUrl: input.imageUrl ?? null,
        instructions: input.instructions ?? "",
        tags: input.tags ?? null,
        caloriesTotal: input.caloriesTotal ?? null,
        caloriesPerServing: perServing,
        createdById: me.id,
        ingredients: {
          create: (input.ingredients ?? []).map((ing, i) => ({
            name: ing.name,
            quantity: ing.quantity ?? null,
            unit: ing.unit ?? null,
            category: ing.category ?? null,
            position: ing.position ?? i,
          })),
        },
      },
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
