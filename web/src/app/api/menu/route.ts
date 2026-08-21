import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { handleError } from "@/lib/http";

const mealEnum = z.enum(["BREAKFAST", "LUNCH", "DINNER", "SNACK"]);

// POST now *adds* an entry to a slot (multi-item). To edit or remove an entry,
// use the /api/menu/[id] endpoint.
const createSchema = z.object({
  date: z.string(), // ISO day
  mealType: mealEnum,
  recipeId: z.string().optional().nullable(),
  freeformTitle: z.string().max(200).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});

function dayKey(iso: string): Date {
  const d = new Date(iso);
  if (isNaN(d.getTime())) throw new HttpError(400, "Invalid date");
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export async function GET(req: NextRequest) {
  try {
    const me = await requireUser();
    if (!can(me, "canViewMenu")) {
      throw new HttpError(403, "No permission to view menu");
    }
    const url = new URL(req.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const where =
      from && to
        ? { date: { gte: dayKey(from), lte: dayKey(to) } }
        : {};

    const entries = await prisma.menuEntry.findMany({
      where,
      include: {
        recipe: {
          include: {
            ingredients: { orderBy: { position: "asc" } },
          },
        },
      },
      orderBy: [{ date: "asc" }, { mealType: "asc" }, { position: "asc" }],
    });
    return NextResponse.json({ entries });
  } catch (e) {
    return handleError(e);
  }
}

// Append a new entry to a (date, mealType) slot. Multiple items per slot are
// allowed — useful for party planning where Dinner might have a main, a side,
// and a dessert all on the same day.
export async function POST(req: NextRequest) {
  try {
    const me = await requireUser();
    if (!can(me, "canEditMenu")) {
      throw new HttpError(403, "No permission to edit menu");
    }
    const input = createSchema.parse(await req.json());
    if (!input.recipeId && !input.freeformTitle) {
      throw new HttpError(400, "Either recipeId or freeformTitle is required");
    }
    const date = dayKey(input.date);

    // Append at the end of the slot. We read + write in a transaction so two
    // quick clicks don't both land at position N.
    const entry = await prisma.$transaction(async (tx) => {
      const last = await tx.menuEntry.findFirst({
        where: { date, mealType: input.mealType },
        orderBy: { position: "desc" },
        select: { position: true },
      });
      const nextPosition = (last?.position ?? -1) + 1;
      return tx.menuEntry.create({
        data: {
          date,
          mealType: input.mealType,
          position: nextPosition,
          recipeId: input.recipeId ?? null,
          freeformTitle: input.freeformTitle ?? null,
          notes: input.notes ?? null,
          createdById: me.id,
        },
        include: {
          recipe: {
            include: { ingredients: { orderBy: { position: "asc" } } },
          },
        },
      });
    });
    return NextResponse.json({ entry });
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
