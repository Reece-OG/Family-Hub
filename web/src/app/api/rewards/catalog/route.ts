import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { handleError } from "@/lib/http";

// GET /api/rewards/catalog
//
// Lists every reward in the family's catalogue. Parents always see
// everything (including hidden); children only see `available=true` items
// so a parent can pre-stage rewards without them appearing live.
export async function GET() {
  try {
    const me = await requireUser();
    const where = me.role === "PARENT" ? {} : { available: true };
    const items = await prisma.rewardItem.findMany({
      where,
      include: { category: true },
      orderBy: [{ position: "asc" }, { createdAt: "desc" }],
    });
    return NextResponse.json({ items });
  } catch (e) {
    return handleError(e);
  }
}

const createSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional().nullable(),
  costPoints: z.number().int().min(1).max(1_000_000),
  categoryId: z.string().optional().nullable(),
  available: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const me = await requireUser();
    if (me.role !== "PARENT") {
      throw new HttpError(403, "Only parents can add rewards");
    }
    const input = createSchema.parse(await req.json());
    if (input.categoryId) {
      const cat = await prisma.rewardCategory.findUnique({
        where: { id: input.categoryId },
      });
      if (!cat) throw new HttpError(400, "Category not found");
    }
    const max = await prisma.rewardItem.aggregate({
      _max: { position: true },
    });
    const item = await prisma.rewardItem.create({
      data: {
        name: input.name.trim(),
        description: input.description?.trim() || null,
        costPoints: input.costPoints,
        categoryId: input.categoryId || null,
        available: input.available ?? true,
        position: (max._max.position ?? -1) + 1,
        createdById: me.id,
      },
      include: { category: true },
    });
    return NextResponse.json({ item });
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
