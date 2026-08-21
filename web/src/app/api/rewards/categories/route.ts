import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, HttpError } from "@/lib/auth";
import { handleError } from "@/lib/http";
import { ensureStarterRewardCategories } from "@/lib/rewards";

// GET /api/rewards/categories
// Visible to everyone (children need them to filter the kid-facing
// catalog). Auto-seeds the starter list when the family hasn't created
// any categories yet — uses the caller as the "creator" of the seeded
// rows so we always have a non-null FK.
export async function GET() {
  try {
    const me = await requireUser();
    await ensureStarterRewardCategories(me.id);
    const categories = await prisma.rewardCategory.findMany({
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    });
    return NextResponse.json({ categories });
  } catch (e) {
    return handleError(e);
  }
}

const createSchema = z.object({
  name: z.string().min(1).max(80),
  hint: z.string().max(280).optional().nullable(),
});

export async function POST(req: NextRequest) {
  try {
    const me = await requireUser();
    if (me.role !== "PARENT") {
      throw new HttpError(403, "Only parents can manage reward categories");
    }
    const input = createSchema.parse(await req.json());
    const max = await prisma.rewardCategory.aggregate({
      _max: { position: true },
    });
    const category = await prisma.rewardCategory.create({
      data: {
        name: input.name.trim(),
        hint: input.hint?.trim() || null,
        position: (max._max.position ?? -1) + 1,
        isStarter: false,
        createdById: me.id,
      },
    });
    return NextResponse.json({ category });
  } catch (e: unknown) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: e.errors },
        { status: 400 },
      );
    }
    if (
      typeof e === "object" &&
      e !== null &&
      "code" in e &&
      (e as { code?: string }).code === "P2002"
    ) {
      return NextResponse.json(
        { error: "A category with that name already exists" },
        { status: 409 },
      );
    }
    return handleError(e);
  }
}
